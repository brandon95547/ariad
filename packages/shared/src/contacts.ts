import { z } from 'zod'
import { emailSchema, optionalText, pageQuerySchema, patchOf } from './api.js'

/**
 * Where a contact stands with us as a whole.
 *
 *   subscribed    may be emailed
 *   pending       asked to join, has not confirmed (double opt-in)
 *   unsubscribed  asked to stop; never emailed again unless they re-subscribe
 *   bounced       the address rejected mail permanently
 *   complained    marked a message as spam
 *
 * Only `subscribed` is ever sent to. List membership is a second, narrower
 * switch on top of this one.
 */
export const CONTACT_STATUSES = [
  'subscribed',
  'pending',
  'unsubscribed',
  'bounced',
  'complained',
] as const
export type ContactStatus = (typeof CONTACT_STATUSES)[number]

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  subscribed: 'Subscribed',
  pending: 'Pending',
  unsubscribed: 'Unsubscribed',
  bounced: 'Bounced',
  complained: 'Complained',
}

export interface Tag {
  id: string
  name: string
  color: string
  contactCount: number
}

export interface ContactList {
  id: string
  name: string
  description: string | null
  /** New members must confirm by email before they are subscribed. */
  doubleOptIn: boolean
  /** Shown on the preferences page so people can opt in or out themselves. */
  isPublic: boolean
  subscribedCount: number
  pendingCount: number
  unsubscribedCount: number
  createdAt: string
}

export type CustomFieldType = 'text' | 'number' | 'date' | 'boolean' | 'select'

export interface CustomField {
  id: string
  /** Used in merge tags as {{custom.key}} and in CSV headers. */
  key: string
  label: string
  type: CustomFieldType
  options: string[]
  createdAt: string
}

export interface ContactListMembership {
  listId: string
  name: string
  status: 'subscribed' | 'pending' | 'unsubscribed'
  subscribedAt: string | null
}

export interface Contact {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  company: string | null
  phone: string | null
  /** YYYY-MM-DD, or --MM-DD when the year is unknown. */
  birthday: string | null
  status: ContactStatus
  source: string | null
  custom: Record<string, string>
  tags: Pick<Tag, 'id' | 'name' | 'color'>[]
  lists: ContactListMembership[]
  consentAt: string | null
  consentSource: string | null
  consentText: string | null
  consentIp: string | null
  confirmedAt: string | null
  unsubscribedAt: string | null
  unsubscribeReason: string | null
  lastSentAt: string | null
  lastOpenedAt: string | null
  lastClickedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ContactEventType =
  | 'created'
  | 'imported'
  | 'updated'
  | 'subscribed'
  | 'confirmed'
  | 'unsubscribed'
  | 'resubscribed'
  | 'list_added'
  | 'list_removed'
  | 'tag_added'
  | 'tag_removed'
  | 'form_submitted'
  | 'sent'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'automation_started'
  | 'automation_completed'
  | 'merged'

export interface ContactEvent {
  id: string
  type: ContactEventType
  summary: string
  detail: Record<string, unknown> | null
  createdAt: string
}

const birthdaySchema = z
  .string()
  .trim()
  .regex(/^(\d{4}|-)-\d{2}-\d{2}$/, 'Use YYYY-MM-DD, or --MM-DD without a year.')
  .nullish()
  .or(z.literal('').transform(() => null))

export const contactInputSchema = z.object({
  email: emailSchema,
  firstName: optionalText(120),
  lastName: optionalText(120),
  company: optionalText(160),
  phone: optionalText(40),
  birthday: birthdaySchema,
  status: z.enum(CONTACT_STATUSES).optional(),
  custom: z.record(z.string(), z.string().max(2000)).optional(),
  listIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  /** How this person agreed to be emailed. Kept as the consent record. */
  consentSource: optionalText(200),
  consentText: optionalText(1000),
})
export type ContactInput = z.input<typeof contactInputSchema>

export const contactUpdateSchema = patchOf(contactInputSchema)
export type ContactUpdateInput = z.input<typeof contactUpdateSchema>

export const contactQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  listId: z.string().optional(),
  tagId: z.string().optional(),
  segmentId: z.string().optional(),
  sort: z
    .enum(['created_desc', 'created_asc', 'email_asc', 'email_desc', 'name_asc', 'activity_desc'])
    .default('created_desc'),
})
export type ContactQuery = z.input<typeof contactQuerySchema>

