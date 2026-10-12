import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  EMPTY_AUDIENCE,
  audienceSchema,
  campaignInputSchema,
  campaignUpdateSchema,
  pageQuerySchema,
  renderDesign,
  sendCampaignSchema,
  templateInputSchema,
  testSendSchema,
  type AudienceEstimate,
  type Campaign,
  type CampaignCheck,
  type CampaignRecipient,
  type CampaignReport,
  type CampaignSummary,
  type EmailDesign,
  type Paged,
  type Template,
  type TemplateSummary,
} from '@ariad/shared'
import { likeTerm, parseJson } from '../db/index.js'
import { AppError } from '../errors.js'
import { newId, nowIso, randomToken } from '../lib/crypto.js'
import { credentialsOf } from '../services/accounts.js'
import {
  accountFor,
  checkCampaign,
  estimateAudience,
  getCampaignRow,
  startCampaign,
  statsFor,
  toCampaign,
  toSummary,
  type CampaignRow,
} from '../services/campaigns.js'
import type { ContactRow } from '../services/contacts.js'
import { writeLog } from '../services/logs.js'
import { explainSmtpError } from '../services/mailer.js'
import { renderEmail } from '../services/render.js'
import { getSettings, publicUrl } from '../services/settings.js'
import { campaignSource } from '../services/worker.js'

const idParams = z.object({ id: z.string() })

/** A built message is always stored as the HTML its design renders to. */
function bodyOf(input: { html?: string; design?: EmailDesign | null; preheader?: string | null; subject?: string }): string {
  return input.design ? renderDesign(input.design, { preheader: input.preheader, title: input.subject }) : (input.html ?? '')
}

