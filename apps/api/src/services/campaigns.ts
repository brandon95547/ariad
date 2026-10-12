import {
  EMPTY_AUDIENCE,
  EMPTY_STATS,
  formatAddress,
  type AudienceEstimate,
  type Campaign,
  type CampaignAudience,
  type CampaignCheck,
  type CampaignStats,
  type CampaignStatus,
  type CampaignSummary,
  type EmailDesign,
} from '@ariad/shared'
import type { Ctx } from '../context.js'
import { parseJson, placeholders, type Db } from '../db/index.js'
import { AppError } from '../errors.js'
import { nowIso } from '../lib/crypto.js'
import { defaultAccountRow, type AccountRow } from './accounts.js'
import { writeLog } from './logs.js'
import { compileSegment, loadSegment, type Compiled } from './segments.js'
import { getSettings, isLocalUrl, publicUrl } from './settings.js'

export interface CampaignRow {
  id: string
  name: string
  subject: string
  preheader: string | null
  from_name: string | null
  from_email: string | null
  reply_to: string | null
  account_id: string | null
  audience: string
  html: string
  design: string | null
  status: CampaignStatus
  scheduled_at: string | null
  started_at: string | null
  finished_at: string | null
  track_opens: number
  track_clicks: number
  created_at: string
  updated_at: string
}

const STATS_COLUMNS = /* sql */ `
    COUNT(*) AS recipients,
    SUM(status IN ('queued','sending')) AS queued,
    SUM(status = 'sent') AS sent,
    SUM(status = 'failed') AS failed,
    SUM(status = 'bounced') AS bounced,
    SUM(opened_at IS NOT NULL) AS opened,
    SUM(open_count) AS opens,
    SUM(clicked_at IS NOT NULL) AS clicked,
    SUM(click_count) AS clicks,
    SUM(unsubscribed_at IS NOT NULL) AS unsubscribed,
    SUM(complained_at IS NOT NULL) AS complained`

type StatsRow = Omit<CampaignStats, 'delivered'> & { id?: string }

const toStats = (row: StatsRow | undefined): CampaignStats =>
  row
    ? {
        recipients: row.recipients ?? 0,
        queued: row.queued ?? 0,
        sent: row.sent ?? 0,
        failed: row.failed ?? 0,
        bounced: row.bounced ?? 0,
        // "Sent" is the mail server accepting it; a later bounce moves the
        // message out of that state, so what is left is what was delivered.
        delivered: row.sent ?? 0,
        opened: row.opened ?? 0,
        opens: row.opens ?? 0,
        clicked: row.clicked ?? 0,
        clicks: row.clicks ?? 0,
        unsubscribed: row.unsubscribed ?? 0,
        complained: row.complained ?? 0,
      }
    : { ...EMPTY_STATS }

export function statsFor(db: Db, ids: string[]): Map<string, CampaignStats> {
  if (ids.length === 0) return new Map()
  const rows = db
    .prepare(
      `SELECT campaign_id AS id, ${STATS_COLUMNS} FROM messages
       WHERE kind = 'campaign' AND campaign_id IN (${placeholders(ids.length)}) GROUP BY campaign_id`,
    )
    .all(...ids) as (StatsRow & { id: string })[]
  return new Map(rows.map((row) => [row.id, toStats(row)]))
}

/** Totals across every marketing message queued since a moment in time. */
export function statsSince(db: Db, since: string): CampaignStats {
  const row = db
    .prepare(
      `SELECT ${STATS_COLUMNS} FROM messages WHERE kind IN ('campaign','automation') AND queued_at >= ?`,
    )
    .get(since) as StatsRow | undefined
  return toStats(row)
}

