import { CAMPAIGN_STATUS_LABELS, type CampaignStats, type CampaignStatus, type QueueStatus } from '@ariad/shared'
import { Badge } from '@/ui/Badge'
import type { Tone } from '@/ui/Display'

const STATUS_TONE: Record<CampaignStatus, Tone> = {
  draft: 'neutral',
  scheduled: 'info',
  sending: 'accent',
  paused: 'warning',
  sent: 'success',
  canceled: 'neutral',
}

/** A campaign's status as the dashboard and the reports say it. */
export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot={status === 'sending'}>
      {CAMPAIGN_STATUS_LABELS[status]}
    </Badge>
  )
}

/** Everything that left: what was delivered and what bounced back. The base the bounce rate is taken from. */
export const sentTotal = (stats: CampaignStats): number => stats.sent + stats.bounced

/**
 * The background sender ticks every few seconds, so a last tick much older
 * than the reading it came with means it has stopped. Measured against when
 * the reading was taken, never against now: a page left open would otherwise
 * call a healthy sender stopped just because the figures on it are old.
 */
export function senderStopped(queue: QueueStatus, readAt: number): boolean {
  if (!queue.lastTickAt) return true
  return readAt - new Date(queue.lastTickAt).getTime() > 30_000
}
