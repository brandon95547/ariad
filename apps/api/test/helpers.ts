import { SMTPServer } from 'smtp-server'
import type { FastifyInstance } from 'fastify'
import type { AddressInfo } from 'node:net'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { Mailer, type SmtpCredentials } from '../src/services/mailer.js'
import type { VerifyResult } from '@ariad/shared'

export interface CaughtMail {
  from: string
  to: string[]
  raw: string
}

/**
 * A real SMTP server on a spare local port. Mail sent to it goes nowhere and
 * is kept, so a test can read exactly what would have reached an inbox —
 * headers, footer, tracking links and all.
 */
export async function startCatcher(options: { rejectRecipient?: RegExp } = {}) {
  const mail: CaughtMail[] = []
  const server = new SMTPServer({
    secure: false,
    disabledCommands: ['STARTTLS'],
    allowInsecureAuth: true,
    logger: false,
    onAuth(auth, _session, callback) {
      if (auth.username === 'sender' && auth.password === 'right-password') callback(null, { user: 'sender' })
      else callback(Object.assign(new Error('535 5.7.8 Username and Password not accepted'), { responseCode: 535 }))
    },
    onRcptTo(address, _session, callback) {
      if (options.rejectRecipient?.test(address.address)) {
        callback(Object.assign(new Error('5.1.1 The email account that you tried to reach does not exist'), { responseCode: 550 }))
      } else callback()
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => {
        mail.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((rcpt) => rcpt.address),
          raw: Buffer.concat(chunks).toString('utf8'),
        })
        callback()
      })
    },
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.server.address() as AddressInfo).port
  return { mail, port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

/** Gmail cannot be reached from a test, so its sign-in is answered here. */
class TestMailer extends Mailer {
  override async verify(account: SmtpCredentials): Promise<VerifyResult> {
    if (account.host === 'smtp.gmail.com') {
      return account.password === 'abcdabcdabcdabcd'
        ? { ok: true, message: 'Connected and signed in.' }
        : { ok: false, message: 'Google did not accept that address and app password.' }
    }
    return super.verify(account)
  }
}

export async function startApp(): Promise<FastifyInstance> {
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', LOG_LEVEL: 'silent', APP_URL: 'https://mail.example.test' })
  const app = await buildApp(config, { mailer: new TestMailer() })
  await app.ready()
  return app
}

/** A signed-in client: keeps the session cookie and speaks JSON. */
export function client(app: FastifyInstance) {
  let cookie = ''
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) => {
    const response = await app.inject({
      method,
      url: url.startsWith('/t/') ? url : `/api/v1${url}`,
      payload: body === undefined ? undefined : (body as object),
      headers: cookie ? { cookie } : {},
    })
    const set = response.headers['set-cookie']
    if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!
    const text = response.body
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = text
    }
    return { status: response.statusCode, body: json, headers: response.headers }
  }
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, body?: unknown) => call('POST', url, body ?? {}),
    patch: (url: string, body?: unknown) => call('PATCH', url, body ?? {}),
    delete: (url: string) => call('DELETE', url),
  }
}

/** Decodes a quoted-printable body so links in it can be read. */
export function decodeQp(raw: string): string {
  return raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}