export function toSummary(row: CampaignRow, stats: CampaignStats | undefined): CampaignSummary {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    status: row.status,
    accountId: row.account_id,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    stats: stats ?? { ...EMPTY_STATS },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toCampaign(db: Db, row: CampaignRow): Campaign {
  return {
    ...toSummary(row, statsFor(db, [row.id]).get(row.id)),
    preheader: row.preheader,
    html: row.html,
    design: parseJson<EmailDesign | null>(row.design, null),
    fromName: row.from_name,
    fromEmail: row.from_email,
    replyTo: row.reply_to,
    audience: { ...EMPTY_AUDIENCE, ...parseJson<Partial<CampaignAudience>>(row.audience, {}) },
    trackOpens: row.track_opens === 1,
    trackClicks: row.track_clicks === 1,
  }
}

export function getCampaignRow(db: Db, id: string): CampaignRow {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow | undefined
  if (!row) throw AppError.notFound('campaign')
  return row
}

/* ---- Audience ----------------------------------------------------------- */

function anyOf(db: Db, listIds: string[], segmentIds: string[], tagIds: string[]): Compiled | null {
  const parts: Compiled[] = []
  if (listIds.length > 0) {
    parts.push({
      sql: `EXISTS (SELECT 1 FROM list_members lm WHERE lm.contact_id = c.id AND lm.status = 'subscribed' AND lm.list_id IN (${placeholders(listIds.length)}))`,
      params: listIds,
    })
  }
  if (tagIds.length > 0) {
    parts.push({
      sql: `EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id IN (${placeholders(tagIds.length)}))`,
      params: tagIds,
    })
  }
  for (const id of segmentIds) parts.push(compileSegment(db, loadSegment(db, id)))
  if (parts.length === 0) return null
  return {
    sql: `(${parts.map((part) => part.sql).join(' OR ')})`,
    params: parts.flatMap((part) => part.params),
  }
}

/** The audience as a WHERE clause over `contacts c`, before the sendable filter. */
export function audienceWhere(db: Db, audience: CampaignAudience): Compiled {
  const include = audience.everyone
    ? { sql: '1 = 1', params: [] }
    : (anyOf(db, audience.listIds, audience.segmentIds, audience.tagIds) ?? {
        sql: '0 = 1',
        params: [],
      })
  const exclude = anyOf(
    db,
    audience.excludeListIds,
    audience.excludeSegmentIds,
    audience.excludeTagIds,
  )
  return exclude
    ? {
        sql: `${include.sql} AND NOT ${exclude.sql}`,
        params: [...include.params, ...exclude.params],
      }
    : include
}

/** Subscribed, and not on the suppression list. The only people mail goes to. */
export const SENDABLE = `c.status = 'subscribed' AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email = c.email)`

export function estimateAudience(db: Db, audience: CampaignAudience): AudienceEstimate {
  const where = audienceWhere(db, audience)
  const row = db
    .prepare(
      /* sql */ `SELECT
        COUNT(*) AS matched,
        SUM(${SENDABLE}) AS sendable,
        SUM(c.status = 'unsubscribed') AS unsubscribed,
        SUM(c.status = 'pending') AS pending,
        SUM(c.status = 'bounced') AS bounced,
        SUM(c.status = 'complained') AS complained,
        SUM(c.status = 'subscribed' AND EXISTS (SELECT 1 FROM suppressions s WHERE s.email = c.email)) AS suppressed
       FROM contacts c WHERE ${where.sql}`,
    )
    .get(...where.params) as Record<string, number | null>
  return {
    matched: row.matched ?? 0,
    sendable: row.sendable ?? 0,
    excluded: {
      unsubscribed: row.unsubscribed ?? 0,
      pending: row.pending ?? 0,
      bounced: row.bounced ?? 0,
      complained: row.complained ?? 0,
      suppressed: row.suppressed ?? 0,
    },
  }
}

/* ---- Sending ------------------------------------------------------------ */

export function accountFor(ctx: Ctx, accountId: string | null): AccountRow | undefined {
  if (accountId) {
    const row = ctx.db.prepare('SELECT * FROM sending_accounts WHERE id = ?').get(accountId) as
      AccountRow | undefined
    if (row) return row
  }
  return defaultAccountRow(ctx)
}

/** Everything that has to be true before a campaign may go out. */
export function checkCampaign(ctx: Ctx, row: CampaignRow): CampaignCheck[] {
  const settings = getSettings(ctx.db)
  const audience = { ...EMPTY_AUDIENCE, ...parseJson<Partial<CampaignAudience>>(row.audience, {}) }
  const estimate = estimateAudience(ctx.db, audience)
  const account = accountFor(ctx, row.account_id)
  const base = publicUrl(ctx)
  const text = row.html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()

  const checks: CampaignCheck[] = [
    {
      key: 'subject',
      ok: row.subject.trim() !== '',
      severity: 'error',
      message: row.subject.trim() ? 'Subject line is set.' : 'Add a subject line.',
    },
    {
      key: 'content',
      ok: text.length > 0,
      severity: 'error',
      message: text.length > 0 ? 'The email has content.' : 'The email is empty. Add some content.',
    },
    {
      key: 'audience',
      ok: estimate.sendable > 0,
      severity: 'error',
      message:
        estimate.sendable > 0
          ? `${estimate.sendable.toLocaleString('en-US')} ${estimate.sendable === 1 ? 'person' : 'people'} will receive this.`
          : estimate.matched > 0
            ? 'Nobody in this audience can be emailed: they are all unsubscribed, pending or suppressed.'
            : 'Choose who this goes to.',
    },
    {
      key: 'account',
      ok: Boolean(account && account.enabled === 1 && account.status !== 'error'),
      severity: 'error',
      message: !account
        ? 'Add a sending account under Settings before sending.'
        : account.enabled !== 1
          ? `The sending account "${account.label}" is turned off.`
          : account.status === 'error'
            ? `The sending account "${account.label}" could not sign in: ${account.last_error ?? 'unknown error'}`
            : `Sending from ${account.from_email}.`,
    },
    {
      key: 'address',
      ok: formatAddress(settings.organization) !== '' && settings.organization.name !== '',
      severity: 'error',
      message:
        formatAddress(settings.organization) !== '' && settings.organization.name !== ''
          ? 'Your mailing address is in the footer.'
          : 'Add your organization name and mailing address under Settings. The law requires a physical address in every marketing email.',
    },
    {
      key: 'public_url',
      ok: !isLocalUrl(base),
      severity: 'warning',
      message: isLocalUrl(base)
        ? `Links in this email point to ${base}, which only works on this computer. Unsubscribe links, open tracking and click tracking will not work for recipients until a public URL is set under Settings.`
        : `Links point to ${base}.`,
    },
  ]
  if (account && account.enabled === 1 && estimate.sendable > account.daily_limit) {
    const days = Math.ceil(estimate.sendable / account.daily_limit)
    checks.push({
      key: 'account',
      ok: false,
      severity: 'warning',
      message: `This account sends ${account.daily_limit.toLocaleString('en-US')} emails a day, so this campaign will take about ${days} days to finish.`,
    })
  }
  return checks
}

/**
 * Puts one message per recipient in the queue. A single INSERT … SELECT, so a
 * hundred-thousand-contact list is a statement rather than a loop, and the
 * UNIQUE on (campaign, contact) it relies on never being needed: a campaign is
 * only ever started once, by the status change in the same transaction.
 */
export function startCampaign(ctx: Ctx, id: string): number {
  const { db } = ctx
  const row = getCampaignRow(db, id)
  const audience = { ...EMPTY_AUDIENCE, ...parseJson<Partial<CampaignAudience>>(row.audience, {}) }
  const where = audienceWhere(db, audience)
  const account = accountFor(ctx, row.account_id)
  const now = nowIso()

  const queued = db.transaction(() => {
    const claimed = db
      .prepare(
        "UPDATE campaigns SET status = 'sending', started_at = ?, account_id = ?, updated_at = ? WHERE id = ? AND status IN ('draft','scheduled')",
      )
      .run(now, account?.id ?? null, now, id)
    if (claimed.changes === 0) return 0
    return db
      .prepare(
        /* sql */ `INSERT INTO messages (id, kind, campaign_id, contact_id, to_email, account_id, status, next_attempt_at, token, queued_at)
         SELECT 'msg_' || lower(hex(randomblob(10))), 'campaign', ?, c.id, c.email, ?, 'queued', ?, lower(hex(randomblob(16))), ?
         FROM contacts c WHERE ${where.sql} AND ${SENDABLE}`,
      )
      .run(id, account?.id ?? null, now, now, ...where.params).changes
  })()

  writeLog(
    db,
    'info',
    'campaigns',
    `Campaign "${row.name}" started: ${queued.toLocaleString('en-US')} recipients queued`,
    { campaignId: id },
  )
  return queued
}

/** Scheduled campaigns whose time has come. Called on every worker pass. */
export function startDueCampaigns(ctx: Ctx): void {
  const due = ctx.db
    .prepare("SELECT id FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= ?")
    .all(nowIso()) as { id: string }[]
  for (const { id } of due) startCampaign(ctx, id)
}

/** A campaign with nothing left in the queue is finished. */
export function finishCampaigns(ctx: Ctx): void {
  const done = ctx.db
    .prepare(
      /* sql */ `SELECT id, name FROM campaigns WHERE status = 'sending'
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.campaign_id = campaigns.id AND m.status IN ('queued','sending'))`,
    )
    .all() as { id: string; name: string }[]
  const now = nowIso()
  for (const campaign of done) {
    ctx.db
      .prepare("UPDATE campaigns SET status = 'sent', finished_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, campaign.id)
    writeLog(ctx.db, 'info', 'campaigns', `Campaign "${campaign.name}" finished sending`, {
      campaignId: campaign.id,
    })
  }
}
