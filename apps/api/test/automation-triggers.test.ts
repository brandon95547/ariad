import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { localNow, scanScheduledTriggers } from '../src/services/automations.js'
import { client, setupOwner, smtpAccount, startApp, startCatcher } from './helpers.js'

/**
 * The triggers nothing announces: a date coming round, and time passing after
 * a campaign. Both are found by a periodic scan, so the scan is called here
 * directly instead of waiting for it.
 */
describe('date and follow-up triggers', () => {
  let app: FastifyInstance
  let catcher: Awaited<ReturnType<typeof startCatcher>>
  let api: ReturnType<typeof client>
  let listId: string

  const email = (subject: string) => ({ id: `e-${subject}`, type: 'email', subject, html: `<p>${subject}</p>` })
  const pad = (value: number) => String(value).padStart(2, '0')
  const dayOffset = (days: number) => localNow('UTC', new Date(Date.now() + days * 86_400_000))

  beforeAll(async () => {
    app = await startApp()
    catcher = await startCatcher()
    api = client(app)
    await setupOwner(api)
    await api.patch('/settings', { organization: { address1: '1 Main St', city: 'Charlotte' }, timezone: 'UTC' })
    await api.post('/sending-accounts', smtpAccount(catcher))
    listId = (await api.post('/lists', { name: 'Everyone' })).body.id
  })

  afterAll(async () => {
    await app.close()
    await catcher.close()
  })

  it('greets people whose birthday is today, once a year, whatever year they were born', async () => {
    const today = dayOffset(0)
    const tomorrow = dayOffset(1)
    await api.post('/contacts', { email: 'today@example.test', firstName: 'Tess', birthday: `1990-${today.md}`, listIds: [listId] })
    await api.post('/contacts', { email: 'noyear@example.test', birthday: `--${today.md}`, listIds: [listId] })
    await api.post('/contacts', { email: 'tomorrow@example.test', birthday: `1985-${tomorrow.md}`, listIds: [listId] })
    await api.post('/contacts', { email: 'none@example.test', listIds: [listId] })

    const automation = (
      await api.post('/automations', { name: 'Birthday', trigger: { type: 'date', field: 'birthday', offsetDays: 0, hour: 0 }, steps: [email('Happy birthday')] })
    ).body
    await api.post(`/automations/${automation.id}/activate`)

    scanScheduledTriggers(app.ctx)
    await app.worker.tick()
    expect(catcher.mail.map((mail) => mail.to[0]).sort()).toEqual(['noyear@example.test', 'today@example.test'])

    // The scan runs every few minutes all day. Nobody is greeted twice.
    scanScheduledTriggers(app.ctx)
    scanScheduledTriggers(app.ctx)
    await app.worker.tick()
    expect(catcher.mail).toHaveLength(2)
    expect((await api.get(`/automations/${automation.id}`)).body.stats).toMatchObject({ completed: 2, emailsSent: 2 })
  })

  it('counts days before the date when asked to', async () => {
    catcher.mail.length = 0
    const inThreeDays = dayOffset(3)
    await api.post('/contacts', { email: 'soon@example.test', birthday: `1970-${inThreeDays.md}`, listIds: [listId] })
    const automation = (
      await api.post('/automations', { name: 'Coming up', trigger: { type: 'date', field: 'birthday', offsetDays: -3, hour: 0 }, steps: [email('Three days to go')] })
    ).body
    await api.post(`/automations/${automation.id}/activate`)

    scanScheduledTriggers(app.ctx)
    await app.worker.tick()
    expect(catcher.mail.map((mail) => mail.to[0])).toEqual(['soon@example.test'])
  })

  it('waits for the hour it was told to send at', async () => {
    catcher.mail.length = 0
    const now = localNow('UTC')
    if (now.hour === 23) return // No later hour today to wait for.
    await api.post('/contacts', { email: 'later@example.test', birthday: `2000-${now.md}`, listIds: [listId] })
    const automation = (
      await api.post('/automations', { name: 'Evening', trigger: { type: 'date', field: 'birthday', offsetDays: 0, hour: now.hour + 1 }, steps: [email('Good evening')] })
    ).body
    await api.post(`/automations/${automation.id}/activate`)
    scanScheduledTriggers(app.ctx)
    await app.worker.tick()
    expect(catcher.mail.filter((mail) => mail.raw.includes('Good evening'))).toHaveLength(0)
  })

  it('follows up a campaign with the people who did not open it, after the wait', async () => {
    // A list of its own, so the birthday contacts above stay out of it.
    const followers = (await api.post('/lists', { name: 'Followers' })).body.id
    await api.post('/contacts', { email: 'opened@example.test', listIds: [followers] })
    await api.post('/contacts', { email: 'ignored@example.test', listIds: [followers] })
    const campaign = (await api.post('/campaigns', { name: 'Launch', subject: 'Launch', html: '<p>Launch</p>', audience: { listIds: [followers] } })).body
    await api.post(`/campaigns/${campaign.id}/send`, {})
    await app.worker.tick()
    await app.worker.tick()
    expect((await api.get(`/campaigns/${campaign.id}`)).body.stats.sent).toBe(2)

    const automation = (
      await api.post('/automations', {
        name: 'Nudge',
        trigger: { type: 'campaign_followup', campaignId: campaign.id, condition: 'not_opened', afterDays: 3 },
        steps: [email('In case you missed it')],
      })
    ).body
    await api.post(`/automations/${automation.id}/activate`)

    // One of them opens it.
    const opened = app.ctx.db.prepare("SELECT token FROM messages WHERE to_email = 'opened@example.test' AND campaign_id = ?").get(campaign.id) as { token: string }
    await api.get(`/t/o/${opened.token}.gif`)

    // Too soon: it went out a minute ago.
    catcher.mail.length = 0
    scanScheduledTriggers(app.ctx)
    await app.worker.tick()
    expect(catcher.mail).toHaveLength(0)

    // Three days later.
    app.ctx.db.prepare('UPDATE messages SET sent_at = ? WHERE campaign_id = ?').run(new Date(Date.now() - 3 * 86_400_000 - 60_000).toISOString(), campaign.id)
    scanScheduledTriggers(app.ctx)
    scanScheduledTriggers(app.ctx)
    await app.worker.tick()
    expect(catcher.mail.map((mail) => mail.to[0])).toEqual(['ignored@example.test'])
    expect(catcher.mail[0]!.raw).toMatch(/Subject: In case you missed it/)
  })

  it('reads the date in the account time zone, not the server one', () => {
    // 01:30 UTC on March 2 is still March 1 in New York.
    const at = new Date('2026-03-02T01:30:00Z')
    expect(localNow('UTC', at)).toEqual({ year: 2026, md: `${pad(3)}-${pad(2)}`, hour: 1 })
    expect(localNow('America/New_York', at)).toEqual({ year: 2026, md: '03-01', hour: 20 })
    expect(localNow('Not/AZone', at)).toEqual(localNow('UTC', at))
  })
})