export const bulkContactsSchema = z.object({
  ids: z.array(z.string()).min(1).max(5000),
  action: z.enum([
    'delete',
    'add_tag',
    'remove_tag',
    'add_to_list',
    'remove_from_list',
    'unsubscribe',
    'resubscribe',
  ]),
  tagId: z.string().optional(),
  listId: z.string().optional(),
})
export type BulkContactsInput = z.input<typeof bulkContactsSchema>

export const listInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the list a name.').max(160),
  description: optionalText(500),
  doubleOptIn: z.boolean().default(false),
  isPublic: z.boolean().default(true),
})
export type ListInput = z.input<typeof listInputSchema>
export const listUpdateSchema = patchOf(listInputSchema)

export const TAG_COLORS = ['#706fd3', '#33d9b2', '#ff5252', '#ccae62', '#218c74', '#ff793f', '#34ace0', '#ffb142'] as const

export const tagInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the tag a name.').max(60),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default(TAG_COLORS[0]),
})
export type TagInput = z.input<typeof tagInputSchema>
export const tagUpdateSchema = patchOf(tagInputSchema)

export const customFieldInputSchema = z.object({
  label: z.string().trim().min(1, 'Give the field a label.').max(80),
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Lowercase letters, numbers and underscores, starting with a letter.'),
  type: z.enum(['text', 'number', 'date', 'boolean', 'select']).default('text'),
  options: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
})
export type CustomFieldInput = z.input<typeof customFieldInputSchema>
/** The key is the field's identity in merge tags and segments, so an update cannot change it. */
export const customFieldUpdateSchema = patchOf(customFieldInputSchema.omit({ key: true }))

/** Which CSV column feeds which contact field. `skip` drops the column. */
export const IMPORT_TARGETS = [
  { key: 'skip', label: 'Do not import' },
  { key: 'email', label: 'Email address' },
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'fullName', label: 'Full name (split into first and last)' },
  { key: 'company', label: 'Company' },
  { key: 'phone', label: 'Phone' },
  { key: 'birthday', label: 'Birthday' },
  { key: 'tags', label: 'Tags (comma separated)' },
] as const

export const importContactsSchema = z.object({
  /** The file's text. Parsed on the server so the rules are in one place. */
  csv: z.string().min(1).max(25_000_000),
  /** Header name → target. Custom fields are `custom.<key>`. */
  mapping: z.record(z.string(), z.string()),
  listIds: z.array(z.string()).default([]),
  tagIds: z.array(z.string()).default([]),
  /** Overwrite the fields of contacts that already exist. */
  updateExisting: z.boolean().default(true),
  status: z.enum(['subscribed', 'pending', 'unsubscribed']).default('subscribed'),
  consentSource: z.string().trim().max(200).default('Imported from CSV'),
  /** The importer's statement that these people agreed to be emailed. */
  consentConfirmed: z.boolean().refine((value) => value, {
    message: 'Confirm that these contacts agreed to hear from you.',
  }),
})
export type ImportContactsInput = z.input<typeof importContactsSchema>

export interface ImportSummary {
  total: number
  created: number
  updated: number
  /** Already in the file once; later rows for the same address are folded in. */
  duplicatesInFile: number
  invalid: { row: number; value: string; reason: string }[]
  /** On the suppression list or unsubscribed: imported but never re-subscribed. */
  suppressed: number
}

export interface DuplicateGroup {
  reason: 'same_mailbox' | 'same_name_and_phone' | 'same_name_and_company'
  key: string
  contacts: Pick<Contact, 'id' | 'email' | 'firstName' | 'lastName' | 'company' | 'status' | 'createdAt'>[]
}

export const mergeContactsSchema = z.object({
  keepId: z.string(),
  mergeIds: z.array(z.string()).min(1).max(20),
})

export type SuppressionReason = 'unsubscribed' | 'bounced' | 'complained' | 'manual'

export interface Suppression {
  email: string
  reason: SuppressionReason
  note: string | null
  createdAt: string
}

export const suppressionInputSchema = z.object({
  /** One address per line, or separated by commas. */
  emails: z.string().min(1).max(500_000),
  reason: z.enum(['manual', 'bounced', 'complained', 'unsubscribed']).default('manual'),
  note: optionalText(300),
})
