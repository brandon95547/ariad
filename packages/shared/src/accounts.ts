import { z } from 'zod'
import { emailSchema, optionalText } from './api.js'

/**
 * A sending account is a mailbox Ariad is allowed to send through.
 *
 * Two kinds. A Gmail account is SMTP with everything but the address and the
 * app password already known; an SMTP account is the general case, and it is
 * also how Amazon SES, SendGrid, Mailgun and the rest are connected — each of
 * them offers an SMTP endpoint, so they are presets here rather than a third
 * kind of account.
 */
export type SendingAccountKind = 'gmail' | 'smtp'
export type SmtpSecurity = 'ssl' | 'starttls' | 'none'
export type SendingAccountStatus = 'unverified' | 'ok' | 'error'

export interface SendingAccount {
  id: string
  kind: SendingAccountKind
  label: string
  fromName: string
  fromEmail: string
  replyTo: string | null
  host: string
  port: number
  security: SmtpSecurity
  username: string
  /** Emails per rolling 24 hours. Queued mail waits when it is reached. */
  dailyLimit: number
  /** Emails per minute. */
  perMinute: number
  enabled: boolean
  isDefault: boolean
  status: SendingAccountStatus
  lastError: string | null
  lastVerifiedAt: string | null
  /** Set when the provider told us to stop for a while (a quota, a block). */
  pausedUntil: string | null
  sentLast24h: number
  queued: number
  createdAt: string
  updatedAt: string
}

export const GMAIL_SMTP = { host: 'smtp.gmail.com', port: 465, security: 'ssl' } as const

/** Google's own ceiling for a consumer account; Workspace accounts get 2,000. */
export const GMAIL_DAILY_LIMIT = 500
export const GMAIL_WORKSPACE_DAILY_LIMIT = 2000

export interface SmtpPreset {
  id: string
  label: string
  host: string
  port: number
  security: SmtpSecurity
  /** What goes in the username field, when it is not the mailbox address. */
  usernameHint?: string
  passwordHint?: string
  dailyLimit: number
  perMinute: number
}

export const SMTP_PRESETS: readonly SmtpPreset[] = [
  { id: 'custom', label: 'Custom SMTP server', host: '', port: 587, security: 'starttls', dailyLimit: 2000, perMinute: 30 },
  { id: 'ses', label: 'Amazon SES', host: 'email-smtp.us-east-1.amazonaws.com', port: 587, security: 'starttls', usernameHint: 'SMTP username from the SES console (not your AWS access key)', passwordHint: 'SMTP password from the SES console', dailyLimit: 50000, perMinute: 600 },
  { id: 'sendgrid', label: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, security: 'starttls', usernameHint: 'The literal word "apikey"', passwordHint: 'Your SendGrid API key', dailyLimit: 50000, perMinute: 600 },
  { id: 'mailgun', label: 'Mailgun', host: 'smtp.mailgun.org', port: 587, security: 'starttls', usernameHint: 'postmaster@your-domain', dailyLimit: 50000, perMinute: 600 },
  { id: 'postmark', label: 'Postmark', host: 'smtp.postmarkapp.com', port: 587, security: 'starttls', usernameHint: 'Your server API token', passwordHint: 'The same server API token', dailyLimit: 50000, perMinute: 600 },
  { id: 'brevo', label: 'Brevo', host: 'smtp-relay.brevo.com', port: 587, security: 'starttls', dailyLimit: 300, perMinute: 60 },
  { id: 'outlook', label: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, security: 'starttls', dailyLimit: 10000, perMinute: 30 },
  { id: 'zoho', label: 'Zoho Mail', host: 'smtp.zoho.com', port: 465, security: 'ssl', dailyLimit: 500, perMinute: 20 },
  { id: 'yahoo', label: 'Yahoo Mail', host: 'smtp.mail.yahoo.com', port: 465, security: 'ssl', passwordHint: 'An app password, not your sign-in password', dailyLimit: 500, perMinute: 20 },
  { id: 'icloud', label: 'iCloud Mail', host: 'smtp.mail.me.com', port: 587, security: 'starttls', passwordHint: 'An app-specific password', dailyLimit: 1000, perMinute: 20 },
]

const limits = {
  dailyLimit: z.coerce.number().int().min(1).max(1_000_000).optional(),
  perMinute: z.coerce.number().int().min(1).max(10_000).optional(),
}

/**
 * Google shows an app password as four groups of four letters. People paste it
 * with the spaces, so the spaces are removed here rather than rejected.
 */
const appPasswordSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ''))
  .refine((value) => /^[a-z]{16}$/i.test(value), {
    message:
      'A Google app password is 16 letters. This is not your Google sign-in password — create one at myaccount.google.com/apppasswords.',
  })

export const createGmailAccountSchema = z.object({
  kind: z.literal('gmail'),
  email: emailSchema,
  appPassword: appPasswordSchema,
  fromName: z.string().trim().min(1, 'Enter the name recipients will see.').max(120),
  label: optionalText(120),
  replyTo: emailSchema.nullish().or(z.literal('').transform(() => null)),
  ...limits,
})

export const createSmtpAccountSchema = z.object({
  kind: z.literal('smtp'),
  label: z.string().trim().min(1, 'Give the account a name.').max(120),
  host: z.string().trim().min(1, 'Enter the SMTP host.').max(255),
  port: z.coerce.number().int().min(1).max(65535),
  security: z.enum(['ssl', 'starttls', 'none']),
  username: z.string().trim().max(320).default(''),
  password: z.string().max(1024).default(''),
  fromName: z.string().trim().min(1, 'Enter the name recipients will see.').max(120),
  fromEmail: emailSchema,
  replyTo: emailSchema.nullish().or(z.literal('').transform(() => null)),
  ...limits,
})

export const createSendingAccountSchema = z.discriminatedUnion('kind', [
  createGmailAccountSchema,
  createSmtpAccountSchema,
])
export type CreateSendingAccountInput = z.input<typeof createSendingAccountSchema>

/** A blank password on an update means "keep the one already stored". */
export const updateSendingAccountSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  fromName: z.string().trim().min(1).max(120).optional(),
  fromEmail: emailSchema.optional(),
  replyTo: emailSchema.nullish().or(z.literal('').transform(() => null)),
  host: z.string().trim().min(1).max(255).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  security: z.enum(['ssl', 'starttls', 'none']).optional(),
  username: z.string().trim().max(320).optional(),
  password: z.string().max(1024).optional(),
  enabled: z.boolean().optional(),
  ...limits,
})
export type UpdateSendingAccountInput = z.input<typeof updateSendingAccountSchema>

export const sendTestSchema = z.object({ to: emailSchema })

export interface VerifyResult {
  ok: boolean
  /** A sentence a person can act on, not the raw SMTP error. */
  message: string
  /** The raw error, for the curious and for support. */
  detail?: string
}
