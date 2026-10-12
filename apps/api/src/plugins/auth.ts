import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { roleAtLeast, type Role, type User } from '@ariad/shared'
import { AppError } from '../errors.js'
import { isoIn, nowIso, randomToken, sha256 } from '../lib/crypto.js'

/**
 * Who is making this request.
 *
 * Two ways in: a session cookie, for a person in the app, and an API key in
 * an Authorization header, for a script. Both resolve to an actor with a role,
 * and every route states the least role it will accept — so a route with no
 * `requireRole` is a route that is public on purpose.
 */
export interface Actor {
  kind: 'user' | 'key'
  id: string
  name: string
  role: Role
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null
  }
  interface FastifyInstance {
    requireRole: (minimum: Role) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export const SESSION_COOKIE = 'ariad_session'
const SESSION_DAYS = 30

interface UserRow {
  id: string
  email: string
  name: string
  password_hash: string
  role: Role
  status: 'active' | 'disabled'
  created_at: string
  last_login_at: string | null
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  }
}

export type { UserRow }

export function startSession(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): void {
  const token = randomToken(32)
  const now = nowIso()
  app.ctx.db
    .prepare(
      'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      sha256(token),
      userId,
      now,
      isoIn(SESSION_DAYS * 86_400_000),
      String(request.headers['user-agent'] ?? '').slice(0, 300),
      request.ip,
    )
  app.ctx.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, userId)
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    // Lax: sent on a link into the app, never on a cross-site POST. With JSON
    // bodies only, that is what keeps another site from acting as the user.
    sameSite: 'lax',
    secure: request.protocol === 'https',
    maxAge: SESSION_DAYS * 86_400,
  })
}

export function endSession(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const token = request.cookies[SESSION_COOKIE]
  if (token) app.ctx.db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token))
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}

export const authPlugin = fp(
  async function authPlugin(app: FastifyInstance) {
    const { db } = app.ctx

    const bySession = db.prepare(/* sql */ `
      SELECT u.id, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ? AND u.status = 'active'
    `)
    const byKey = db.prepare(
      'SELECT id, name, role FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL',
    )
    const touchKey = db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')

    app.decorateRequest('actor', null)

    app.addHook('onRequest', async (request) => {
      const header = request.headers.authorization
      if (header?.startsWith('Bearer ')) {
        const key = byKey.get(sha256(header.slice(7).trim())) as
          { id: string; name: string; role: Role } | undefined
        if (key) {
          touchKey.run(nowIso(), key.id)
          request.actor = { kind: 'key', id: key.id, name: `API key: ${key.name}`, role: key.role }
        }
        return
      }
      const token = request.cookies[SESSION_COOKIE]
      if (!token) return
      const user = bySession.get(sha256(token), nowIso()) as
        { id: string; name: string; role: Role } | undefined
      if (user) request.actor = { kind: 'user', ...user }
    })

    app.decorate('requireRole', (minimum: Role) => async (request: FastifyRequest) => {
      if (!request.actor) throw AppError.unauthorized()
      if (!roleAtLeast(request.actor.role, minimum)) {
        throw AppError.forbidden(`This needs the ${minimum} role or higher.`)
      }
    })

    // Expired sessions are swept on boot; there are never many.
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso())
  },
  { name: 'ariad-auth' },
)
