import { z } from 'zod'
import { emailSchema } from './api.js'

/**
 * Four roles, each a superset of the one before it.
 *
 *   viewer  reads everything except credentials
 *   editor  + contacts, templates, campaigns, automations, forms
 *   admin   + sending accounts, settings, domains, users, API keys, logs
 *   owner   + other owners; the last owner cannot be removed or demoted
 */
export const ROLES = ['viewer', 'editor', 'admin', 'owner'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  viewer: 'Viewer',
  editor: 'Editor',
  admin: 'Admin',
  owner: 'Owner',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  viewer: 'Can see contacts, campaigns and reports. Cannot change anything.',
  editor: 'Can manage contacts, templates, campaigns, automations and forms.',
  admin: 'Everything an editor can do, plus sending accounts, settings, users and API keys.',
  owner: 'Full access, including other owners.',
}

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(minimum)
}

export interface User {
  id: string
  email: string
  name: string
  role: Role
  status: 'active' | 'disabled'
  createdAt: string
  lastLoginAt: string | null
}

export interface AuthState {
  /** True until the first account exists; the app shows setup instead of login. */
  needsSetup: boolean
  user: User | null
}

const passwordSchema = z.string().min(8, 'Use at least 8 characters.').max(200)

export const setupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
  organization: z.string().trim().min(1).max(160),
})
export type SetupInput = z.input<typeof setupSchema>

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) })
export type LoginInput = z.input<typeof loginSchema>

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  currentPassword: z.string().max(200).optional(),
  newPassword: passwordSchema.optional(),
})
export type UpdateProfileInput = z.input<typeof updateProfileSchema>

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  role: z.enum(ROLES),
  password: passwordSchema,
})
export type CreateUserInput = z.input<typeof createUserSchema>

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  password: passwordSchema.optional(),
})
export type UpdateUserInput = z.input<typeof updateUserSchema>

export interface ApiKey {
  id: string
  name: string
  /** The first characters of the key, enough to tell two apart. */
  prefix: string
  role: Role
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.enum(['viewer', 'editor', 'admin']).default('editor'),
})
export type CreateApiKeyInput = z.input<typeof createApiKeySchema>
