import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { client, decodeQp, setupOwner, smtpAccount, startApp, startCatcher } from './helpers.js'

/**
 * Audience growth and automation together, because that is how they are used:
 * a stranger fills in a form, confirms by email, and a welcome series starts.
 */
describe('signup form, double opt-in and a welcome automation', () => {
  let app: FastifyInstance
  let catcher: Awaited<ReturnType<typeof startCatcher>>
  let api: ReturnType<typeof client>
  let listId: string
  let formId: string
  let automationId: string
  const visitor = () => client(app)

  beforeAll(async () => {
    app = await startApp()
    catcher = await startCatcher()
    api = client(app)
    await setupOwner(api)
    await api.post('/sending-accounts', smtpAccount(catcher))
    await api.patch('/settings', { organization: { address1: '1 Main St', city: 'Charlotte', region: 'NC', postalCode: '28202' } })
    listId = (await api.post('/lists', { name: 'Newsletter', doubleOptIn: true })).body.id
  })

  afterAll(async () => {
    await app.close()
    await catcher.close()
  })

  it('builds a welcome automation and refuses to turn on an empty one', async () => {
    const empty = await api.post('/automations', { name: 'Welcome', trigger: { type: 'list_subscribed', listId } })
    expect(empty.status).toBe(201)
    automationId = empty.body.id
    expect((await api.post(`/automations/${automationId}/activate`)).status).toBe(409)

    const filled = await api.patch(`/automations/${automationId}`, {
      steps: [
        { id: 's1', type: 'email', subject: 'Welcome, {{first_name|friend}}', html: '<p>Glad you are here, {{first_name|friend}}.</p>' },
        { id: 's2', type: 'delay', amount: 2, unit: 'days' },
        { id: 's3', type: 'email', subject: 'A second note', html: '<p>Two days on.</p>' },
      ],
    })
    expect(filled.status).toBe(200)
    const active = await api.post(`/automations/${automationId}/activate`)
    expect(active.body.status).toBe('active')
  })

  it('serves a form to the public with nothing private in it', async () => {
    const created = await api.post('/forms', {
      name: 'Footer signup',
      title: 'Get the newsletter',
      listIds: [listId],
      fields: [{ key: 'firstName', label: 'First name', required: true }],
      doubleOptIn: true,
    })
    expect(created.status).toBe(201)
    formId = created.body.id

    const view = await visitor().get(`/public/forms/${formId}`)
    expect(view.status).toBe(200)
    expect(view.body).toMatchObject({ title: 'Get the newsletter', organization: 'Northwind', consentRequired: true })
    expect(view.body.lists).toEqual([{ id: listId, name: 'Newsletter', description: null }])
    expect(view.body.tagIds).toBeUndefined()
  })

  it('insists on consent and on required fields', async () => {
    const noConsent = await visitor().post(`/public/forms/${formId}/subscribe`, { email: 'new@example.test', fields: { firstName: 'Nia' } })
    expect(noConsent.status).toBe(400)
    const noName = await visitor().post(`/public/forms/${formId}/subscribe`, { email: 'new@example.test', consent: true })
    expect(noName.status).toBe(400)
    expect(noName.body.error.message).toBe('First name is required.')
  })

  it('tells a bot it worked and does nothing', async () => {
    const response = await visitor().post(`/public/forms/${formId}/subscribe`, { email: 'bot@example.test', fields: { firstName: 'B' }, consent: true, website: 'http://spam' })
    expect(response.status).toBe(200)
    expect((await api.get('/contacts?q=bot@')).body.total).toBe(0)
  })

  it('holds a signup as pending and emails a confirmation link', async () => {
    catcher.mail.length = 0
    const response = await visitor().post(`/public/forms/${formId}/subscribe`, { email: 'Nia@Example.test', fields: { firstName: 'Nia' }, consent: true })
    expect(response.body.status).toBe('confirmation_sent')
    await app.worker.tick()

    const nia = (await api.get('/contacts?q=nia@')).body.items[0]
    expect(nia).toMatchObject({ email: 'nia@example.test', firstName: 'Nia', status: 'pending', confirmedAt: null })
    expect(nia.lists).toMatchObject([{ status: 'pending' }])

    // Exactly one email so far: the confirmation. The welcome has not started.
    expect(catcher.mail).toHaveLength(1)
    expect(catcher.mail[0]!.raw).toMatch(/Subject: Please confirm your subscription to Northwind/)
    // A confirmation is not marketing: no unsubscribe header on it.
    expect(catcher.mail[0]!.raw).not.toMatch(/List-Unsubscribe/)
  })

  it('subscribes on the confirmation click, records consent and starts the welcome', async () => {
    const token = /\/confirm\/([\w-]+)/.exec(decodeQp(catcher.mail[0]!.raw))![1]!
    catcher.mail.length = 0

    const confirmed = await visitor().post(`/public/confirm/${token}`)
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.email).toMatch(/^n•+@example\.test$/)

    const nia = (await api.get('/contacts?q=nia@')).body.items[0]
    expect(nia.status).toBe('subscribed')
    expect(nia.confirmedAt).toBeTruthy()
    expect(nia).toMatchObject({ consentSource: 'Form: Footer signup', consentText: 'I agree to receive emails and understand I can unsubscribe at any time.' })
    expect(nia.lists).toMatchObject([{ status: 'subscribed' }])

    await app.worker.tick()
    expect(catcher.mail).toHaveLength(1)
    const welcome = catcher.mail[0]!
    expect(welcome.raw).toMatch(/Subject: Welcome, Nia/)
    expect(welcome.raw).toMatch(/List-Unsubscribe-Post/)
    expect(decodeQp(welcome.raw)).toContain('1 Main St, Charlotte, NC 28202')

    // Clicking the link again changes nothing and sends nothing.
    expect((await visitor().post(`/public/confirm/${token}`)).status).toBe(200)
    await app.worker.tick()
    expect(catcher.mail).toHaveLength(1)
  })

  it('waits out the delay, then sends the next email', async () => {
    const run = app.ctx.db.prepare('SELECT * FROM automation_runs WHERE automation_id = ?').get(automationId) as { id: string; status: string; step_index: number; next_run_at: string }
    expect(run).toMatchObject({ status: 'active', step_index: 2 })
    expect(new Date(run.next_run_at).getTime() - Date.now()).toBeGreaterThan(1.9 * 86_400_000)

    // Two days pass.
    app.ctx.db.prepare('UPDATE automation_runs SET next_run_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), run.id)
    catcher.mail.length = 0
    await app.worker.tick()
    expect(catcher.mail).toHaveLength(1)
    expect(catcher.mail[0]!.raw).toMatch(/Subject: A second note/)

    const automation = (await api.get(`/automations/${automationId}`)).body
    expect(automation.stats).toMatchObject({ active: 0, completed: 1, emailsSent: 2 })
  })

  it('lets someone leave one list on the preferences page without unsubscribing from everything', async () => {
    const second = (await api.post('/lists', { name: 'Product updates' })).body.id
    const nia = (await api.get('/contacts?q=nia@')).body.items[0]
    await api.patch(`/contacts/${nia.id}`, { listIds: [listId, second] })
    const token = (app.ctx.db.prepare('SELECT token FROM contacts WHERE id = ?').get(nia.id) as { token: string }).token

    const before = await visitor().get(`/public/preferences/${token}`)
    expect(before.body.lists.map((list: { subscribed: boolean }) => list.subscribed)).toEqual([true, true])

    const after = await visitor().post(`/public/preferences/${token}`, { listIds: [second] })
    expect(after.body.lists).toMatchObject([{ name: 'Newsletter', subscribed: false }, { name: 'Product updates', subscribed: true }])
    expect((await api.get(`/contacts/${nia.id}`)).body.status).toBe('subscribed')
  })

  it('makes someone who unsubscribed confirm by email before they are back', async () => {
    const nia = (await api.get('/contacts?q=nia@')).body.items[0]
    const token = (app.ctx.db.prepare('SELECT token FROM contacts WHERE id = ?').get(nia.id) as { token: string }).token
    await visitor().post(`/public/unsubscribe/${token}`, { reason: 'too_many' })
    expect((await api.get(`/contacts/${nia.id}`)).body).toMatchObject({ status: 'unsubscribed', unsubscribeReason: 'I get too many emails' })

    // A form without double opt-in still cannot re-subscribe them directly.
    const open = (await api.post('/forms', { name: 'Quick', listIds: [listId], doubleOptIn: false, consentRequired: false })).body.id
    catcher.mail.length = 0
    const again = await visitor().post(`/public/forms/${open}/subscribe`, { email: 'nia@example.test' })
    expect(again.status).toBe(200)
    expect((await api.get(`/contacts/${nia.id}`)).body.status).toBe('unsubscribed')

    await app.worker.tick()
    expect(catcher.mail).toHaveLength(1)
    const confirm = /\/confirm\/([\w-]+)/.exec(decodeQp(catcher.mail[0]!.raw))![1]!
    await visitor().post(`/public/confirm/${confirm}`)
    expect((await api.get(`/contacts/${nia.id}`)).body.status).toBe('subscribed')
    expect((await api.get('/suppressions?q=nia@')).body.total).toBe(0)
  })
})
