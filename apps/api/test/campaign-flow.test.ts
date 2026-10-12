import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { client, decodeQp, startApp, startCatcher } from './helpers.js'

/**
 * The whole path a campaign takes: contacts in, a message out through SMTP,
 * and everything that comes back — opens, clicks, an unsubscribe, a bounce.
 */
describe('a campaign, end to end', () => {
  let app: FastifyInstance
  let catcher: Awaited<ReturnType<typeof startCatcher>>
  let api: ReturnType<typeof client>
  let listId: string
  let campaignId: string

  beforeAll(async () => {
    app = await startApp()
    catcher = await startCatcher({ rejectRecipient: /^gone@/ })
    api = client(app)
    await api.post('/auth/setup', { name: 'Brandon', email: 'owner@example.test', password: 'correct horse', organization: 'Northwind' })
    await api.post('/sending-accounts', {
      kind: 'smtp', label: 'Catcher', host: '127.0.0.1', port: catcher.port, security: 'none',
      username: 'sender', password: 'right-password', fromName: 'Northwind', fromEmail: 'news@northwind.test', perMinute: 600,
    })
    listId = (await api.post('/lists', { name: 'Newsletter' })).body.id
  })

  afterAll(async () => {
    await app.close()
    await catcher.close()
  })

  it('imports a CSV, folding duplicates and reporting bad rows', async () => {
    const csv = [
      'Email,First Name,Last Name,Company,Tags',
      'ada@example.test,Ada,Lovelace,Analytical,"vip, early"',
      'ADA@example.test,,,Engines Ltd,',
      'grace@example.test,Grace,Hopper,Navy,vip',
      'gone@example.test,Gone,Away,,',
      'left@example.test,Left,Already,,',
      'not-an-email,No,Body,,',
      '',
    ].join('\r\n')
    const summary = await api.post('/contacts/import', {
      csv,
      mapping: { Email: 'email', 'First Name': 'firstName', 'Last Name': 'lastName', Company: 'company', Tags: 'tags' },
      listIds: [listId],
      consentConfirmed: true,
    })
    expect(summary.status).toBe(200)
    expect(summary.body).toMatchObject({ total: 6, created: 4, updated: 0, duplicatesInFile: 1 })
    expect(summary.body.invalid).toEqual([{ row: 7, value: 'not-an-email', reason: 'Not a valid email address' }])

    const page = (await api.get('/contacts?sort=email_asc')).body
    expect(page.total).toBe(4)
    const ada = page.items.find((c: { email: string }) => c.email === 'ada@example.test')
    // The second row for the same address had no name but a newer company.
    expect(ada).toMatchObject({ firstName: 'Ada', company: 'Engines Ltd', status: 'subscribed', consentSource: 'Imported from CSV' })
    expect(ada.tags.map((t: { name: string }) => t.name).sort()).toEqual(['early', 'vip'])
    expect(ada.lists).toMatchObject([{ name: 'Newsletter', status: 'subscribed' }])
  })

  it('refuses an import without the consent confirmation', async () => {
    const response = await api.post('/contacts/import', { csv: 'email\nx@example.test', mapping: { email: 'email' }, consentConfirmed: false })
    expect(response.status).toBe(400)
  })

  it('will not create the same address twice, and says who it is', async () => {
    const response = await api.post('/contacts', { email: 'Grace@Example.test' })
    expect(response.status).toBe(409)
    expect(response.body.error.details.id).toMatch(/^con_/)
  })

  it('answers a segment from its rules', async () => {
    const preview = await api.post('/segments/preview', {
      match: 'all',
      rules: [{ field: 'company', op: 'contains', value: 'nav' }, { field: 'status', op: 'is', value: 'subscribed' }],
    })
    expect(preview.body.count).toBe(1)
    expect(preview.body.sample[0].email).toBe('grace@example.test')

    const tags = (await api.get('/tags')).body as { id: string; name: string }[]
    const vip = tags.find((tag) => tag.name === 'vip')!
    const byTag = await api.post('/segments/preview', { match: 'any', rules: [{ field: 'tag', op: 'has', value: vip.id }] })
    expect(byTag.body.count).toBe(2)
  })

  it('blocks a send until the mailing address is set, then allows it', async () => {
    // One of the four has already unsubscribed: they must not be queued.
    const left = (await api.get('/contacts?q=left@')).body.items[0]
    await api.patch(`/contacts/${left.id}`, { status: 'unsubscribed' })

    const created = await api.post('/campaigns', {
      name: 'October news',
      subject: 'Hello {{first_name|there}}',
      preheader: 'Three things this month',
      html: '<html><body><h1>Hi {{first_name|there}}</h1><p>Read <a href="https://example.com/post?a=1&amp;b=2">the post</a>.</p></body></html>',
      audience: { listIds: [listId] },
    })
    expect(created.status).toBe(201)
    campaignId = created.body.id

    const blocked = await api.post(`/campaigns/${campaignId}/send`, {})
    expect(blocked.status).toBe(422)
    expect(blocked.body.error.message).toMatch(/mailing address/i)

    await api.patch('/settings', { organization: { address1: '1 Main St', city: 'Charlotte', region: 'NC', postalCode: '28202', country: 'USA' } })
    const checks = (await api.get(`/campaigns/${campaignId}/checks`)).body as { key: string; ok: boolean; message: string }[]
    expect(checks.filter((check) => !check.ok)).toEqual([])
    expect(checks.find((check) => check.key === 'audience')!.message).toMatch(/^3 people/)
  })

  it('sends a test without touching the queue or the statistics', async () => {
    const before = catcher.mail.length
    const response = await api.post(`/campaigns/${campaignId}/test`, { to: ['me@example.test'] })
    expect(response.body).toEqual({ sent: ['me@example.test'], failed: [] })
    expect(catcher.mail.length).toBe(before + 1)
    expect(catcher.mail.at(-1)!.raw).toMatch(/Subject: \[Test\] Hello Alex/)
    expect(decodeQp(catcher.mail.at(-1)!.raw)).not.toContain('/t/o/')
    expect((await api.get(`/campaigns/${campaignId}`)).body.stats.recipients).toBe(0)
  })

  it('sends to everyone who can be sent to, and treats a rejected address as a bounce', async () => {
    catcher.mail.length = 0
    const sent = await api.post(`/campaigns/${campaignId}/send`, {})
    expect(sent.status).toBe(200)
    expect(sent.body.status).toBe('sending')

    // The route kicks one pass off itself; a second one runs after it and
    // closes the campaign out.
    await app.worker.tick()
    await app.worker.tick()

    const campaign = (await api.get(`/campaigns/${campaignId}`)).body
    expect(campaign.status).toBe('sent')
    expect(campaign.stats).toMatchObject({ recipients: 3, sent: 2, bounced: 1, queued: 0, failed: 0 })
    expect(catcher.mail.map((mail) => mail.to[0]).sort()).toEqual(['ada@example.test', 'grace@example.test'])

    // The address the server refused is finished: bounced and suppressed.
    const gone = (await api.get('/contacts?q=gone@')).body.items[0]
    expect(gone.status).toBe('bounced')
    expect((await api.get('/suppressions?q=gone@')).body.items[0]).toMatchObject({ reason: 'bounced' })
  })

  it('puts the merge tags, footer, headers and tracking in what actually went out', async () => {
    const mail = catcher.mail.find((entry) => entry.to[0] === 'ada@example.test')!
    const body = decodeQp(mail.raw)
    expect(mail.raw).toMatch(/Subject: Hello Ada/)
    expect(mail.raw).toMatch(/List-Unsubscribe-Post: List-Unsubscribe=One-Click/)
    expect(mail.raw.replace(/\r\n\s+/g, ' ')).toMatch(/List-Unsubscribe: <https:\/\/mail\.example\.test\/api\/v1\/public\/unsubscribe\/[\w-]+\?m=[0-9a-f]+>/)
    expect(body).toContain('<h1>Hi Ada</h1>')
    expect(body).toContain('Three things this month')
    // The compliance footer: who, where, and how to stop.
    expect(body).toContain('<strong>Northwind</strong>')
    expect(body).toContain('1 Main St, Charlotte, NC 28202, USA')
    expect(body).toMatch(/href="https:\/\/mail\.example\.test\/unsubscribe\/[\w-]+\?m=[0-9a-f]+"[^>]*>Unsubscribe/)
    // The outside link goes through the redirect; our own links do not.
    expect(body).toMatch(/href="https:\/\/mail\.example\.test\/t\/c\/[0-9a-f]+\?u=[\w-]+&amp;s=[\w-]+"/)
    expect(body).not.toContain('href="https://example.com/post')
    expect(body).toMatch(/<img src="https:\/\/mail\.example\.test\/t\/o\/[0-9a-f]+\.gif"/)
    // And a plain-text part for clients that want one.
    expect(mail.raw).toMatch(/Content-Type: text\/plain/)
  })

  it('counts an open and a click, and only redirects to links it signed', async () => {
    const body = decodeQp(catcher.mail.find((entry) => entry.to[0] === 'ada@example.test')!.raw)
    const pixel = /\/t\/o\/[0-9a-f]+\.gif/.exec(body)![0]
    const click = /\/t\/c\/[0-9a-f]+\?u=[\w-]+&amp;s=[\w-]+/.exec(body)![0].replace('&amp;', '&')

    const open = await api.get(pixel)
    expect(open.status).toBe(200)
    expect(open.headers['content-type']).toBe('image/gif')
    await api.get(pixel)

    const redirect = await api.get(click)
    expect(redirect.status).toBe(302)
    expect(redirect.headers.location).toBe('https://example.com/post?a=1&b=2')

    const forged = await api.get(click.replace(/u=[\w-]+/, `u=${Buffer.from('https://evil.example').toString('base64url')}`))
    expect(forged.status).toBe(400)

    const campaign = (await api.get(`/campaigns/${campaignId}`)).body
    expect(campaign.stats).toMatchObject({ opened: 1, opens: 2, clicked: 1, clicks: 1 })
    const report = (await api.get(`/campaigns/${campaignId}/report`)).body
    expect(report.links).toEqual([{ url: 'https://example.com/post?a=1&b=2', clicks: 1, people: 1 }])

    const ada = (await api.get('/contacts?q=ada@')).body.items[0]
    const activity = (await api.get(`/contacts/${ada.id}/activity`)).body as { type: string }[]
    expect(activity.map((event) => event.type)).toEqual(expect.arrayContaining(['imported', 'sent', 'opened', 'clicked']))
  })

  it('unsubscribes on a one-click POST, never on a GET, and makes it stick', async () => {
    const raw = catcher.mail.find((entry) => entry.to[0] === 'grace@example.test')!.raw.replace(/\r\n\s+/g, ' ')
    const url = /List-Unsubscribe: <https:\/\/mail\.example\.test(\/api\/v1\/public\/unsubscribe\/[^>]+)>/.exec(raw)![1]!
    const stranger = client(app)

    // A scanner following the link lands on the page and changes nothing.
    const get = await app.inject({ method: 'GET', url })
    expect(get.statusCode).toBe(302)
    expect((await api.get('/contacts?q=grace@')).body.items[0].status).toBe('subscribed')

    const post = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' })
    expect(post.statusCode).toBe(200)
    void stranger

    const grace = (await api.get('/contacts?q=grace@')).body.items[0]
    expect(grace.status).toBe('unsubscribed')
    expect((await api.get(`/campaigns/${campaignId}`)).body.stats.unsubscribed).toBe(1)

    // Re-importing the address does not bring them back.
    const again = await api.post('/contacts/import', { csv: 'email\ngrace@example.test', mapping: { email: 'email' }, listIds: [listId], consentConfirmed: true })
    expect(again.body).toMatchObject({ created: 0, updated: 1, suppressed: 1 })
    expect((await api.get('/contacts?q=grace@')).body.items[0].status).toBe('unsubscribed')

    const estimate = await api.post('/audience/estimate', { listIds: [listId] })
    expect(estimate.body.sendable).toBe(1)
  })

  it('cannot be edited once it has gone out', async () => {
    const response = await api.patch(`/campaigns/${campaignId}`, { subject: 'Changed my mind' })
    expect(response.status).toBe(409)
  })
})
