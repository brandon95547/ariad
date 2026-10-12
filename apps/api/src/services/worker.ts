import { withPreheader, type QueueStatus } from '@ariad/shared'
import type { Ctx } from '../context.js'
import { nowIso } from '../lib/crypto.js'
import { credentialsOf, defaultAccountRow, type AccountRow } from './accounts.js'
import { advanceDueRuns, scanScheduledTriggers } from './automations.js'
import { finishCampaigns, getCampaignRow, startDueCampaigns, type CampaignRow } from './campaigns.js'
import { markUndeliverable, suppressionOf, type ContactRow } from './contacts.js'
import { pruneLogs, writeLog } from './logs.js'
import { classifySendError, type Mailer } from './mailer.js'
import { renderEmail, type RenderSource } from './render.js'
import { getSettings, publicUrl } from './settings.js'

/**
 * The background sender.
 *
 * One pass every few seconds: start campaigns that are due, move automations
 * along, send what the accounts' limits allow, and close out campaigns with
 * nothing left to send. It lives in the API process — one process, one SQLite
 * file — and everything it does is a row it read, so stopping it mid-pass
 * leaves the work where it was.
 */
const TICK_MS = 5_000
const SCAN_EVERY_MS = 5 * 60_000
const HOUSEKEEPING_EVERY_MS = 6 * 3_600_000
/** How long a message may sit in `sending` before it is assumed abandoned. */
const STUCK_AFTER_MS = 10 * 60_000
/** Minutes to wait before attempt 2, 3, 4… */
const BACKOFF_MINUTES = [1, 5, 30, 120, 360]

export interface MessageRow {
  id: string
  kind: 'campaign' | 'automation' | 'test' | 'system'
  campaign_id: string | null
  automation_id: string | null
  contact_id: string | null
  to_email: string
  account_id: string | null
  subject: string | null
  html: string | null
  attempts: number
  token: string
}

export class Worker {
  private timer: NodeJS.Timeout | null = null
  private running: Promise<void> | null = null
  private lastTickAt: string | null = null
  private lastScanAt = 0
  private lastHousekeepingAt = 0

  constructor(
    private readonly ctx: Ctx,
    private readonly mailer: Mailer,
  ) {}

  start(): void {
    if (this.timer) return
    // Anything marked `sending` belonged to a process that is gone.
    this.ctx.db.prepare("UPDATE messages SET status = 'queued' WHERE status = 'sending'").run()
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref()
    this.ctx.log.info({ scope: 'worker' }, 'background sender started')
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.running
  }

  status(): { running: boolean; lastTickAt: string | null } {
    return { running: this.timer !== null, lastTickAt: this.lastTickAt }
  }

  /**
   * One pass. Never overlaps itself: a slow SMTP server skips passes, it does
   * not stack them. Called while a pass is running, it waits for that one.
   */
  async tick(): Promise<void> {
    if (this.running) return this.running
    this.running = this.pass().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async pass(): Promise<void> {
    const { ctx } = this
    try {
      this.lastTickAt = nowIso()
      startDueCampaigns(ctx)

      if (Date.now() - this.lastScanAt > SCAN_EVERY_MS) {
        this.lastScanAt = Date.now()
        scanScheduledTriggers(ctx)
      }
      advanceDueRuns(ctx)

      await this.sendDue()
      finishCampaigns(ctx)

      if (Date.now() - this.lastHousekeepingAt > HOUSEKEEPING_EVERY_MS) {
        this.lastHousekeepingAt = Date.now()
        pruneLogs(ctx.db)
        ctx.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso())
      }
    } catch (error) {
      ctx.log.error({ err: error, scope: 'worker' }, 'worker pass failed')
    }
  }

  private async sendDue(): Promise<void> {
    const { db } = this.ctx
    const now = nowIso()

    db.prepare("UPDATE messages SET status = 'queued' WHERE status = 'sending' AND next_attempt_at < ?").run(
      new Date(Date.now() - STUCK_AFTER_MS).toISOString(),
    )
    // Mail queued before any account existed, or whose account was deleted.
    const fallback = defaultAccountRow(this.ctx)
    if (fallback) {
      db.prepare("UPDATE messages SET account_id = ? WHERE status = 'queued' AND account_id IS NULL").run(fallback.id)
    }

    const accounts = db
      .prepare('SELECT * FROM sending_accounts WHERE enabled = 1 AND (paused_until IS NULL OR paused_until <= ?)')
      .all(now) as AccountRow[]
    // Accounts are independent mailboxes with independent limits, so they
    // send side by side; within one account, mail goes one at a time.
    await Promise.all(accounts.map((account) => this.sendFor(account)))
  }

