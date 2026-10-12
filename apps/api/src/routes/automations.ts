import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  automationInputSchema,
  automationUpdateSchema,
  pageQuerySchema,
  renderDesign,
  type Automation,
  type AutomationRun,
  type AutomationStep,
  type Paged,
} from '@ariad/shared'
import { AppError } from '../errors.js'
import { newId, nowIso } from '../lib/crypto.js'
import { getAutomationRow, toAutomation, type AutomationRow } from '../services/automations.js'
import { writeLog } from '../services/logs.js'

const idParams = z.object({ id: z.string() })

/** Email steps built in the designer are stored as the HTML the design renders to. */
function withRenderedEmails(steps: AutomationStep[]): AutomationStep[] {
  return steps.map((step) =>
    step.type === 'email' && step.design
      ? { ...step, html: renderDesign(step.design, { preheader: step.preheader, title: step.subject }) }
      : step,
  )
}

export async function automationRoutes(base: FastifyInstance): Promise<void> {
  const app = base.withTypeProvider<ZodTypeProvider>()
  const { db } = app.ctx
  const viewer = app.requireRole('viewer')
  const editor = app.requireRole('editor')

  app.get('/automations', { preHandler: viewer }, async (): Promise<Automation[]> =>
    (db.prepare('SELECT * FROM automations ORDER BY created_at DESC').all() as AutomationRow[]).map((row) => toAutomation(db, row)),
  )

  app.post('/automations', { preHandler: editor, schema: { body: automationInputSchema } }, async (request, reply): Promise<Automation> => {
    const input = request.body
    const id = newId('aut')
    const now = nowIso()
    db.prepare(
      "INSERT INTO automations (id, name, description, status, trigger, steps, account_id, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)",
    ).run(id, input.name, input.description, JSON.stringify(input.trigger), JSON.stringify(withRenderedEmails(input.steps)), input.accountId, now, now)
    reply.code(201)
    return toAutomation(db, getAutomationRow(db, id))
  })

  app.get('/automations/:id', { preHandler: viewer, schema: { params: idParams } }, async (request): Promise<Automation> =>
    toAutomation(db, getAutomationRow(db, request.params.id)),
  )

  app.patch(
    '/automations/:id',
    { preHandler: editor, schema: { params: idParams, body: automationUpdateSchema } },
    async (request): Promise<Automation> => {
      const row = getAutomationRow(db, request.params.id)
      const input = request.body
      db.prepare('UPDATE automations SET name = ?, description = ?, trigger = ?, steps = ?, account_id = ?, updated_at = ? WHERE id = ?').run(
        input.name ?? row.name,
        input.description === undefined ? row.description : input.description,
        input.trigger ? JSON.stringify(input.trigger) : row.trigger,
        input.steps ? JSON.stringify(withRenderedEmails(input.steps)) : row.steps,
        input.accountId === undefined ? row.account_id : input.accountId,
        nowIso(),
        row.id,
      )
      return toAutomation(db, getAutomationRow(db, row.id))
    },
  )

  app.delete('/automations/:id', { preHandler: editor, schema: { params: idParams } }, async (request) => {
    const row = getAutomationRow(db, request.params.id)
    db.prepare('DELETE FROM automations WHERE id = ?').run(row.id)
    writeLog(db, 'info', 'automations', `Automation deleted: ${row.name}`, null, request.actor!.name)
    return { ok: true }
  })

  /** Turning one on needs something to send: an automation with no email in it does nothing. */
  app.post('/automations/:id/activate', { preHandler: editor, schema: { params: idParams } }, async (request): Promise<Automation> => {
    const row = getAutomationRow(db, request.params.id)
    const automation = toAutomation(db, row)
    const emails = automation.steps.filter((step) => step.type === 'email')
    if (automation.steps.length === 0) throw AppError.conflict('Add at least one step before turning this on.')
    const blank = emails.find((step) => step.type === 'email' && (!step.subject.trim() || !step.html.trim()))
    if (blank) throw AppError.conflict('One of the emails has no subject or no content yet.')
    db.prepare("UPDATE automations SET status = 'active', updated_at = ? WHERE id = ?").run(nowIso(), row.id)
    writeLog(db, 'info', 'automations', `Automation turned on: ${row.name}`, null, request.actor!.name)
    return toAutomation(db, getAutomationRow(db, row.id))
  })

  /** Pausing holds everyone where they are; nothing is lost and nothing is sent. */
  app.post('/automations/:id/pause', { preHandler: editor, schema: { params: idParams } }, async (request): Promise<Automation> => {
    const row = getAutomationRow(db, request.params.id)
    db.prepare("UPDATE automations SET status = 'paused', updated_at = ? WHERE id = ?").run(nowIso(), row.id)
    writeLog(db, 'info', 'automations', `Automation paused: ${row.name}`, null, request.actor!.name)
    return toAutomation(db, getAutomationRow(db, row.id))
  })

  app.get(
    '/automations/:id/runs',
    { preHandler: viewer, schema: { params: idParams, querystring: pageQuerySchema } },
    async (request): Promise<Paged<AutomationRun>> => {
      const { page, pageSize } = request.query
      const total = (db.prepare('SELECT COUNT(*) AS n FROM automation_runs WHERE automation_id = ?').get(request.params.id) as { n: number }).n
      const items = db
        .prepare(
          /* sql */ `SELECT r.id, r.contact_id AS contactId, c.email, r.status, r.step_index AS stepIndex, r.next_run_at AS nextRunAt,
                            r.note, r.started_at AS startedAt, r.finished_at AS finishedAt
                     FROM automation_runs r JOIN contacts c ON c.id = r.contact_id
                     WHERE r.automation_id = ? ORDER BY r.started_at DESC LIMIT ? OFFSET ?`,
        )
        .all(request.params.id, pageSize, (page - 1) * pageSize) as AutomationRun[]
      return { items, total, page, pageSize }
    },
  )
}
