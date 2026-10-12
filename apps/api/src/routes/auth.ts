import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  createApiKeySchema,
  createUserSchema,
  loginSchema,
  roleAtLeast,
  setupSchema,
  updateProfileSchema,
  updateUserSchema,
  type ApiKey,
  type AuthState,
  type Role,
  type User,
} from '@ariad/shared'
import { AppError } from '../errors.js'
import { hashPassword, newId, nowIso, randomToken, sha256, verifyPassword } from '../lib/crypto.js'
import { endSession, startSession, toUser, type UserRow } from '../plugins/auth.js'
import { updateSettings } from '../services/settings.js'
import { writeLog } from '../services/logs.js'

const idParams = z.object({ id: z.string() })

/**
 * Failed sign-ins per address and per client, in memory. Ten in fifteen
 * minutes and the door closes for the rest of the window. In memory is enough:
 * a restart forgetting the count costs an attacker nothing they could not get
 * by waiting, and it means no table to clean.
 */
const WINDOW_MS = 15 * 60_000
const MAX_FAILURES = 10
const failures = new Map<string, { count: number; resetAt: number }>()

function tooManyFailures(key: string): boolean {
  const entry = failures.get(key)
  if (!entry) return false
  if (entry.resetAt < Date.now()) {
    failures.delete(key)
    return false
  }
  return entry.count >= MAX_FAILURES
}

function recordFailure(key: string): void {
  const entry = failures.get(key)
  if (!entry || entry.resetAt < Date.now()) failures.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS })
  else entry.count += 1
}

