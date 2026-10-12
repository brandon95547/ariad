import { z } from 'zod'
import { optionalText } from './api.js'

/**
 * A segment is a saved question about the audience, answered fresh each time
 * it is used. Nobody is "in" a segment; they match it or they do not.
 */
export type SegmentFieldType =
  'text' | 'status' | 'date' | 'month' | 'tag' | 'list' | 'activity' | 'number'

export interface SegmentOperator {
  key: string
  label: string
  /** What the value input should be. `none` means the operator needs no value. */
  value: 'text' | 'number' | 'days' | 'date' | 'status' | 'tag' | 'list' | 'month' | 'none'
}

const text: SegmentOperator[] = [
  { key: 'is', label: 'is', value: 'text' },
  { key: 'is_not', label: 'is not', value: 'text' },
  { key: 'contains', label: 'contains', value: 'text' },
  { key: 'not_contains', label: 'does not contain', value: 'text' },
  { key: 'starts_with', label: 'starts with', value: 'text' },
  { key: 'ends_with', label: 'ends with', value: 'text' },
  { key: 'is_blank', label: 'is blank', value: 'none' },
  { key: 'is_not_blank', label: 'is not blank', value: 'none' },
]

const date: SegmentOperator[] = [
  { key: 'in_last_days', label: 'is in the last', value: 'days' },
  { key: 'not_in_last_days', label: 'is not in the last', value: 'days' },
  { key: 'before', label: 'is before', value: 'date' },
  { key: 'after', label: 'is after', value: 'date' },
  { key: 'is_blank', label: 'is blank', value: 'none' },
  { key: 'is_not_blank', label: 'is not blank', value: 'none' },
]

const activity: SegmentOperator[] = [
  { key: 'in_last_days', label: 'in the last', value: 'days' },
  { key: 'not_in_last_days', label: 'not in the last', value: 'days' },
  { key: 'is_blank', label: 'never', value: 'none' },
  { key: 'is_not_blank', label: 'at least once', value: 'none' },
]

const number: SegmentOperator[] = [
  { key: 'eq', label: 'equals', value: 'number' },
  { key: 'gt', label: 'is greater than', value: 'number' },
  { key: 'lt', label: 'is less than', value: 'number' },
  { key: 'is_blank', label: 'is blank', value: 'none' },
  { key: 'is_not_blank', label: 'is not blank', value: 'none' },
]

export const SEGMENT_OPERATORS: Record<SegmentFieldType, SegmentOperator[]> = {
  text,
  date,
  activity,
  number,
  status: [
    { key: 'is', label: 'is', value: 'status' },
    { key: 'is_not', label: 'is not', value: 'status' },
  ],
  month: [
    { key: 'month_is', label: 'is in', value: 'month' },
    { key: 'is_blank', label: 'is blank', value: 'none' },
    { key: 'is_not_blank', label: 'is not blank', value: 'none' },
  ],
  tag: [
    { key: 'has', label: 'includes', value: 'tag' },
    { key: 'has_not', label: 'does not include', value: 'tag' },
  ],
  list: [
    { key: 'has', label: 'includes', value: 'list' },
    { key: 'has_not', label: 'does not include', value: 'list' },
  ],
}

export interface SegmentField {
  key: string
  label: string
  type: SegmentFieldType
  group: 'Contact' | 'Membership' | 'Activity' | 'Custom fields'
}

/** The built-in fields. Custom fields are added to these as `custom.<key>`. */
export const SEGMENT_FIELDS: readonly SegmentField[] = [
  { key: 'email', label: 'Email address', type: 'text', group: 'Contact' },
  { key: 'first_name', label: 'First name', type: 'text', group: 'Contact' },
  { key: 'last_name', label: 'Last name', type: 'text', group: 'Contact' },
  { key: 'company', label: 'Company', type: 'text', group: 'Contact' },
  { key: 'phone', label: 'Phone', type: 'text', group: 'Contact' },
  { key: 'source', label: 'Source', type: 'text', group: 'Contact' },
  { key: 'status', label: 'Status', type: 'status', group: 'Contact' },
  { key: 'birthday', label: 'Birthday month', type: 'month', group: 'Contact' },
  { key: 'created_at', label: 'Date added', type: 'date', group: 'Contact' },
  { key: 'tag', label: 'Tags', type: 'tag', group: 'Membership' },
  { key: 'list', label: 'Lists', type: 'list', group: 'Membership' },
  { key: 'last_sent_at', label: 'Was sent an email', type: 'activity', group: 'Activity' },
  { key: 'last_opened_at', label: 'Opened an email', type: 'activity', group: 'Activity' },
  { key: 'last_clicked_at', label: 'Clicked a link', type: 'activity', group: 'Activity' },
]

export const segmentRuleSchema = z.object({
  field: z.string().min(1).max(80),
  op: z.string().min(1).max(40),
  value: z.union([z.string().max(500), z.number()]).nullish(),
})
export type SegmentRule = z.infer<typeof segmentRuleSchema>

export const segmentDefinitionSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  rules: z.array(segmentRuleSchema).min(1, 'Add at least one condition.').max(30),
})
export type SegmentDefinition = z.infer<typeof segmentDefinitionSchema>

export const segmentInputSchema = segmentDefinitionSchema.extend({
  name: z.string().trim().min(1, 'Give the segment a name.').max(160),
  description: optionalText(500),
})
export type SegmentInput = z.input<typeof segmentInputSchema>

export interface Segment extends SegmentDefinition {
  id: string
  name: string
  description: string | null
  /** Contacts matching right now. Counts everyone, subscribed or not. */
  contactCount: number
  createdAt: string
  updatedAt: string
}

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const
