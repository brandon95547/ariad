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

/**
 * The schema for a partial update: every field optional, and a field that is
 * left out stays left out.
 *
 * Not `schema.partial()`. In zod 4 a default still fires inside an optional,
 * so `partial()` turns "this request did not mention the audience" into "set
 * the audience to empty" — and a PATCH that renames a campaign wipes its
 * content. Here the defaults are taken off first, which is what an update
 * means: a default is for creating a thing, not for changing one.
 */
export function patchOf<S extends z.ZodRawShape>(schema: z.ZodObject<S>) {
  const shape: Record<string, z.ZodType> = {}
  for (const [key, field] of Object.entries(schema.shape)) {
    const inner = field instanceof z.ZodDefault ? field.unwrap() : field
    shape[key] = (inner as z.ZodType).optional()
  }
  return z.object(shape) as unknown as z.ZodObject<{
    [K in keyof S]: z.ZodOptional<S[K] extends z.ZodDefault<infer Inner> ? Inner : S[K]>
  }>
}