export async function campaignRoutes(base: FastifyInstance): Promise<void> {
  const app = base.withTypeProvider<ZodTypeProvider>()
  const { ctx, mailer } = app
  const { db } = ctx
  const viewer = app.requireRole('viewer')
  const editor = app.requireRole('editor')

  /* ---- Templates -------------------------------------------------------- */

  interface TemplateRow { id: string; name: string; description: string | null; subject: string; preheader: string | null; html: string; design: string | null; builtin: number; created_at: string; updated_at: string }
  const toTemplateSummary = (row: TemplateRow): TemplateSummary => ({
    id: row.id,
    name: row.name,
    description: row.description,
    subject: row.subject,
    preheader: row.preheader,
    builtin: row.builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  const toTemplate = (row: TemplateRow): Template => ({
    ...toTemplateSummary(row),
    html: row.html,
    design: parseJson<EmailDesign | null>(row.design, null),
  })
  const templateRow = (id: string): TemplateRow => {
    const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined
    if (!row) throw AppError.notFound('template')
    return row
  }

  app.get('/templates', { preHandler: viewer }, async (): Promise<TemplateSummary[]> =>
    (db.prepare('SELECT * FROM templates ORDER BY builtin ASC, updated_at DESC').all() as TemplateRow[]).map(toTemplateSummary),
  )

  app.get('/templates/:id', { preHandler: viewer, schema: { params: idParams } }, async (request): Promise<Template> =>
    toTemplate(templateRow(request.params.id)),
  )

  app.post('/templates', { preHandler: editor, schema: { body: templateInputSchema } }, async (request, reply): Promise<Template> => {
    const input = request.body
    const id = newId('tpl')
    const now = nowIso()
    db.prepare(
      'INSERT INTO templates (id, name, description, subject, preheader, html, design, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
    ).run(id, input.name, input.description, input.subject, input.preheader, bodyOf(input), input.design ? JSON.stringify(input.design) : null, now, now)
    reply.code(201)
    return toTemplate(templateRow(id))
  })

  app.patch(
    '/templates/:id',
    { preHandler: editor, schema: { params: idParams, body: templateInputSchema } },
    async (request): Promise<Template> => {
      const row = templateRow(request.params.id)
      if (row.builtin === 1) throw AppError.conflict('Starter templates cannot be edited. Duplicate it and edit the copy.')
      const input = request.body
      db.prepare('UPDATE templates SET name = ?, description = ?, subject = ?, preheader = ?, html = ?, design = ?, updated_at = ? WHERE id = ?').run(
        input.name, input.description, input.subject, input.preheader, bodyOf(input), input.design ? JSON.stringify(input.design) : null, nowIso(), row.id,
      )
      return toTemplate(templateRow(row.id))
    },
  )

  app.post('/templates/:id/duplicate', { preHandler: editor, schema: { params: idParams } }, async (request, reply): Promise<Template> => {
    const row = templateRow(request.params.id)
    const id = newId('tpl')
    const now = nowIso()
    db.prepare(
      'INSERT INTO templates (id, name, description, subject, preheader, html, design, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
    ).run(id, row.builtin === 1 ? row.name : `${row.name} (copy)`, row.description, row.subject, row.preheader, row.html, row.design, now, now)
    reply.code(201)
    return toTemplate(templateRow(id))
  })

  app.delete('/templates/:id', { preHandler: editor, schema: { params: idParams } }, async (request) => {
    const row = templateRow(request.params.id)
    if (row.builtin === 1) throw AppError.conflict('Starter templates cannot be deleted.')
    db.prepare('DELETE FROM templates WHERE id = ?').run(row.id)
    return { ok: true }
  })

  /* ---- Campaigns -------------------------------------------------------- */

  app.get(
    '/campaigns',
    {
      preHandler: viewer,
      schema: {
        querystring: pageQuerySchema.extend({
          status: z.enum(['draft', 'scheduled', 'sending', 'paused', 'sent', 'canceled']).optional(),
          q: z.string().trim().max(200).optional(),
        }),
      },
    },
    async (request): Promise<Paged<CampaignSummary>> => {
      const { page, pageSize, status, q } = request.query
      const where: string[] = []
      const params: unknown[] = []
      if (status) {
        where.push('status = ?')
        params.push(status)
      }
      if (q) {
        where.push("(name LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\')")
        params.push(`%${likeTerm(q)}%`, `%${likeTerm(q)}%`)
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const total = (db.prepare(`SELECT COUNT(*) AS n FROM campaigns ${clause}`).get(...params) as { n: number }).n
      const rows = db
        .prepare(`SELECT * FROM campaigns ${clause} ORDER BY COALESCE(started_at, scheduled_at, updated_at) DESC LIMIT ? OFFSET ?`)
        .all(...params, pageSize, (page - 1) * pageSize) as CampaignRow[]
      const stats = statsFor(db, rows.map((row) => row.id))
      return { items: rows.map((row) => toSummary(row, stats.get(row.id))), total, page, pageSize }
    },
  )

  app.post('/campaigns', { preHandler: editor, schema: { body: campaignInputSchema } }, async (request, reply): Promise<Campaign> => {
    const input = request.body
    const settings = getSettings(db)
    const id = newId('cmp')
    const now = nowIso()
    db.prepare(
      /* sql */ `INSERT INTO campaigns (id, name, subject, preheader, from_name, from_email, reply_to, account_id, audience, html, design,
                 status, track_opens, track_clicks, created_by, created_at, updated_at)
                 VALUES (@id, @name, @subject, @preheader, @fromName, @fromEmail, @replyTo, @accountId, @audience, @html, @design,
                 'draft', @trackOpens, @trackClicks, @createdBy, @now, @now)`,
    ).run({
      id,
      name: input.name,
      subject: input.subject,
      preheader: input.preheader,
      fromName: input.fromName,
      fromEmail: input.fromEmail ?? null,
      replyTo: input.replyTo ?? null,
      accountId: input.accountId,
      audience: JSON.stringify(input.audience),
      html: bodyOf(input),
      design: input.design ? JSON.stringify(input.design) : null,
      trackOpens: (input.trackOpens ?? settings.sending.trackOpens) ? 1 : 0,
      trackClicks: (input.trackClicks ?? settings.sending.trackClicks) ? 1 : 0,
      createdBy: request.actor!.kind === 'user' ? request.actor!.id : null,
      now,
    })
    reply.code(201)
    return toCampaign(db, getCampaignRow(db, id))
  })

  app.get('/campaigns/:id', { preHandler: viewer, schema: { params: idParams } }, async (request): Promise<Campaign> =>
    toCampaign(db, getCampaignRow(db, request.params.id)),
  )

  app.patch(
    '/campaigns/:id',
    { preHandler: editor, schema: { params: idParams, body: campaignUpdateSchema } },
    async (request): Promise<Campaign> => {
      const row = getCampaignRow(db, request.params.id)
      // Once recipients are queued the message is fixed: half a list getting
      // one version and half another is not something to allow by accident.
      if (row.status !== 'draft' && row.status !== 'scheduled') {
        throw AppError.conflict('This campaign has been sent and can no longer be edited. Duplicate it to send again.')
      }
      const input = request.body
      const design = input.design === undefined ? parseJson<EmailDesign | null>(row.design, null) : input.design
      const subject = input.subject ?? row.subject
      const preheader = input.preheader === undefined ? row.preheader : input.preheader
      const html =
        input.design === undefined && input.html === undefined && input.preheader === undefined && input.subject === undefined
          ? row.html
          : bodyOf({ html: input.html ?? row.html, design, preheader, subject })

      db.prepare(
        /* sql */ `UPDATE campaigns SET name = @name, subject = @subject, preheader = @preheader, from_name = @fromName,
                   from_email = @fromEmail, reply_to = @replyTo, account_id = @accountId, audience = @audience, html = @html,
                   design = @design, track_opens = @trackOpens, track_clicks = @trackClicks, updated_at = @now WHERE id = @id`,
      ).run({
        id: row.id,
        name: input.name ?? row.name,
        subject,
        preheader,
        fromName: input.fromName === undefined ? row.from_name : input.fromName,
        fromEmail: input.fromEmail === undefined ? row.from_email : input.fromEmail,
        replyTo: input.replyTo === undefined ? row.reply_to : input.replyTo,
        accountId: input.accountId === undefined ? row.account_id : input.accountId,
        audience: input.audience ? JSON.stringify(input.audience) : row.audience,
        html,
        design: design ? JSON.stringify(design) : null,
        trackOpens: input.trackOpens === undefined ? row.track_opens : input.trackOpens ? 1 : 0,
        trackClicks: input.trackClicks === undefined ? row.track_clicks : input.trackClicks ? 1 : 0,
        now: nowIso(),
      })
      return toCampaign(db, getCampaignRow(db, row.id))
    },
  )

  app.delete('/campaigns/:id', { preHandler: editor, schema: { params: idParams } }, async (request) => {
    const row = getCampaignRow(db, request.params.id)
    if (row.status === 'sending') throw AppError.conflict('Pause or cancel the campaign before deleting it.')
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(row.id)
    writeLog(db, 'info', 'campaigns', `Campaign deleted: ${row.name}`, null, request.actor!.name)
    return { ok: true }
  })

  app.post('/campaigns/:id/duplicate', { preHandler: editor, schema: { params: idParams } }, async (request, reply): Promise<Campaign> => {
    const row = getCampaignRow(db, request.params.id)
    const id = newId('cmp')
    const now = nowIso()
    db.prepare(
      /* sql */ `INSERT INTO campaigns (id, name, subject, preheader, from_name, from_email, reply_to, account_id, audience, html, design,
                 status, track_opens, track_clicks, created_by, created_at, updated_at)
                 SELECT ?, name || ' (copy)', subject, preheader, from_name, from_email, reply_to, account_id, audience, html, design,
                 'draft', track_opens, track_clicks, ?, ?, ? FROM campaigns WHERE id = ?`,
    ).run(id, request.actor!.kind === 'user' ? request.actor!.id : null, now, now, row.id)
    reply.code(201)
    return toCampaign(db, getCampaignRow(db, id))
  })

  /** Who an audience would reach, for rules that may not be saved yet. */
  app.post(
    '/audience/estimate',
    { preHandler: viewer, schema: { body: audienceSchema } },
    async (request): Promise<AudienceEstimate> => estimateAudience(db, { ...EMPTY_AUDIENCE, ...request.body }),
  )

  app.get('/campaigns/:id/checks', { preHandler: viewer, schema: { params: idParams } }, async (request): Promise<CampaignCheck[]> =>
    checkCampaign(ctx, getCampaignRow(db, request.params.id)),
  )

  /** The message exactly as a recipient gets it, minus tracking. */
  app.get(
    '/campaigns/:id/preview',
    { preHandler: viewer, schema: { params: idParams, querystring: z.object({ contactId: z.string().optional() }) } },
    async (request): Promise<{ subject: string; html: string; text: string }> => {
      const row = getCampaignRow(db, request.params.id)
      const account = accountFor(ctx, row.account_id)
      const contact = request.query.contactId
        ? (db.prepare('SELECT * FROM contacts WHERE id = ?').get(request.query.contactId) as ContactRow | undefined)
        : undefined
      const mail = renderEmail(ctx, {
        source: { ...campaignSource(row), trackOpens: false, trackClicks: false },
        // A preview must work before any account exists.
        account: account ?? ({ kind: 'smtp', from_name: '', from_email: 'you@example.com', reply_to: null } as never),
        contact: contact ?? null,
        toEmail: contact?.email ?? 'alex@example.com',
        messageToken: 'preview',
        settings: getSettings(db),
        baseUrl: publicUrl(ctx),
      })
      return { subject: mail.subject, html: mail.html, text: mail.text }
    },
  )

  /**
   * Sends the campaign to a few addresses now, outside the queue, so the
   * answer comes back while the editor is still open. Marked [Test], with no
   * tracking, and counted in nobody's statistics.
   */
  app.post(
    '/campaigns/:id/test',
    { preHandler: editor, schema: { params: idParams, body: testSendSchema } },
    async (request): Promise<{ sent: string[]; failed: { to: string; message: string }[] }> => {
      const row = getCampaignRow(db, request.params.id)
      const account = accountFor(ctx, row.account_id)
      if (!account) throw AppError.conflict('Add a sending account under Settings before sending a test.')
      const contact = request.body.contactId
        ? (db.prepare('SELECT * FROM contacts WHERE id = ?').get(request.body.contactId) as ContactRow | undefined)
        : undefined
      const sent: string[] = []
      const failed: { to: string; message: string }[] = []
      for (const to of request.body.to) {
        const mail = renderEmail(ctx, {
          source: campaignSource(row),
          account,
          contact: contact ?? null,
          toEmail: to,
          messageToken: `test_${randomToken(8)}`,
          settings: getSettings(db),
          baseUrl: publicUrl(ctx),
          test: true,
        })
        try {
          await mailer.send(credentialsOf(ctx, account), account.updated_at, mail)
          sent.push(to)
        } catch (error) {
          failed.push({ to, message: explainSmtpError(error, account) })
        }
      }
      writeLog(db, failed.length ? 'warn' : 'info', 'campaigns', `Test of "${row.name}" sent to ${sent.length} of ${request.body.to.length}`, { failed }, request.actor!.name)
      return { sent, failed }
    },
  )

  /** Sends now, or schedules. Refused while any blocking check fails. */
  app.post(
    '/campaigns/:id/send',
    { preHandler: editor, schema: { params: idParams, body: sendCampaignSchema } },
    async (request): Promise<Campaign> => {
      const row = getCampaignRow(db, request.params.id)
      if (row.status !== 'draft' && row.status !== 'scheduled') {
        throw AppError.conflict('This campaign has already been sent.')
      }
      const blocking = checkCampaign(ctx, row).filter((check) => !check.ok && check.severity === 'error')
      if (blocking.length > 0) {
        throw new AppError(422, 'not_ready', blocking[0]!.message, blocking)
      }
      const when = request.body.scheduledAt ? new Date(request.body.scheduledAt) : null
      if (when && when.getTime() > Date.now() + 30_000) {
        db.prepare("UPDATE campaigns SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?").run(when.toISOString(), nowIso(), row.id)
        writeLog(db, 'info', 'campaigns', `Campaign "${row.name}" scheduled for ${when.toISOString()}`, null, request.actor!.name)
      } else {
        startCampaign(ctx, row.id)
        void app.worker.tick()
      }
      return toCampaign(db, getCampaignRow(db, row.id))
    },
  )

  const transition = (
    path: string,
    from: CampaignRow['status'][],
    apply: (row: CampaignRow) => void,
    refusal: string,
  ) =>
    app.post(`/campaigns/:id/${path}`, { preHandler: editor, schema: { params: idParams } }, async (request): Promise<Campaign> => {
      const row = getCampaignRow(db, request.params.id)
      if (!from.includes(row.status)) throw AppError.conflict(refusal)
      apply(row)
      writeLog(db, 'info', 'campaigns', `Campaign "${row.name}": ${path}`, null, request.actor!.name)
      return toCampaign(db, getCampaignRow(db, row.id))
    })

  transition('pause', ['sending'], (row) => db.prepare("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE id = ?").run(nowIso(), row.id), 'Only a campaign that is sending can be paused.')
  transition('resume', ['paused'], (row) => db.prepare("UPDATE campaigns SET status = 'sending', updated_at = ? WHERE id = ?").run(nowIso(), row.id), 'This campaign is not paused.')
  transition('unschedule', ['scheduled'], (row) => db.prepare("UPDATE campaigns SET status = 'draft', scheduled_at = NULL, updated_at = ? WHERE id = ?").run(nowIso(), row.id), 'This campaign is not scheduled.')
  transition(
    'cancel',
    ['sending', 'paused'],
    (row) =>
      db.transaction(() => {
        db.prepare("UPDATE messages SET status = 'canceled', last_error = 'Campaign canceled' WHERE campaign_id = ? AND status = 'queued'").run(row.id)
        db.prepare("UPDATE campaigns SET status = 'canceled', finished_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), row.id)
      })(),
    'Only a campaign that is sending or paused can be canceled.',
  )

  /* ---- Reports ---------------------------------------------------------- */

  app.get('/campaigns/:id/report', { preHandler: viewer, schema: { params: idParams } }, async (request): Promise<CampaignReport> => {
    const row = getCampaignRow(db, request.params.id)
    const timeline = db
      .prepare(
        /* sql */ `SELECT substr(created_at, 1, 13) || ':00:00.000Z' AS at,
                          SUM(type = 'open') AS opens, SUM(type = 'click') AS clicks
                   FROM message_events WHERE campaign_id = ? AND type IN ('open','click')
                   GROUP BY 1 ORDER BY 1 LIMIT 240`,
      )
      .all(row.id) as { at: string; opens: number; clicks: number }[]
    const links = db
      .prepare(
        /* sql */ `SELECT url, COUNT(*) AS clicks, COUNT(DISTINCT contact_id) AS people
                   FROM message_events WHERE campaign_id = ? AND type = 'click' AND url IS NOT NULL
                   GROUP BY url ORDER BY clicks DESC LIMIT 50`,
      )
      .all(row.id) as CampaignReport['links']
    return { campaign: toCampaign(db, row), timeline, links }
  })

  app.get(
    '/campaigns/:id/recipients',
    {
      preHandler: viewer,
      schema: {
        params: idParams,
        querystring: pageQuerySchema.extend({
          filter: z.enum(['all', 'sent', 'opened', 'clicked', 'not_opened', 'bounced', 'failed', 'unsubscribed', 'queued']).default('all'),
        }),
      },
    },
    async (request): Promise<Paged<CampaignRecipient>> => {
      const { page, pageSize, filter } = request.query
      const condition = {
        all: '1 = 1',
        sent: "status = 'sent'",
        opened: 'opened_at IS NOT NULL',
        clicked: 'clicked_at IS NOT NULL',
        not_opened: "status = 'sent' AND opened_at IS NULL",
        bounced: "status = 'bounced'",
        failed: "status = 'failed'",
        unsubscribed: 'unsubscribed_at IS NOT NULL',
        queued: "status IN ('queued','sending')",
      }[filter]
      const where = `campaign_id = ? AND kind = 'campaign' AND ${condition}`
      const total = (db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE ${where}`).get(request.params.id) as { n: number }).n
      const items = db
        .prepare(
          /* sql */ `SELECT id, contact_id AS contactId, to_email AS email, status, sent_at AS sentAt, opened_at AS openedAt,
                            open_count AS openCount, clicked_at AS clickedAt, click_count AS clickCount,
                            unsubscribed_at AS unsubscribedAt, last_error AS error
                     FROM messages WHERE ${where} ORDER BY COALESCE(sent_at, queued_at) DESC LIMIT ? OFFSET ?`,
        )
        .all(request.params.id, pageSize, (page - 1) * pageSize) as CampaignRecipient[]
      return { items, total, page, pageSize }
    },
  )
}
