import type { CampaignStats, CampaignSummary } from './campaigns.js'

export interface DailyPoint {
  /** YYYY-MM-DD */
  day: string
  sent: number
  opens: number
  clicks: number
  bounces: number
  unsubscribes: number
  newContacts: number
}

export interface Rates {
  /** Each is a fraction of delivered, 0–1. Null when nothing was delivered. */
  openRate: number | null
  clickRate: number | null
  bounceRate: number | null
  unsubscribeRate: number | null
  complaintRate: number | null
}

export interface SetupStep {
  key: 'account' | 'organization' | 'public_url' | 'contacts' | 'campaign'
  done: boolean
  title: string
  description: string
  to: string
}

export interface QueueStatus {
  queued: number
  sending: number
  /** Waiting on a retry after a temporary failure. */
  retrying: number
  failedLast24h: number
  sentLast24h: number
  /** The worker's last pass. Stale means it has stopped. */
  lastTickAt: string | null
}

export interface DashboardData {
  contacts: { total: number; subscribed: number; newLast30Days: number; unsubscribedLast30Days: number }
  totals: CampaignStats
  rates: Rates
  series: DailyPoint[]
  recentCampaigns: CampaignSummary[]
  queue: QueueStatus
  setup: SetupStep[]
}

export interface ReportsData {
  days: number
  totals: CampaignStats
  rates: Rates
  series: DailyPoint[]
  campaigns: CampaignSummary[]
}

export function ratesFrom(stats: CampaignStats): Rates {
  const sent = stats.sent + stats.bounced
  const delivered = stats.delivered
  const of = (count: number, base: number) => (base > 0 ? count / base : null)
  return {
    openRate: of(stats.opened, delivered),
    clickRate: of(stats.clicked, delivered),
    bounceRate: of(stats.bounced, sent),
    unsubscribeRate: of(stats.unsubscribed, delivered),
    complaintRate: of(stats.complained, delivered),
  }
}
