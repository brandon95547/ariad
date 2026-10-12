import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { client, setupOwner, startApp } from './helpers.js'

/** A 1×1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

describe('image uploads', () => {
  let app: FastifyInstance
  let api: ReturnType<typeof client>
  const written: string[] = []

  beforeAll(async () => {
    app = await startApp()
    api = client(app)
    await setupOwner(api)
  })

  afterAll(async () => {
    for (const file of written) fs.rmSync(file, { force: true })
    await app.close()
  })

  it('stores an image under its own hash and serves it to anyone', async () => {
    const upload = await api.post('/uploads', {
      filename: 'logo.png',
      data: `data:image/png;base64,${PNG.toString('base64')}`,
    })
    expect(upload.status).toBe(200)
    expect(upload.body.url).toMatch(/^https:\/\/mail\.example\.test\/media\/[0-9a-f]{24}\.png$/)
    written.push(path.join(app.ctx.config.dataDir, 'uploads', path.basename(upload.body.path)))

    // No session: the recipient's mail app is the one asking.
    const fetched = await app.inject({ method: 'GET', url: upload.body.path })
    expect(fetched.statusCode).toBe(200)
    expect(fetched.headers['content-type']).toBe('image/png')
    expect(fetched.rawPayload.equals(PNG)).toBe(true)

    // The same picture again is the same file.
    const again = await api.post('/uploads', {
      filename: 'other-name.png',
      data: PNG.toString('base64'),
    })
    expect(again.body.url).toBe(upload.body.url)
  })

  it('goes by what the file is, not what it is called', async () => {
    const response = await api.post('/uploads', {
      filename: 'totally-a.png',
      data: Buffer.from('<script>alert(1)</script>').toString('base64'),
    })
    expect(response.status).toBe(400)
    expect(response.body.error.message).toMatch(/PNG, JPEG, GIF or WebP/)
  })

  it('serves nothing but the names it made up', async () => {
    for (const url of ['/media/..%2Fsecret.key', '/media/secret.key', '/media/ariad.sqlite']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404)
    }
  })

  it('needs a signed-in editor to upload', async () => {
    expect(
      (await client(app).post('/uploads', { filename: 'a.png', data: PNG.toString('base64') }))
        .status,
    ).toBe(401)
  })
})