export async function authRoutes(base: FastifyInstance): Promise<void> {
  const app = base.withTypeProvider<ZodTypeProvider>()
  const { db } = app.ctx

  const userCount = () => (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
  const userById = (id: string) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  const ownerCount = () =>
    (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND status = 'active'").get() as { n: number }).n

  app.get('/auth/state', async (request): Promise<AuthState> => {
    const user = request.actor?.kind === 'user' ? userById(request.actor.id) : undefined
    return { needsSetup: userCount() === 0, user: user ? toUser(user) : null }
  })

  /** Creates the first account. Closed for good the moment one exists. */
  app.post('/auth/setup', { schema: { body: setupSchema } }, async (request, reply): Promise<AuthState> => {
    if (userCount() > 0) throw AppError.conflict('Ariad is already set up. Sign in instead.')
    const { name, email, password, organization } = request.body
    const id = newId('usr')
    db.prepare(
      "INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'owner', ?)",
    ).run(id, email, name, hashPassword(password), nowIso())
    updateSettings(db, { organization: { name: organization } })
    writeLog(db, 'info', 'auth', `Ariad was set up by ${name}`, null, name)
    startSession(app, request, reply, id)
    return { needsSetup: false, user: toUser(userById(id)!) }
  })

  app.post('/auth/login', { schema: { body: loginSchema } }, async (request, reply): Promise<AuthState> => {
    const { email, password } = request.body
    const throttleKey = `${request.ip}|${email}`
    if (tooManyFailures(throttleKey)) {
      throw new AppError(429, 'too_many_attempts', 'Too many attempts. Wait fifteen minutes and try again.')
    }
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
    // The same answer for a wrong password and an unknown address: which
    // addresses have accounts is not something to tell a stranger.
    if (!row || row.status !== 'active' || !verifyPassword(password, row.password_hash)) {
      recordFailure(throttleKey)
      throw AppError.unauthorized('That email and password do not match.')
    }
    failures.delete(throttleKey)
    startSession(app, request, reply, row.id)
    return { needsSetup: false, user: toUser(userById(row.id)!) }
  })

  app.post('/auth/logout', async (request, reply) => {
    endSession(app, request, reply)
    return { ok: true }
  })

  app.patch(
    '/auth/me',
    { preHandler: app.requireRole('viewer'), schema: { body: updateProfileSchema } },
    async (request): Promise<User> => {
      if (request.actor?.kind !== 'user') throw AppError.forbidden('An API key has no profile.')
      const row = userById(request.actor.id)!
      const { name, currentPassword, newPassword } = request.body
      if (newPassword) {
        if (!currentPassword || !verifyPassword(currentPassword, row.password_hash)) {
          throw AppError.badRequest('Your current password is not right.')
        }
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), row.id)
      }
      if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, row.id)
      return toUser(userById(row.id)!)
    },
  )

  /* ---- Users ------------------------------------------------------------ */

  app.get('/users', { preHandler: app.requireRole('admin') }, async (): Promise<User[]> => {
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as UserRow[]
    return rows.map(toUser)
  })

  /** Only an owner hands out, changes or takes away the owner role. */
  const guardOwner = (actorRole: Role, target: Role | undefined, next?: Role) => {
    if ((target === 'owner' || next === 'owner') && !roleAtLeast(actorRole, 'owner')) {
      throw AppError.forbidden('Only an owner can manage owners.')
    }
  }

  app.post(
    '/users',
    { preHandler: app.requireRole('admin'), schema: { body: createUserSchema } },
    async (request): Promise<User> => {
      const { name, email, role, password } = request.body
      guardOwner(request.actor!.role, undefined, role)
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
        throw AppError.conflict(`${email} already has an account.`)
      }
      const id = newId('usr')
      db.prepare(
        'INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, email, name, hashPassword(password), role, nowIso())
      writeLog(db, 'info', 'users', `User added: ${email} (${role})`, null, request.actor!.name)
      return toUser(userById(id)!)
    },
  )

  app.patch(
    '/users/:id',
    { preHandler: app.requireRole('admin'), schema: { params: idParams, body: updateUserSchema } },
    async (request): Promise<User> => {
      const row = userById(request.params.id)
      if (!row) throw AppError.notFound('user')
      const { name, role, status, password } = request.body
      guardOwner(request.actor!.role, row.role, role)

      const losesOwner = row.role === 'owner' && ((role && role !== 'owner') || status === 'disabled')
      if (losesOwner && ownerCount() <= 1) {
        throw AppError.conflict('This is the only owner. Make someone else an owner first.')
      }
      if (status === 'disabled' && row.id === request.actor!.id) {
        throw AppError.conflict('You cannot disable your own account.')
      }

      db.prepare(
        'UPDATE users SET name = ?, role = ?, status = ?, password_hash = ? WHERE id = ?',
      ).run(
        name ?? row.name,
        role ?? row.role,
        status ?? row.status,
        password ? hashPassword(password) : row.password_hash,
        row.id,
      )
      // A disabled account or a new password ends every session it had open.
      if (status === 'disabled' || password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id)
      writeLog(db, 'info', 'users', `User updated: ${row.email}`, { role, status }, request.actor!.name)
      return toUser(userById(row.id)!)
    },
  )

  app.delete(
    '/users/:id',
    { preHandler: app.requireRole('admin'), schema: { params: idParams } },
    async (request) => {
      const row = userById(request.params.id)
      if (!row) throw AppError.notFound('user')
      guardOwner(request.actor!.role, row.role)
      if (row.id === request.actor!.id) throw AppError.conflict('You cannot delete your own account.')
      if (row.role === 'owner' && ownerCount() <= 1) {
        throw AppError.conflict('This is the only owner. Make someone else an owner first.')
      }
      db.prepare('DELETE FROM users WHERE id = ?').run(row.id)
      writeLog(db, 'warn', 'users', `User removed: ${row.email}`, null, request.actor!.name)
      return { ok: true }
    },
  )

  /* ---- API keys --------------------------------------------------------- */

  interface KeyRow {
    id: string
    name: string
    prefix: string
    role: Role
    created_at: string
    last_used_at: string | null
    revoked_at: string | null
  }
  const toKey = (row: KeyRow): ApiKey => ({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    role: row.role,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  })

  app.get('/api-keys', { preHandler: app.requireRole('admin') }, async (): Promise<ApiKey[]> => {
    const rows = db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all() as KeyRow[]
    return rows.map(toKey)
  })

  /**
   * The key is returned once, here, and only its hash is kept. There is no
   * "show key" afterwards because there is nothing left to show.
   */
  app.post(
    '/api-keys',
    { preHandler: app.requireRole('admin'), schema: { body: createApiKeySchema } },
    async (request): Promise<{ key: ApiKey; secret: string }> => {
      const secret = `ariad_${randomToken(30)}`
      const id = newId('key')
      db.prepare(
        'INSERT INTO api_keys (id, name, prefix, key_hash, role, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        request.body.name,
        secret.slice(0, 12),
        sha256(secret),
        request.body.role,
        request.actor!.kind === 'user' ? request.actor!.id : null,
        nowIso(),
      )
      writeLog(db, 'info', 'api-keys', `API key created: ${request.body.name}`, null, request.actor!.name)
      return { key: toKey(db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as KeyRow), secret }
    },
  )

  app.delete(
    '/api-keys/:id',
    { preHandler: app.requireRole('admin'), schema: { params: idParams } },
    async (request) => {
      const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(request.params.id) as KeyRow | undefined
      if (!row) throw AppError.notFound('API key')
      db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(nowIso(), row.id)
      writeLog(db, 'warn', 'api-keys', `API key revoked: ${row.name}`, null, request.actor!.name)
      return { ok: true }
    },
  )
}