  /** How many this account may send right now, by its own two limits. */
  private allowance(account: AccountRow): number {
    const { db } = this.ctx
    const count = (sinceMs: number) =>
      (
        db
          .prepare('SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND sent_at >= ?')
          .get(account.id, new Date(Date.now() - sinceMs).toISOString()) as { n: number }
      ).n
    const perPass = Math.max(1, Math.ceil((account.per_minute * TICK_MS) / 60_000))
    return Math.max(
      0,
      Math.min(perPass, account.per_minute - count(60_000), account.daily_limit - count(86_400_000)),
    )
  }

  private async sendFor(account: AccountRow): Promise<void> {
    const { db } = this.ctx
    const limit = this.allowance(account)
    if (limit === 0) return

    const messages = db
      .prepare(
        /* sql */ `SELECT m.* FROM messages m LEFT JOIN campaigns c ON c.id = m.campaign_id
                   WHERE m.status = 'queued' AND m.account_id = ? AND m.next_attempt_at <= ?
                     AND (m.campaign_id IS NULL OR c.status = 'sending')
                   ORDER BY m.priority DESC, m.next_attempt_at ASC LIMIT ?`,
      )
      .all(account.id, nowIso(), limit) as MessageRow[]

    for (const message of messages) {
      const keepGoing = await this.sendOne(account, message)
      if (!keepGoing) break
    }
  }

  /** Returns false when the account should stop for now. */
  private async sendOne(account: AccountRow, message: MessageRow): Promise<boolean> {
    const { ctx } = this
    const { db } = ctx
    const now = nowIso()

    const contact = message.contact_id
      ? (db.prepare('SELECT * FROM contacts WHERE id = ?').get(message.contact_id) as ContactRow | undefined)
      : undefined
    const marketing = message.kind === 'campaign' || message.kind === 'automation'

    // Checked at the last moment, not when the message was queued: someone
    // who unsubscribed an hour into a two-day send must not get the email.
    if (marketing) {
      const blocked = !contact
        ? 'Contact was deleted'
        : contact.status !== 'subscribed'
          ? `Contact is ${contact.status}`
          : suppressionOf(db, contact.email)
            ? 'Address is suppressed'
            : null
      if (blocked) {
        db.prepare("UPDATE messages SET status = 'canceled', last_error = ? WHERE id = ?").run(blocked, message.id)
        return true
      }
    }

    let source: RenderSource
    try {
      source = this.sourceFor(message)
    } catch (error) {
      db.prepare("UPDATE messages SET status = 'failed', last_error = ? WHERE id = ?").run(String((error as Error).message), message.id)
      return true
    }

    db.prepare("UPDATE messages SET status = 'sending', next_attempt_at = ? WHERE id = ?").run(now, message.id)
    const mail = renderEmail(ctx, {
      source,
      account,
      contact: contact ?? null,
      toEmail: message.to_email,
      messageToken: message.token,
      settings: getSettings(db),
      baseUrl: publicUrl(ctx),
      test: message.kind === 'test',
    })

    try {
      const result = await this.mailer.send(credentialsOf(ctx, account), account.updated_at, mail)
      const sentAt = nowIso()
      db.prepare(
        "UPDATE messages SET status = 'sent', sent_at = ?, smtp_id = ?, attempts = attempts + 1, last_error = NULL, subject = COALESCE(subject, ?) WHERE id = ?",
      ).run(sentAt, result.messageId, mail.subject, message.id)
      if (contact && marketing) db.prepare('UPDATE contacts SET last_sent_at = ? WHERE id = ?').run(sentAt, contact.id)
      if (account.status !== 'ok') {
        db.prepare("UPDATE sending_accounts SET status = 'ok', last_error = NULL WHERE id = ?").run(account.id)
      }
      return true
    } catch (error) {
      return this.handleFailure(account, message, contact, error)
    }
  }

