import nodemailer, { type Transporter } from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js'
import type SMTPPool from 'nodemailer/lib/smtp-pool/index.js'
import type { SmtpSecurity, VerifyResult } from '@ariad/shared'

/**
 * The only file that talks SMTP.
 *
 * Gmail is not special here. A Gmail account is an SMTP account whose host,
 * port and security are known in advance; the one thing that is Gmail-specific
 * is how its errors are explained, because "535-5.7.8" means nothing to the
 * person who just pasted the wrong password.
 */
export interface SmtpCredentials {
  id: string
  kind: 'gmail' | 'smtp'
  host: string
  port: number
  security: SmtpSecurity
  username: string
  password: string
}

export interface OutgoingMail {
  from: { name: string; address: string }
  to: string
  replyTo?: string | null
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
  /** The envelope sender. Bounces come back to it. */
  returnPath?: string
}

export interface SendResult {
  messageId: string
  response: string
}

function baseOptions(account: SmtpCredentials): SMTPTransport.Options {
  return {
    host: account.host,
    port: account.port,
    // `secure` is TLS from the first byte (port 465). STARTTLS begins in the
    // clear and upgrades, and `requireTLS` is what stops it carrying on in the
    // clear when the upgrade is refused.
    secure: account.security === 'ssl',
    requireTLS: account.security === 'starttls',
    ignoreTLS: account.security === 'none',
    auth: account.username ? { user: account.username, pass: account.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 45_000,
  }
}

/**
 * One pooled connection set per account, rebuilt when the account changes.
 * Opening a fresh TLS session per message is slow and is exactly the pattern
 * providers throttle.
 */
export class Mailer {
  private readonly pools = new Map<string, { stamp: string; transport: Transporter }>()

  /** `stamp` is the account's updated_at: any edit gets a fresh connection. */
  private pool(account: SmtpCredentials, stamp: string): Transporter {
    const cached = this.pools.get(account.id)
    if (cached && cached.stamp === stamp) return cached.transport
    cached?.transport.close()
    const options: SMTPPool.Options = {
      ...baseOptions(account),
      pool: true,
      maxConnections: 2,
      maxMessages: 100,
    }
    const transport = nodemailer.createTransport(options)
    this.pools.set(account.id, { stamp, transport })
    return transport
  }

  async send(account: SmtpCredentials, stamp: string, mail: OutgoingMail): Promise<SendResult> {
    const info = await this.pool(account, stamp).sendMail({
      from: mail.from,
      to: mail.to,
      replyTo: mail.replyTo || undefined,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: mail.headers,
      envelope: mail.returnPath ? { from: mail.returnPath, to: mail.to } : undefined,
    })
    return { messageId: String(info.messageId ?? ''), response: String(info.response ?? '') }
  }

  /** Signs in and stops. Proves the host, port, security and credentials. */
  async verify(account: SmtpCredentials): Promise<VerifyResult> {
    const transport = nodemailer.createTransport(baseOptions(account))
    try {
      await transport.verify()
      return { ok: true, message: 'Connected and signed in.' }
    } catch (error) {
      return { ok: false, message: explainSmtpError(error, account), detail: rawMessage(error) }
    } finally {
      transport.close()
    }
  }

  forget(accountId: string): void {
    this.pools.get(accountId)?.transport.close()
    this.pools.delete(accountId)
  }

  closeAll(): void {
    for (const { transport } of this.pools.values()) transport.close()
    this.pools.clear()
  }
}

interface SmtpError {
  code?: string
  responseCode?: number
  response?: string
  command?: string
  message?: string
}

function rawMessage(error: unknown): string {
  const e = error as SmtpError
  return (e.response || e.message || String(error)).slice(0, 500)
}

/** What went wrong, in terms of what the person should change. */
export function explainSmtpError(
  error: unknown,
  account: Pick<SmtpCredentials, 'kind' | 'host' | 'port' | 'security'>,
): string {
  const e = error as SmtpError
  const text = `${e.response ?? ''} ${e.message ?? ''}`.toLowerCase()
  const where = `${account.host}:${account.port}`

  if (e.code === 'EAUTH' || e.responseCode === 535 || e.responseCode === 534) {
    if (account.kind === 'gmail') {
      if (text.includes('application-specific password') || text.includes('5.7.9')) {
        return 'Google needs an app password for this account. Your normal Google password will not work: turn on 2-Step Verification, then create an app password at myaccount.google.com/apppasswords.'
      }
      return 'Google did not accept that address and app password. Check the Gmail address, and make sure the password is a 16-letter app password from myaccount.google.com/apppasswords — not the password you sign in to Google with.'
    }
    return 'The server did not accept the username and password.'
  }
  if (e.code === 'EDNS' || text.includes('enotfound') || text.includes('getaddrinfo')) {
    return `The host name "${account.host}" could not be found. Check the spelling.`
  }
  if (
    text.includes('wrong version number') ||
    text.includes('ssl routines') ||
    text.includes('tls_validate_record_header')
  ) {
    return account.security === 'ssl'
      ? `The server at ${where} did not answer with TLS. Port 465 uses SSL/TLS; port 587 and 25 use STARTTLS.`
      : `The security setting does not match port ${account.port}. Port 465 uses SSL/TLS; port 587 and 25 use STARTTLS.`
  }
  if (text.includes('starttls') || (e.code === 'ETLS' && account.security === 'starttls')) {
    return `The server at ${where} does not offer STARTTLS. Try SSL/TLS on port 465.`
  }
  if (
    text.includes('certificate') ||
    text.includes('self-signed') ||
    text.includes('self signed')
  ) {
    return `The server's TLS certificate could not be verified (${e.message ?? 'certificate error'}).`
  }
  if (e.code === 'ETIMEDOUT' || text.includes('timeout') || text.includes('timed out')) {
    return `No answer from ${where}. Check the host and port. Some networks and hosting providers block outgoing SMTP.`
  }
  if (
    e.code === 'ECONNECTION' ||
    e.code === 'ESOCKET' ||
    text.includes('econnrefused') ||
    text.includes('econnreset')
  ) {
    return `Could not connect to ${where}. Check the host and port.`
  }
  return rawMessage(error)
}

/**
 * What a failed send means for the message and for the account.
 *
 *   account   the account itself cannot send (sign-in, connection): stop
 *             using it, leave the mail queued, tell someone
 *   throttle  the provider said slow down or stop for today: wait, no retry
 *             is counted against the message
 *   retry     a temporary refusal: try this message again later
 *   bounce    this address does not exist: never send to it again
 *   fail      refused for good, for a reason that is not the address
 */
export type SendFailure =
  | { kind: 'account'; message: string }
  | { kind: 'throttle'; message: string; pauseMs: number }
  | { kind: 'retry'; message: string }
  | { kind: 'bounce'; message: string }
  | { kind: 'fail'; message: string }

const BAD_MAILBOX =
  /user unknown|unknown user|no such user|no such mailbox|mailbox (not found|unavailable|does not exist)|does not exist|recipient (address )?rejected|invalid recipient|address rejected|unknown recipient|account (has been )?disabled|no mailbox here|user doesn'?t exist/i

const QUOTA =
  /daily (user )?sending (limit|quota)|sending limit|quota exceeded|rate limit|too many (messages|emails|recipients)|limit exceeded|5\.4\.5|4\.5\.3|4\.7\.28|throttl/i

export function classifySendError(
  error: unknown,
  account: Pick<SmtpCredentials, 'kind' | 'host' | 'port' | 'security'>,
): SendFailure {
  const e = error as SmtpError
  const raw = rawMessage(error)
  const code = e.responseCode ?? 0

  if (e.code === 'EAUTH' || code === 535 || code === 534 || code === 530) {
    return { kind: 'account', message: explainSmtpError(error, account) }
  }
  if (
    ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS', 'ECONNREFUSED', 'ECONNRESET'].includes(
      e.code ?? '',
    ) &&
    !code
  ) {
    return { kind: 'account', message: explainSmtpError(error, account) }
  }
  // Checked before the generic 5xx rules: Gmail reports "you have hit your
  // daily limit" as a 550, and treating that as a bad address would suppress
  // a perfectly good contact.
  if (QUOTA.test(raw)) {
    return {
      kind: 'throttle',
      message: raw,
      pauseMs: /daily|quota|5\.4\.5/i.test(raw) ? 3_600_000 : 600_000,
    }
  }
  if (code >= 400 && code < 500) return { kind: 'retry', message: raw }
  if (code >= 500) {
    const enhanced = /\b5\.(\d)\.(\d+)\b/.exec(raw)
    const badAddress =
      (enhanced && enhanced[1] === '1' && ['1', '2', '3', '6', '10'].includes(enhanced[2]!)) ||
      BAD_MAILBOX.test(raw)
    return badAddress ? { kind: 'bounce', message: raw } : { kind: 'fail', message: raw }
  }
  if (e.code === 'EENVELOPE') return { kind: 'bounce', message: raw }
  return { kind: 'retry', message: raw }
}
