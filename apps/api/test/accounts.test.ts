import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { client, startApp, startCatcher } from './helpers.js'

/**
 * Sending accounts: the first thing anyone sets up, and the one place a
 * credential is stored. These run against a real SMTP server on localhost.
 */
describe('sending accounts', () => {
  let app: FastifyInstance
  let catcher: Awaited<ReturnType<typeof startCatcher>>
  let api: ReturnType<typeof client>

  beforeAll(async () => {
    app = await startApp()
    catcher = await startCatcher()
    api = client(app)
    const setup = await api.post('/auth/setup', { name: 'Brandon', email: 'owner@example.test', password: 'correct horse', organization: 'Northwind' })
    expect(setup.status).toBe(200)
  })

  afterAll(async () => {
    await app.close()
    await catcher.close()
  })

  const smtp = (overrides: Record<string, unknown> = {}) => ({
    kind: 'smtp',
    label: 'Local catcher',
    host: '127.0.0.1',
    port: catcher.port,
    security: 'none',
    username: 'sender',
    password: 'right-password',
    fromName: 'Northwind',
    fromEmail: 'news@northwind.test',
    ...overrides,
  })

  it('is closed to anyone who is not signed in', async () => {
    const anonymous = client(app)
    expect((await anonymous.get('/sending-accounts')).status).toBe(401)
    expect((await anonymous.post('/sending-accounts', smtp())).status).toBe(401)
  })

  it('adds an SMTP account, signs in with it and makes the first one the default', async () => {
    const response = await api.post('/sending-accounts', smtp())
    expect(response.status).toBe(201)
    expect(response.body.verify).toMatchObject({ ok: true })
    expect(response.body.account).toMatchObject({ kind: 'smtp', status: 'ok', isDefault: true, enabled: true, fromEmail: 'news@northwind.test' })
    // The password is not in the response in any form.
    expect(JSON.stringify(response.body)).not.toContain('right-password')
    expect(response.body.account.password).toBeUndefined()
  })

  it('stores the password encrypted, not in the clear', async () => {
    const row = app.ctx.db.prepare("SELECT password_enc FROM sending_accounts WHERE label = 'Local catcher'").get() as { password_enc: string }
    expect(row.password_enc).toMatch(/^v1:/)
    expect(row.password_enc).not.toContain('right-password')
    expect(app.ctx.secrets.decrypt(row.password_enc)).toBe('right-password')
  })

  it('keeps an account whose password is wrong, and says what to fix', async () => {
    const response = await api.post('/sending-accounts', smtp({ label: 'Typo', fromEmail: 'typo@northwind.test', password: 'wrong' }))
    expect(response.status).toBe(201)
    expect(response.body.verify.ok).toBe(false)
    expect(response.body.verify.message).toMatch(/did not accept the username and password/i)
    expect(response.body.account).toMatchObject({ status: 'error', isDefault: false })

    // Correcting the password re-verifies and clears the error.
    const fixed = await api.patch(`/sending-accounts/${response.body.account.id}`, { password: 'right-password' })
    expect(fixed.body.verify).toMatchObject({ ok: true })
    expect(fixed.body.account).toMatchObject({ status: 'ok', lastError: null })
  })

  it('explains a host that is not there', async () => {
    const response = await api.post('/sending-accounts', smtp({ label: 'Nowhere', fromEmail: 'nowhere@northwind.test', port: 1 }))
    expect(response.body.verify.ok).toBe(false)
    expect(response.body.verify.message).toMatch(/Could not connect to 127\.0\.0\.1:1|No answer from/)
  })

  it('adds a Gmail account from an address and an app password pasted with its spaces', async () => {
    const response = await api.post('/sending-accounts', { kind: 'gmail', email: 'Brandon@Gmail.com', appPassword: 'abcd abcd abcd abcd', fromName: 'Brandon' })
    expect(response.status).toBe(201)
    expect(response.body.account).toMatchObject({
      kind: 'gmail',
      host: 'smtp.gmail.com',
      port: 465,
      security: 'ssl',
      username: 'brandon@gmail.com',
      fromEmail: 'brandon@gmail.com',
      dailyLimit: 500,
      status: 'ok',
    })
    const row = app.ctx.db.prepare("SELECT password_enc FROM sending_accounts WHERE kind = 'gmail'").get() as { password_enc: string }
    expect(app.ctx.secrets.decrypt(row.password_enc)).toBe('abcdabcdabcdabcd')
  })

  it('refuses something that is plainly a Google sign-in password, before saving it', async () => {
    const response = await api.post('/sending-accounts', { kind: 'gmail', email: 'other@gmail.com', appPassword: 'MyRealPassword!23', fromName: 'Other' })
    expect(response.status).toBe(400)
    expect(response.body.error.message).toMatch(/app password is 16 letters/i)
  })

  it('will not connect the same mailbox twice', async () => {
    const response = await api.post('/sending-accounts', smtp())
    expect(response.status).toBe(409)
  })

  it('sends a real test email through the account', async () => {
    const accounts = (await api.get('/sending-accounts')).body as { id: string; label: string }[]
    const id = accounts.find((account) => account.label === 'Local catcher')!.id
    const before = catcher.mail.length
    const response = await api.post(`/sending-accounts/${id}/test`, { to: 'me@example.test' })
    expect(response.body).toMatchObject({ ok: true })
    expect(catcher.mail.length).toBe(before + 1)
    const mail = catcher.mail.at(-1)!
    expect(mail.to).toEqual(['me@example.test'])
    expect(mail.raw).toMatch(/From: Northwind <news@northwind\.test>/)
    expect(mail.raw).toMatch(/Subject: Test email from Northwind/)
  })

  it('moves the default, and hands it on when the default is removed', async () => {
    const accounts = (await api.get('/sending-accounts')).body as { id: string; label: string; isDefault: boolean }[]
    const typo = accounts.find((account) => account.label === 'Typo')!
    const made = await api.post(`/sending-accounts/${typo.id}/default`)
    expect(made.body.isDefault).toBe(true)
    expect(((await api.get('/sending-accounts')).body as { isDefault: boolean }[]).filter((a) => a.isDefault)).toHaveLength(1)

    expect((await api.delete(`/sending-accounts/${typo.id}`)).status).toBe(200)
    const after = (await api.get('/sending-accounts')).body as { label: string; isDefault: boolean }[]
    expect(after.find((account) => account.label === 'Typo')).toBeUndefined()
    expect(after.filter((account) => account.isDefault)).toHaveLength(1)
  })

  it('lets a viewer see accounts but not change them', async () => {
    await api.post('/users', { name: 'Vee', email: 'viewer@example.test', role: 'viewer', password: 'password123' })
    const viewer = client(app)
    await viewer.post('/auth/login', { email: 'viewer@example.test', password: 'password123' })
    expect((await viewer.get('/sending-accounts')).status).toBe(200)
    expect((await viewer.post('/sending-accounts', smtp({ label: 'Nope', fromEmail: 'nope@northwind.test' }))).status).toBe(403)
  })
})
