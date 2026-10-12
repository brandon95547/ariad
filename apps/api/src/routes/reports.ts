import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  formatAddress,
  ratesFrom,
  type DailyPoint,
  type DashboardData,
  type ReportsData,
  type SetupStep,
} from '@ariad/shared'
import type { Db } from '../db/index.js'
import { statsFor, statsSince, toSummary, type CampaignRow } from '../services/campaigns.js'
import { getSettings, isLocalUrl, publicUrl } from '../services/settings.js'

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

/**
 * One row per day, with the quiet days filled in. A chart drawn from only the
 * days that had activity joins Tuesday to Friday with a straight line and hides
 * the two days nothing happened, which are part of the picture.
 */
function dailySeries(db: Db, days: number): DailyPoint[] {
  const since = daysAgo(days - 1).slice(0, 10)
  const byDay = new Map<string, DailyPoint>()
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = daysAgo(i).slice(0, 10)
    byDay.set(day, { day, sent: 0, opens: 0, clicks: 0, bounces: 0, unsubscribes: 0, newContacts: 0 })
  }

  const sent = db
    .prepare("SELECT substr(sent_at, 1, 10) AS day, COUNT(*) AS n FROM messages WHERE sent_at >= ? AND kind IN ('campaign','automation') GROUP BY 1")
    .all(since) as { day: string; n: number }[]
  for (const row of sent) {
    const point = byDay.get(row.day)
    if (point) point.sent = row.n
  }

  const events = db
    .prepare('SELECT substr(created_at, 1, 10) AS day, type, COUNT(*) AS n FROM message_events WHERE created_at >= ? GROUP BY 1, 2')
    .all(since) as { day: string; type: string; n: number }[]
  for (const row of events) {
    const point = byDay.get(row.day)
    if (!point) continue
    if (row.type === 'open') point.opens = row.n
    else if (row.type === 'click') point.clicks = row.n
    else if (row.type === 'bounce') point.bounces = row.n
    else if (row.type === 'unsubscribe') point.unsubscribes = row.n
  }

  const added = db
    .prepare('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM contacts WHERE created_at >= ? GROUP BY 1')
    .all(since) as { day: string; n: number }[]
  for (const row of added) {
    const point = byDay.get(row.day)
    if (point) point.newContacts = row.n
  }
  return [...byDay.values()]
}

export async function reportRoutes(base: FastifyInstance): Promise<void> {
  const app = base.withTypeProvider<ZodTypeProvider>()
  const { ctx } = app
  const { db } = ctx
  const viewer = app.requireRole('viewer')

  const count = (sql: string, ...params: unknown[]) => (db.prepare(sql).get(...params) as { n: number }).n

  app.get('/dashboard', { preHandler: viewer }, async (): Promise<DashboardData> => {
    const settings = getSettings(db)
    const since = daysAgo(30)
    const totals = statsSince(db, since)

    const recent = db
      .prepare("SELECT * FROM campaigns ORDER BY COALESCE(started_at, scheduled_at, updated_at) DESC LIMIT 6")
      .all() as CampaignRow[]
    const stats = statsFor(db, recent.map((row) => row.id))

    const hasAccount = count('SELECT COUNT(*) AS n FROM sending_accounts WHERE enabled = 1') > 0
    const hasAddress = settings.organization.name !== '' && formatAddress(settings.organization) !== ''
    const hasContacts = count('SELECT COUNT(*) AS n FROM contacts') > 0
    const hasSent = count("SELECT COUNT(*) AS n FROM campaigns WHERE status IN ('sending','sent')") > 0
    const setup: SetupStep[] = [
      { key: 'account', done: hasAccount, title: 'Connect a sending account', description: 'Add the Gmail or SMTP account your email will go out through.', to: '/settings/sending' },
      { key: 'organization', done: hasAddress, title: 'Add your mailing address', description: 'Every marketing email must carry a physical postal address.', to: '/settings/organization' },
      { key: 'public_url', done: !isLocalUrl(publicUrl(ctx)), title: 'Set your public URL', description: 'So unsubscribe links and tracking work for people outside this computer.', to: '/settings/organization' },
      { key: 'contacts', done: hasContacts, title: 'Add your contacts', description: 'Import a CSV, or add people one at a time.', to: '/contacts' },
      { key: 'campaign', done: hasSent, title: 'Send your first campaign', description: 'Write an email, pick who gets it, and send.', to: '/campaigns' },
    ]

    return {
      contacts: {
        total: count('SELECT COUNT(*) AS n FROM contacts'),
        subscribed: count("SELECT COUNT(*) AS n FROM contacts WHERE status = 'subscribed'"),
        newLast30Days: count('SELECT COUNT(*) AS n FROM contacts WHERE created_at >= ?', since),
        unsubscribedLast30Days: count('SELECT COUNT(*) AS n FROM contacts WHERE unsubscribed_at >= ?', since),
      },
      totals,
      rates: ratesFrom(totals),
      series: dailySeries(db, 30),
      recentCampaigns: recent.map((row) => toSummary(row, stats.get(row.id))),
      queue: app.worker.queueStatus(),
      setup,
    }
  })

  app.get(
    '/reports',
    { preHandler: viewer, schema: { querystring: z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }) } },
    async (request): Promise<ReportsData> => {
      const { days } = request.query
      const since = daysAgo(days)
      const totals = statsSince(db, since)
      const rows = db
        .prepare("SELECT * FROM campaigns WHERE status IN ('sending','paused','sent','canceled') AND started_at >= ? ORDER BY started_at DESC LIMIT 200")
        .all(since) as CampaignRow[]
      const stats = statsFor(db, rows.map((row) => row.id))
      return {
        days,
        totals,
        rates: ratesFrom(totals),
        series: dailySeries(db, days),
        campaigns: rows.map((row) => toSummary(row, stats.get(row.id))),
      }
    },
  )
}
