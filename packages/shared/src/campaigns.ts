import { z } from 'zod'
import { emailSchema, optionalText, patchOf } from './api.js'
import { emailDesignSchema, type EmailDesign } from './design.js'

/**
 * A message body is either built (a design, rendered to HTML on save) or
 * written by hand (HTML only, design null). The HTML is always what is sent.
 */
export interface EmailContent {
  subject: string
  preheader: string | null
  html: string
  design: EmailDesign | null
}

export const emailContentSchema = z.object({
  subject: z.string().trim().max(300).default(''),
  preheader: optionalText(300),
  html: z.string().max(1_000_000).default(''),
  design: emailDesignSchema.nullish().transform((value) => value ?? null),
})

export interface Template extends EmailContent {
  id: string
  name: string
  description: string | null
  /** Shipped with Ariad. Can be copied, not edited or deleted. */
  builtin: boolean
  createdAt: string
  updatedAt: string
}

export type TemplateSummary = Omit<Template, 'html' | 'design'>

export const templateInputSchema = emailContentSchema.extend({
  name: z.string().trim().min(1, 'Give the template a name.').max(160),
  description: optionalText(500),
})
export type TemplateInput = z.input<typeof templateInputSchema>

/**
 *   draft      being written
 *   scheduled  will start at `scheduledAt`
 *   sending    recipients are in the queue and going out
 *   paused     stopped by a person; resumes where it left off
 *   sent       every recipient has been attempted
 *   canceled   stopped for good; what was not sent never will be
 */
export const CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'sending',
  'paused',
  'sent',
  'canceled',
] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  paused: 'Paused',
  sent: 'Sent',
  canceled: 'Canceled',
}

/**
 * Who a campaign goes to: everyone matching ANY of the includes, minus anyone
 * matching any of the excludes. Whatever is chosen, only contacts who are
 * subscribed and not suppressed are ever queued.
 */
export interface CampaignAudience {
  /** Every subscribed contact. The includes below are ignored when set. */
  everyone: boolean
  listIds: string[]
  segmentIds: string[]
  tagIds: string[]
  excludeListIds: string[]
  excludeSegmentIds: string[]
  excludeTagIds: string[]
}

export const EMPTY_AUDIENCE: CampaignAudience = {
  everyone: false,
  listIds: [],
  segmentIds: [],
  tagIds: [],
  excludeListIds: [],
  excludeSegmentIds: [],
  excludeTagIds: [],
}

const ids = z.array(z.string()).max(200).default([])
export const audienceSchema = z.object({
  everyone: z.boolean().default(false),
  listIds: ids,
  segmentIds: ids,
  tagIds: ids,
  excludeListIds: ids,
  excludeSegmentIds: ids,
  excludeTagIds: ids,
})

export interface CampaignStats {
  recipients: number
  queued: number
  sent: number
  failed: number
  bounced: number
  /** Accepted by the mail server and not bounced since. */
  delivered: number
  /** People who opened at least once. */
  opened: number
  opens: number
  /** People who clicked at least once. */
  clicked: number
  clicks: number
  unsubscribed: number
  complained: number
}

export const EMPTY_STATS: CampaignStats = {
  recipients: 0,
  queued: 0,
  sent: 0,
  failed: 0,
  bounced: 0,
  delivered: 0,
  opened: 0,
  opens: 0,
  clicked: 0,
  clicks: 0,
  unsubscribed: 0,
  complained: 0,
}

export interface CampaignSummary {
  id: string
  name: string
  subject: string
  status: CampaignStatus
  accountId: string | null
  scheduledAt: string | null
  startedAt: string | null
  finishedAt: string | null
  stats: CampaignStats
  createdAt: string
  updatedAt: string
}

export interface Campaign extends CampaignSummary, EmailContent {
  /** Blank means "use the sending account's own". */
  fromName: string | null
  fromEmail: string | null
  replyTo: string | null
  audience: CampaignAudience
  trackOpens: boolean
  trackClicks: boolean
}

export const campaignInputSchema = emailContentSchema.extend({
  name: z.string().trim().min(1, 'Give the campaign a name.').max(200),
  fromName: optionalText(120),
  fromEmail: emailSchema.nullish().or(z.literal('').transform(() => null)),
  replyTo: emailSchema.nullish().or(z.literal('').transform(() => null)),
  accountId: z
    .string()
    .nullish()
    .transform((value) => value || null),
  audience: audienceSchema.default(EMPTY_AUDIENCE),
  /** Left out on create, these take the account-wide setting. */
  trackOpens: z.boolean().optional(),
  trackClicks: z.boolean().optional(),
})
export type CampaignInput = z.input<typeof campaignInputSchema>

export const campaignUpdateSchema = patchOf(campaignInputSchema)
export type CampaignUpdateInput = z.input<typeof campaignUpdateSchema>

export const sendCampaignSchema = z.object({
  /** ISO time to start at. Absent or in the past means now. */
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
})

export const testSendSchema = z.object({
  to: z.array(emailSchema).min(1, 'Enter at least one address.').max(10),
  /** Fill merge tags from this contact instead of sample values. */
  contactId: z.string().nullish(),
})
export type TestSendInput = z.input<typeof testSendSchema>

export interface AudienceEstimate {
  /** Contacts the audience rules match. */
  matched: number
  /** Of those, how many will actually be sent to. */
  sendable: number
  excluded: {
    unsubscribed: number
    pending: number
    bounced: number
    complained: number
    suppressed: number
  }
}

/** Everything that has to be true before a campaign can be sent. */
export interface CampaignCheck {
  key: 'subject' | 'content' | 'audience' | 'account' | 'address' | 'public_url' | 'unsubscribe'
  ok: boolean
  /** A warning does not block sending; a failure does. */
  severity: 'error' | 'warning'
  message: string
}

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'bounced' | 'canceled'

export interface CampaignRecipient {
  id: string
  contactId: string | null
  email: string
  status: MessageStatus
  sentAt: string | null
  openedAt: string | null
  openCount: number
  clickedAt: string | null
  clickCount: number
  unsubscribedAt: string | null
  error: string | null
}

export interface CampaignLinkStat {
  url: string
  clicks: number
  people: number
}

export interface CampaignReport {
  campaign: Campaign
  /** Opens and clicks per hour for the first days after the send. */
  timeline: { at: string; opens: number; clicks: number }[]
  links: CampaignLinkStat[]
}