  private handleFailure(account: AccountRow, message: MessageRow, contact: ContactRow | undefined, error: unknown): boolean {
    const { db } = this.ctx
    const failure = classifySendError(error, account)
    const requeue = () => db.prepare("UPDATE messages SET status = 'queued', last_error = ? WHERE id = ?").run(failure.message, message.id)

    switch (failure.kind) {
      case 'account': {
        // The message is fine; the mailbox is not. Leave the mail where it is
        // and look again in ten minutes, in case it was a passing outage.
        requeue()
        db.prepare("UPDATE sending_accounts SET status = 'error', last_error = ?, paused_until = ? WHERE id = ?").run(
          failure.message,
          new Date(Date.now() + 10 * 60_000).toISOString(),
          account.id,
        )
        this.mailer.forget(account.id)
        writeLog(db, 'error', 'smtp', `${account.from_email} cannot send: ${failure.message}`, { accountId: account.id })
        return false
      }
      case 'throttle': {
        requeue()
        db.prepare('UPDATE sending_accounts SET paused_until = ?, last_error = ? WHERE id = ?').run(
          new Date(Date.now() + failure.pauseMs).toISOString(),
          failure.message,
          account.id,
        )
        writeLog(db, 'warn', 'smtp', `${account.from_email} was told to slow down; pausing for ${Math.round(failure.pauseMs / 60_000)} minutes`, {
          accountId: account.id,
          response: failure.message,
        })
        return false
      }
      case 'retry': {
        const attempts = message.attempts + 1
        const maxAttempts = getSettings(db).sending.maxAttempts
        if (attempts >= maxAttempts) {
          db.prepare("UPDATE messages SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?").run(attempts, failure.message, message.id)
          writeLog(db, 'warn', 'queue', `Gave up on ${message.to_email} after ${attempts} attempts`, { error: failure.message })
        } else {
          const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]! * 60_000
          db.prepare("UPDATE messages SET status = 'queued', attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?").run(
            attempts,
            failure.message,
            new Date(Date.now() + wait).toISOString(),
            message.id,
          )
        }
        return true
      }
      case 'bounce': {
        const now = nowIso()
        db.prepare("UPDATE messages SET status = 'bounced', bounced_at = ?, attempts = attempts + 1, last_error = ? WHERE id = ?").run(now, failure.message, message.id)
        db.prepare(
          "INSERT INTO message_events (message_id, campaign_id, contact_id, type, url, created_at) VALUES (?, ?, ?, 'bounce', ?, ?)",
        ).run(message.id, message.campaign_id, message.contact_id, failure.message.slice(0, 500), now)
        if (contact) markUndeliverable(db, contact.id, 'bounced', failure.message)
        return true
      }
      case 'fail': {
        db.prepare("UPDATE messages SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?").run(failure.message, message.id)
        writeLog(db, 'warn', 'queue', `${message.to_email} was refused: ${failure.message}`, { messageId: message.id })
        return true
      }
    }
  }

  /** Where a message's subject and body come from. */
  private sourceFor(message: MessageRow): RenderSource {
    if (message.kind === 'campaign') {
      if (!message.campaign_id) throw new Error('The campaign no longer exists.')
      return campaignSource(getCampaignRow(this.ctx.db, message.campaign_id))
    }
    const settings = getSettings(this.ctx.db)
    return {
      subject: message.subject ?? '',
      html: message.html ?? '',
      fromName: null,
      fromEmail: null,
      replyTo: null,
      trackOpens: message.kind === 'automation' && settings.sending.trackOpens,
      trackClicks: message.kind === 'automation' && settings.sending.trackClicks,
      marketing: message.kind === 'automation',
    }
  }

  queueStatus(): QueueStatus {
    const { db } = this.ctx
    const now = nowIso()
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
    const row = db
      .prepare(
        /* sql */ `SELECT
          SUM(status = 'queued' AND attempts = 0) AS queued,
          SUM(status = 'sending') AS sending,
          SUM(status = 'queued' AND attempts > 0) AS retrying,
          SUM(status = 'failed' AND queued_at >= @dayAgo) AS failed,
          SUM(status = 'sent' AND sent_at >= @dayAgo) AS sent
         FROM messages WHERE status IN ('queued','sending') OR queued_at >= @dayAgo OR sent_at >= @dayAgo`,
      )
      .get({ dayAgo, now }) as Record<string, number | null>
    return {
      queued: row.queued ?? 0,
      sending: row.sending ?? 0,
      retrying: row.retrying ?? 0,
      failedLast24h: row.failed ?? 0,
      sentLast24h: row.sent ?? 0,
      lastTickAt: this.lastTickAt,
    }
  }
}

export function campaignSource(row: CampaignRow): RenderSource {
  return {
    subject: row.subject,
    html: withPreheader(row.html, row.design ? null : row.preheader),
    fromName: row.from_name,
    fromEmail: row.from_email,
    replyTo: row.reply_to,
    trackOpens: row.track_opens === 1,
    trackClicks: row.track_clicks === 1,
    marketing: true,
  }
}
