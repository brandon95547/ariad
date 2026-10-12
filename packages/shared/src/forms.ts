import { z } from 'zod'
import { emailSchema, optionalText } from './api.js'
import type { CustomField, CustomFieldType } from './contacts.js'

/**
 * A signup form: a hosted page, and the same form as an embed for another
 * site. Email is always asked for; everything else is chosen here.
 */
export interface FormFieldDef {
  /** `firstName`, `lastName`, `company`, `phone`, `birthday` or `custom.<key>`. */
  key: string
  label: string
  required: boolean
}

export const FORM_FIELD_CHOICES: readonly { key: string; label: string }[] = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'company', label: 'Company' },
  { key: 'phone', label: 'Phone' },
  { key: 'birthday', label: 'Birthday' },
]

export interface SignupForm {
  id: string
  name: string
  title: string
  description: string | null
  buttonText: string
  successMessage: string
  /** Where to send people afterwards, instead of showing the message. */
  redirectUrl: string | null
  listIds: string[]
  /** Let the subscriber tick which of the lists they want. */
  letSubscriberChoose: boolean
  tagIds: string[]
  fields: FormFieldDef[]
  doubleOptIn: boolean
  /** The sentence beside the consent checkbox. Stored with every signup. */
  consentText: string
  consentRequired: boolean
  enabled: boolean
  submissions: number
  createdAt: string
  updatedAt: string
}

export const DEFAULT_CONSENT_TEXT =
  'I agree to receive emails and understand I can unsubscribe at any time.'

export const formInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the form a name.').max(160),
  title: z.string().trim().min(1).max(200).default('Subscribe to our newsletter'),
  description: optionalText(1000),
  buttonText: z.string().trim().min(1).max(60).default('Subscribe'),
  successMessage: z.string().trim().min(1).max(500).default('Thanks for subscribing.'),
  redirectUrl: z
    .string()
    .trim()
    .url()
    .max(2000)
    .nullish()
    .or(z.literal('').transform(() => null)),
  listIds: z.array(z.string()).min(1, 'Choose at least one list.').max(50),
  letSubscriberChoose: z.boolean().default(false),
  tagIds: z.array(z.string()).max(50).default([]),
  fields: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        label: z.string().trim().min(1).max(120),
        required: z.boolean().default(false),
      }),
    )
    .max(20)
    .default([]),
  doubleOptIn: z.boolean().default(true),
  consentText: z.string().trim().max(1000).default(DEFAULT_CONSENT_TEXT),
  consentRequired: z.boolean().default(true),
  enabled: z.boolean().default(true),
})
export type FormInput = z.input<typeof formInputSchema>

/** A field as the public page is told about it: with the kind of answer it takes, so a select is shown as a select. */
export interface PublicFormField extends FormFieldDef {
  type: CustomFieldType
  /** The choices, when `type` is `select`. */
  options: string[]
}

/** Looks up what each field of a form takes. Birthday is a date; a custom field is whatever it was defined as. */
export function publicFieldsOf(
  fields: readonly FormFieldDef[],
  custom: readonly Pick<CustomField, 'key' | 'type' | 'options'>[],
): PublicFormField[] {
  return fields.map((field) => {
    const definition = field.key.startsWith('custom.')
      ? custom.find((entry) => entry.key === field.key.slice(7))
      : undefined
    return {
      ...field,
      type: definition?.type ?? (field.key === 'birthday' ? 'date' : 'text'),
      options: definition?.options ?? [],
    }
  })
}

/** What the public page is told about a form. Nothing private. */
export interface PublicForm {
  id: string
  title: string
  description: string | null
  buttonText: string
  /** Shown after a signup that needs no confirmation. */
  successMessage: string
  fields: PublicFormField[]
  lists: { id: string; name: string; description: string | null }[]
  letSubscriberChoose: boolean
  consentText: string
  consentRequired: boolean
  organization: string
}

export const formSubmissionSchema = z.object({
  email: emailSchema,
  fields: z.record(z.string(), z.string().max(2000)).default({}),
  listIds: z.array(z.string()).max(50).optional(),
  consent: z.boolean().default(false),
  /** A field people cannot see. Anything in it is a bot. */
  website: z.string().max(200).optional(),
})
export type FormSubmission = z.input<typeof formSubmissionSchema>

export interface FormSubmissionResult {
  status: 'subscribed' | 'confirmation_sent' | 'already_subscribed'
  message: string
  redirectUrl: string | null
}

/** What the confirmation page is told once the link in the email has been followed. */
export interface ConfirmationResult {
  /** Partly hidden, as on the preferences page. */
  email: string
  organization: string
  /** The success message of the form they signed up on, when it was a form. */
  message: string | null
  /** That form's page to go to instead, when it has one. */
  redirectUrl: string | null
}

/** What the unsubscribe and preferences pages are told about a contact. */
export interface PublicPreferences {
  /** Partly hidden, e.g. `a•••@example.com`: the link can be forwarded. */
  email: string
  status: 'subscribed' | 'pending' | 'unsubscribed' | 'bounced' | 'complained'
  organization: string
  lists: { id: string; name: string; description: string | null; subscribed: boolean }[]
}

export const UNSUBSCRIBE_REASONS = [
  { key: 'no_longer_interested', label: 'I am no longer interested' },
  { key: 'too_many', label: 'I get too many emails' },
  { key: 'never_signed_up', label: 'I never signed up for this' },
  { key: 'inappropriate', label: 'The emails are inappropriate' },
  { key: 'other', label: 'Something else' },
] as const

export const unsubscribeSchema = z.object({
  reason: z.string().max(60).optional(),
  comment: z.string().max(1000).optional(),
})

export const preferencesSchema = z.object({
  /** The public lists to stay on. Leaving every list is not unsubscribing. */
  listIds: z.array(z.string()).max(200),
})
