import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  CATCHER_LOGIN,
  client,
  setupOwner,
  smtpAccount,
  startApp,
  startCatcher,
} from './helpers.js'

/**
 * The background sender's rules: how fast it goes, what it does when a server
 * says "not now", "not ever" or "you have sent enough today", and what happens
 * to a campaign that is paused, canceled or scheduled.
 */
describe('delivery', () => {
  let app: FastifyInstance
  let catcher: Awaited<ReturnType<typeof startCatcher>>
  let api: ReturnType<typeof client>
  let listId: string

  const boot = async (
    catcherOptions: Parameters<typeof startCatcher>[0],
    account: Record<string, unknown> = {},
  ) => {
    app = await startApp()
    catcher = await startCatcher(catcherOptions)
    api = client(app)
    await setupOwner(api)
    await api.patch('/settings', { organization: { address1: '1 Main St', city: 'Charlotte' } })
    await api.post('/sending-accounts', smtpAccount(catcher, account))
    listId = (await api.post('/lists', { name: 'Everyone' })).body.id
  }

  const contacts = async (...emails: string[]) => {
    await api.post('/contacts/import', {
      csv: ['email', ...emails].join('\n'),
      mapping: { email: 'email' },
      listIds: [listId],
      consentConfirmed: true,
    })
  }

  const campaign = async (name = 'News') =>
    (
      await api.post('/campaigns', {
        name,
        subject: 'Hello',
        html: '<p>Hi</p>',
        audience: { listIds: [listId] },
      })
    ).body.id as string

  const stats = async (id: string) =>
    (await api.get(`/campaigns/${id}`)).body as { status: string; stats: Record<string, number> }

  beforeEach(() => {
    // Each test builds the world it needs.
  })

  afterEach(async () => {
    await app.close()
    await catcher.close()
  })

  it('keeps to the per-minute limit, and picks up where it left off', async () => {
    await boot({}, { perMinute: 2 })
    await contacts('a@example.test', 'b@example.test', 'c@example.test', 'd@example.test')
    const id = await campaign()
    await api.post(`/campaigns/${id}/send`, {})
    for (let pass = 0; pass < 5; pass += 1) await app.worker.tick()

    // Two a minute means two, however many passes there were.
    expect(catcher.mail).toHaveLength(2)
    expect(await stats(id)).toMatchObject({ status: 'sending', stats: { sent: 2, queued: 2 } })

    // A minute later the next two go.
    app.ctx.db
      .prepare('UPDATE messages SET sent_at = ? WHERE sent_at IS NOT NULL')
      .run(new Date(Date.now() - 61_000).toISOString())
    for (let pass = 0; pass < 5; pass += 1) await app.worker.tick()
    expect(catcher.mail).toHaveLength(4)
    expect((await stats(id)).status).toBe('sent')
  })

  it('stops at the daily limit and leaves the rest queued', async () => {
    await boot({}, { dailyLimit: 3 })
    await contacts(
      'a@example.test',
      'b@example.test',
      'c@example.test',
      'd@example.test',
      'e@example.test',
    )
    const id = await campaign()
    await api.post(`/campaigns/${id}/send`, {})
    for (let pass = 0; pass < 4; pass += 1) await app.worker.tick()
    expect(catcher.mail).toHaveLength(3)
    expect(await stats(id)).toMatchObject({
      status: 'sending',
      stats: { sent: 3, queued: 2, failed: 0 },
    })

    const [account] = (await api.get('/sending-accounts')).body
    expect(account).toMatchObject({ sentLast24h: 3, queued: 2, status: 'ok' })
  })

  it('retries a temporary refusal later, without treating the address as bad', async () => {
    await boot({ deferRecipient: /^busy@/ })
    await contacts('fine@example.test', 'busy@example.test')
    const id = await campaign()
    await api.post(`/campaigns/${id}/send`, {})
    await app.worker.tick()
    await app.worker.tick()

    expect(await stats(id)).toMatchObject({
      status: 'sending',
      stats: { sent: 1, queued: 1, bounced: 0 },
    })
    const waiting = app.ctx.db
      .prepare(
        "SELECT attempts, next_attempt_at, last_error FROM messages WHERE to_email = 'busy@example.test'",
      )
      .get() as { attempts: number; next_attempt_at: string; last_error: string }
    expect(waiting.attempts).toBe(1)
    expect(new Date(waiting.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 30_000)
    expect(waiting.last_error).toMatch(/receiving mail too quickly/)
    expect((await api.get('/contacts?q=busy@')).body.items[0].status).toBe('subscribed')
    expect((await api.get('/queue')).body).toMatchObject({ retrying: 1 })

    // After the last attempt it is a failure, and still not a bounce.
    app.ctx.db
      .prepare(
        "UPDATE messages SET attempts = 4, next_attempt_at = ? WHERE to_email = 'busy@example.test'",
      )
      .run(new Date(Date.now() - 1000).toISOString())
    await app.worker.tick()
    expect(await stats(id)).toMatchObject({
      status: 'sent',
      stats: { sent: 1, failed: 1, bounced: 0 },
    })
    expect((await api.get('/suppressions')).body.total).toBe(0)
  })

  it('reads "daily sending limit exceeded" as the account being out of quota, not as a bounce', async () => {
    await boot({ quotaAfter: 1 })
    await contacts('a@example.test', 'b@example.test', 'c@example.test')
    const id = await campaign()
    await api.post(`/campaigns/${id}/send`, {})
    await app.worker.tick()
    await app.worker.tick()

    expect(catcher.mail).toHaveLength(1)
    expect(await stats(id)).toMatchObject({
      status: 'sending',
      stats: { sent: 1, queued: 2, bounced: 0, failed: 0 },
    })
    const [account] = (await api.get('/sending-accounts')).body
    expect(account.pausedUntil).toBeTruthy()
    expect(new Date(account.pausedUntil).getTime()).toBeGreaterThan(Date.now() + 30 * 60_000)
    // Nobody was suppressed for the provider's limit.
    expect((await api.get('/suppressions')).body.total).toBe(0)
    expect((await api.get('/contacts?status=bounced')).body.total).toBe(0)
  })

  it('holds the mail and flags the account when the account itself stops working', async () => {
    await boot({})
    await contacts('a@example.test', 'b@example.test')
    const id = await campaign()
    // The password is changed at the provider after the account was verified.
    const [account] = (await api.get('/sending-accounts')).body
    app.ctx.db
      .prepare('UPDATE sending_accounts SET password_enc = ?, updated_at = ? WHERE id = ?')
      .run(app.ctx.secrets.encrypt('stale'), new Date().toISOString(), account.id)

    await api.post(`/campaigns/${id}/send`, {})
    await app.worker.tick()
    await app.worker.tick()
    expect(catcher.mail).toHaveLength(0)
    expect(await stats(id)).toMatchObject({
      status: 'sending',
      stats: { queued: 2, failed: 0, bounced: 0 },
    })
    const [after] = (await api.get('/sending-accounts')).body
    expect(after).toMatchObject({ status: 'error' })
    expect(after.lastError).toMatch(/did not accept the username and password/)
    expect((await api.get('/logs?level=error')).body.items[0].message).toMatch(/cannot send/)

    // Fixing the password releases what was waiting.
    await api.patch(`/sending-accounts/${account.id}`, { password: CATCHER_LOGIN.pass })
    await app.worker.tick()
    expect(catcher.mail).toHaveLength(2)
    expect((await stats(id)).status).toBe('sent')
  })

  it('pauses, resumes and cancels', async () => {
    await boot({}, { perMinute: 1 })
    await contacts('a@example.test', 'b@example.test', 'c@example.test')
    const id = await campaign()
    await api.post(`/campaigns/${id}/send`, {})
    await app.worker.tick()
    expect(catcher.mail).toHaveLength(1)

    expect((await api.post(`/campaigns/${id}/pause`)).body.status).toBe('paused')
    app.ctx.db
      .prepare('UPDATE messages SET sent_at = ? WHERE sent_at IS NOT NULL')
      .run(new Date(Date.now() - 61_000).toISOString())
    await app.worker.tick()
    expect(catcher.mail).toHaveLength(1)

    expect((await api.post(`/campaigns/${id}/resume`)).body.status).toBe('sending')
    await app.worker.tick()
    expect(catcher.mail).toHaveLength(2)

    const canceled = (await api.post(`/campaigns/${id}/cancel`)).body
    expect(canceled).toMatchObject({ status: 'canceled', stats: { sent: 2, queued: 0 } })
    app.ctx.db
      .prepare('UPDATE messages SET sent_at = ? WHERE sent_at IS NOT NULL')
      .run(new Date(Date.now() - 61_000).toISOString())
    await app.worker.tick()
    expect(catcher.mail).toHaveLength(2)
    expect((await api.post(`/campaigns/${id}/resume`)).status).toBe(409)
  })

  it('starts a scheduled campaign when its time comes, and not before', async () => {
    await boot({})
    await contacts('a@example.test')
    const id = await campaign()
    const inAnHour = new Date(Date.now() + 3_600_000).toISOString()
    const scheduled = await api.post(`/campaigns/${id}/send`, { scheduledAt: inAnHour })
    expect(scheduled.body).toMatchObject({ status: 'scheduled', scheduledAt: inAnHour })

    await app.worker.tick()
    expect(catcher.mail).toHaveLength(0)

    // Someone joins the list while it waits: they are in the audience at send time.
    await contacts('late@example.test')
    // It can still be edited, and what is saved when the time comes is what goes.
    expect((await api.patch(`/campaigns/${id}`, { subject: 'Hello again' })).status).toBe(200)

    app.ctx.db
      .prepare('UPDATE campaigns SET scheduled_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), id)
    await app.worker.tick()
    expect(catcher.mail.map((mail) => mail.to[0]).sort()).toEqual([
      'a@example.test',
      'late@example.test',
    ])
    expect(catcher.mail[0]!.raw).toMatch(/Subject: Hello again/)
    expect((await stats(id)).status).toBe('sent')
  })

  it('does not send to someone who unsubscribes while the campaign is still going out', async () => {
    await boot({}, { perMinute: 1 })
    await contacts('first@example.test', 'second@example.test')
    const id = await campaign()
    await api.post(`/campaigns/${id}/send`, {})
    await app.worker.tick()
    expect(catcher.mail).toHaveLength(1)

    const waiting = app.ctx.db
      .prepare(
        "SELECT c.id FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.status = 'queued'",
      )
      .get() as { id: string }
    await api.patch(`/contacts/${waiting.id}`, { status: 'unsubscribed' })
    app.ctx.db
      .prepare('UPDATE messages SET sent_at = ? WHERE sent_at IS NOT NULL')
      .run(new Date(Date.now() - 61_000).toISOString())
    await app.worker.tick()

    expect(catcher.mail).toHaveLength(1)
    expect(await stats(id)).toMatchObject({ status: 'sent', stats: { sent: 1, queued: 0 } })
  })
})
