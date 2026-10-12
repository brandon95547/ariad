import { z } from 'zod'
import { optionalText, patchOf } from './api.js'
import { emailContentSchema, type EmailContent } from './campaigns.js'

/**
 * An automation is a trigger and a line of steps. A contact who meets the
 * trigger starts at the top and moves down one step at a time; a delay holds
 * them, an email sends to them, and the end of the line is the end of the run.
 *
 * A contact goes through a given automation once per occasion: once ever for a
 * welcome, once a year for a birthday, once per campaign for a follow-up.
 */
export type AutomationTrigger =
  /** Joined a list (or any list). The welcome email. */
  | { type: 'list_subscribed'; listId: string | null }
  | { type: 'tag_added'; tagId: string }
  | { type: 'form_submitted'; formId: string | null }
  /**
   * A date comes round. `field` is `birthday`, `created_at` (the anniversary of
   * joining) or a custom date field as `custom.<key>`. Yearly, at `hour` local
   * time, `offsetDays` before (negative) or after the day itself.
   */
  | { type: 'date'; field: string; offsetDays: number; hour: number }
  /** Some days after a campaign went out, to those who did or did not respond. */
  | {
      type: 'campaign_followup'
      campaignId: string | null
      condition: 'sent' | 'opened' | 'not_opened' | 'clicked' | 'not_clicked'
      afterDays: number
    }
  /** Only started by hand, from a contact's page or the API. */
  | { type: 'manual' }

export type AutomationTriggerType = AutomationTrigger['type']

export const TRIGGER_LABELS: Record<AutomationTriggerType, { label: string; description: string }> =
  {
    list_subscribed: {
      label: 'Someone subscribes',
      description: 'Welcome new subscribers as they join a list.',
    },
    form_submitted: {
      label: 'A signup form is submitted',
      description: 'Respond to a specific form.',
    },
    tag_added: { label: 'A tag is added', description: 'Start when a contact is given a tag.' },
    date: {
      label: 'A date comes round',
      description: 'Birthdays, anniversaries and other yearly dates.',
    },
    campaign_followup: {
      label: 'After a campaign',
      description: 'Follow up with people who did, or did not, respond.',
    },
    manual: { label: 'Started by hand', description: 'Add contacts yourself.' },
  }

export type AutomationStep =
  | { id: string; type: 'delay'; amount: number; unit: 'minutes' | 'hours' | 'days' }
  | ({ id: string; type: 'email' } & EmailContent)
  | { id: string; type: 'add_tag'; tagId: string }
  | { id: string; type: 'remove_tag'; tagId: string }

export type AutomationStatus = 'draft' | 'active' | 'paused'

export interface AutomationStats {
  active: number
  completed: number
  exited: number
  emailsSent: number
  opened: number
  clicked: number
}

export interface Automation {
  id: string
  name: string
  description: string | null
  status: AutomationStatus
  trigger: AutomationTrigger
  steps: AutomationStep[]
  accountId: string | null
  stats: AutomationStats
  createdAt: string
  updatedAt: string
}

const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('list_subscribed'), listId: z.string().nullable() }),
  z.object({ type: z.literal('tag_added'), tagId: z.string().min(1, 'Choose a tag.') }),
  z.object({ type: z.literal('form_submitted'), formId: z.string().nullable() }),
  z.object({
    type: z.literal('date'),
    field: z.string().min(1),
    offsetDays: z.number().int().min(-60).max(60),
    hour: z.number().int().min(0).max(23),
  }),
  z.object({
    type: z.literal('campaign_followup'),
    campaignId: z.string().nullable(),
    condition: z.enum(['sent', 'opened', 'not_opened', 'clicked', 'not_clicked']),
    afterDays: z.number().int().min(0).max(90),
  }),
  z.object({ type: z.literal('manual') }),
])

const stepSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('delay'),
    amount: z.number().int().min(1).max(365),
    unit: z.enum(['minutes', 'hours', 'days']),
  }),
  emailContentSchema.extend({ id: z.string(), type: z.literal('email') }),
  z.object({ id: z.string(), type: z.literal('add_tag'), tagId: z.string().min(1) }),
  z.object({ id: z.string(), type: z.literal('remove_tag'), tagId: z.string().min(1) }),
])

export const automationInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the automation a name.').max(200),
  description: optionalText(500),
  trigger: triggerSchema,
  steps: z.array(stepSchema).max(40).default([]),
  accountId: z
    .string()
    .nullish()
    .transform((value) => value || null),
})
export type AutomationInput = z.input<typeof automationInputSchema>

export const automationUpdateSchema = patchOf(automationInputSchema)

export interface AutomationRun {
  id: string
  contactId: string
  email: string
  status: 'active' | 'completed' | 'exited' | 'failed'
  /** Index of the step the contact is waiting at. */
  stepIndex: number
  nextRunAt: string | null
  note: string | null
  startedAt: string
  finishedAt: string | null
}

export function delayMs(step: { amount: number; unit: 'minutes' | 'hours' | 'days' }): number {
  const unit = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[step.unit]
  return step.amount * unit
}
