import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  domainInputSchema,
  pageQuerySchema,
  settingsUpdateSchema,
  type DnsCheck,
  type LogEntry,
  type Paged,
  type QueueStatus,
  type SendingDomain,
  type Settings,
} from '@ariad/shared'
import { parseJson } from '../db/index.js'
import { AppError } from '../errors.js'
import { newId, nowIso } from '../lib/crypto.js'
import { FREE_MAIL_DOMAINS, checkDomain } from '../services/dns.js'
import { listLogs, writeLog } from '../services/logs.js'
import { getSettings, isLocalUrl, publicUrl, updateSettings } from '../services/settings.js'

const idParams = z.object({ id: z.string() })

const UNCHECKED: DnsCheck = { status: 'unknown', summary: 'Not checked yet.', record: null, advice: null }

export async function settingsRoutes(base: FastifyInstance): Promise<void> {
  const app = base.withTypeProvider<ZodTypeProvider>()
  const { ctx } = app
  const { db } = ctx
  const viewer = app.requireRole('viewer')
  const admin = app.requireRole('admin')

  /* ---- Settings --------------------------------------------------------- */

  /** `effectivePublicUrl` is what links are really built from, with the fallback applied. */
  const settingsView = (): Settings & { effectivePublicUrl: string; publicUrlIsLocal: boolean } => {
    const url = publicUrl(ctx)
    return { ...getSettings(db), effectivePublicUrl: url, publicUrlIsLocal: isLocalUrl(url) }
  }

  app.get('/settings', { preHandler: viewer }, async () => settingsView())

  app.patch('/settings', { preHandler: admin, schema: { body: settingsUpdateSchema } }, async (request) => {
    updateSettings(db, request.body)
    writeLog(db, 'info', 'settings', `Settings updated: ${Object.keys(request.body).join(', ')}`, null, request.actor!.name)
    return settingsView()
  })

  /* ---- Queue ------------------------------------------------------------ */

  app.get('/queue', { preHandler: viewer }, async (): Promise<QueueStatus> => app.worker.queueStatus())

  /** Tries everything that is waiting on a retry now, instead of at its backoff time. */
  app.post('/queue/retry', { preHandler: admin }, async () => {
    const now = nowIso()
    const result = db.prepare("UPDATE messages SET next_attempt_at = ? WHERE status = 'queued' AND next_attempt_at > ?").run(now, now)
    db.prepare('UPDATE sending_accounts SET paused_until = NULL WHERE paused_until IS NOT NULL').run()
    void app.worker.tick()
    return { retried: result.changes }
  })

  /* ---- Logs ------------------------------------------------------------- */

  app.get(
    '/logs',
    {
      preHandler: admin,
      schema: {
        querystring: pageQuerySchema.extend({
          level: z.enum(['info', 'warn', 'error']).optional(),
          scope: z.string().max(40).optional(),
          q: z.string().trim().max(200).optional(),
        }),
      },
    },
    async (request): Promise<Paged<LogEntry> & { scopes: string[] }> => ({
      ...listLogs(db, request.query),
      scopes: (db.prepare('SELECT DISTINCT scope FROM logs ORDER BY scope').all() as { scope: string }[]).map((row) => row.scope),
    }),
  )

  /* ---- Domains ---------------------------------------------------------- */

  interface DomainRow { id: string; domain: string; dkim_selector: string | null; result: string | null; checked_at: string | null; created_at: string }
  const toDomain = (row: DomainRow): SendingDomain => {
    const result = parseJson<Partial<Pick<SendingDomain, 'spf' | 'dkim' | 'dmarc' | 'mx'>>>(row.result, {})
    return {
      id: row.id,
      domain: row.domain,
      dkimSelector: row.dkim_selector,
      spf: result.spf ?? UNCHECKED,
      dkim: result.dkim ?? UNCHECKED,
      dmarc: result.dmarc ?? UNCHECKED,
      mx: result.mx ?? UNCHECKED,
      checkedAt: row.checked_at,
      createdAt: row.created_at,
    }
  }
  const domainRow = (id: string): DomainRow => {
    const row = db.prepare('SELECT * FROM domains WHERE id = ?').get(id) as DomainRow | undefined
    if (!row) throw AppError.notFound('domain')
    return row
  }

  /** Looks the records up and stores what was found, so the page opens with an answer. */
  const runCheck = async (row: DomainRow): Promise<SendingDomain> => {
    // The SPF advice names the provider this domain is actually sent through.
    const account = db.prepare("SELECT host FROM sending_accounts WHERE from_email LIKE ? ORDER BY is_default DESC LIMIT 1").get(`%@${row.domain}`) as { host: string } | undefined
    const { selector, ...result } = await checkDomain(row.domain, row.dkim_selector, account?.host ?? null)
    db.prepare('UPDATE domains SET result = ?, checked_at = ?, dkim_selector = COALESCE(dkim_selector, ?) WHERE id = ?').run(
      JSON.stringify(result),
      nowIso(),
      result.dkim.status === 'pass' ? selector : null,
      row.id,
    )
    return toDomain(domainRow(row.id))
  }

  app.get('/domains', { preHandler: viewer }, async (): Promise<{ domains: SendingDomain[]; suggested: string[]; freeMail: string[] }> => {
    const rows = db.prepare('SELECT * FROM domains ORDER BY domain').all() as DomainRow[]
    const have = new Set(rows.map((row) => row.domain.toLowerCase()))
    const used = (db.prepare('SELECT DISTINCT from_email FROM sending_accounts').all() as { from_email: string }[])
      .map((row) => row.from_email.split('@')[1]?.toLowerCase() ?? '')
      .filter(Boolean)
    return {
      domains: rows.map(toDomain),
      // Domains you send from and have not added: the ones worth checking.
      suggested: [...new Set(used)].filter((domain) => !have.has(domain) && !FREE_MAIL_DOMAINS.has(domain)),
      freeMail: [...new Set(used)].filter((domain) => FREE_MAIL_DOMAINS.has(domain)),
    }
  })

  app.post('/domains', { preHandler: admin, schema: { body: domainInputSchema } }, async (request, reply): Promise<SendingDomain> => {
    const { domain, dkimSelector } = request.body
    if (FREE_MAIL_DOMAINS.has(domain)) {
      throw AppError.badRequest(`${domain} belongs to its mail provider, which publishes these records itself. There is nothing to set up, and nothing you could change.`)
    }
    if (db.prepare('SELECT 1 FROM domains WHERE domain = ?').get(domain)) throw AppError.conflict(`${domain} is already added.`)
    const id = newId('dom')
    db.prepare('INSERT INTO domains (id, domain, dkim_selector, created_at) VALUES (?, ?, ?, ?)').run(id, domain, dkimSelector, nowIso())
    reply.code(201)
    return runCheck(domainRow(id))
  })

  app.patch(
    '/domains/:id',
    { preHandler: admin, schema: { params: idParams, body: domainInputSchema.pick({ dkimSelector: true }) } },
    async (request): Promise<SendingDomain> => {
      const row = domainRow(request.params.id)
      db.prepare('UPDATE domains SET dkim_selector = ? WHERE id = ?').run(request.body.dkimSelector, row.id)
      return runCheck(domainRow(row.id))
    },
  )

  app.post('/domains/:id/check', { preHandler: viewer, schema: { params: idParams } }, async (request): Promise<SendingDomain> =>
    runCheck(domainRow(request.params.id)),
  )

  app.delete('/domains/:id', { preHandler: admin, schema: { params: idParams } }, async (request) => {
    db.prepare('DELETE FROM domains WHERE id = ?').run(request.params.id)
    return { ok: true }
  })
}
