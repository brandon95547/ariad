import { z } from 'zod'

/** Every authenticated route lives under this prefix. */
export const API_PREFIX = '/api/v1'

/** The one error envelope the API ever sends. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
})

/** Lower-cased and trimmed: the form an address is stored and compared in. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Deliberately loose. The only real test of an address is sending to it. */
export const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value.trim())
}

export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .refine(isEmail, 'Enter a valid email address.')
  .transform(normalizeEmail)

/** An empty string from a form field means "not set". */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null))
