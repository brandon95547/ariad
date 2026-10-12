import { z } from 'zod'

/**
 * Account-wide settings. The organization block is not cosmetic: CAN-SPAM
 * requires a valid physical postal address in every commercial message, so the
 * footer is built from it and a campaign will not send without it.
 */
export interface Organization {
  name: string
  address1: string
  address2: string
  city: string
  region: string
  postalCode: string
  country: string
  website: string
}

export interface Settings {
  organization: Organization
  /**
   * The address recipients' mail clients reach this server at. Tracking
   * pixels, click links and unsubscribe links are built from it, so it has to
   * be reachable from the internet — `localhost` works only for your own inbox
   * on your own machine.
   */
  publicUrl: string
  timezone: string
  sending: {
    defaultAccountId: string | null
    /** Tries per message before it is marked failed. */
    maxAttempts: number
    trackOpens: boolean
    trackClicks: boolean
  }
  compliance: {
    /** New lists and forms start with double opt-in on. */
    doubleOptInDefault: boolean
    /** Extra line under the address, e.g. why the recipient is getting this. */
    footerNote: string
  }
}

/** Settings as the app reads them: with the public URL's fallback already applied. */
export interface SettingsView extends Settings {
  /** What links are really built from: the saved value, or the server's own address. */
  effectivePublicUrl: string
  /** That address only works on the machine Ariad runs on. */
  publicUrlIsLocal: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  organization: {
    name: '',
    address1: '',
    address2: '',
    city: '',
    region: '',
    postalCode: '',
    country: '',
    website: '',
  },
  publicUrl: '',
  timezone: 'America/New_York',
  sending: { defaultAccountId: null, maxAttempts: 5, trackOpens: true, trackClicks: true },
  compliance: {
    doubleOptInDefault: true,
    footerNote: 'You are receiving this email because you subscribed to our list.',
  },
}

const line = (max = 200) => z.string().trim().max(max)

export const settingsUpdateSchema = z.object({
  organization: z
    .object({
      name: line(160),
      address1: line(),
      address2: line(),
      city: line(120),
      region: line(120),
      postalCode: line(40),
      country: line(120),
      website: line(300),
    })
    .partial()
    .optional(),
  publicUrl: z
    .string()
    .trim()
    .max(300)
    .refine((value) => value === '' || /^https?:\/\/[^\s/]+/i.test(value), {
      message: 'Start with http:// or https://',
    })
    .transform((value) => value.replace(/\/+$/, ''))
    .optional(),
  timezone: line(80).optional(),
  sending: z
    .object({
      defaultAccountId: z.string().nullable(),
      maxAttempts: z.number().int().min(1).max(10),
      trackOpens: z.boolean(),
      trackClicks: z.boolean(),
    })
    .partial()
    .optional(),
  compliance: z
    .object({ doubleOptInDefault: z.boolean(), footerNote: line(500) })
    .partial()
    .optional(),
})
export type SettingsUpdateInput = z.input<typeof settingsUpdateSchema>

/** The address as one line, or '' while it is still incomplete. */
export function formatAddress(org: Organization): string {
  if (!org.address1 || !org.city) return ''
  const cityLine = [org.city, [org.region, org.postalCode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  return [org.address1, org.address2, cityLine, org.country].filter(Boolean).join(', ')
}

export type DnsCheckStatus = 'pass' | 'warn' | 'fail' | 'unknown'

export interface DnsCheck {
  status: DnsCheckStatus
  /** What was found, or what was looked for and not found. */
  summary: string
  /** The record as published, when there is one. */
  record: string | null
  /** What to do about it. */
  advice: string | null
}

export interface SendingDomain {
  id: string
  domain: string
  /** The DKIM selector to look up, e.g. `google` for Google Workspace. */
  dkimSelector: string | null
  spf: DnsCheck
  dkim: DnsCheck
  dmarc: DnsCheck
  mx: DnsCheck
  checkedAt: string | null
  createdAt: string
}

export const domainInputSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/, 'Enter a domain such as example.com.'),
  dkimSelector: z
    .string()
    .trim()
    .max(63)
    .regex(/^[a-z0-9._-]*$/i)
    .nullish()
    .transform((value) => value || null),
})
export type DomainInput = z.input<typeof domainInputSchema>

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string
  level: LogLevel
  /** Which part of the system spoke: `queue`, `smtp`, `auth`, `import`… */
  scope: string
  message: string
  detail: Record<string, unknown> | null
  userName: string | null
  createdAt: string
}
