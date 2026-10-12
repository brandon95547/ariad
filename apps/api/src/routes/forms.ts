import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { formInputSchema, type FormFieldDef, type SignupForm } from '@ariad/shared'
import { parseJson, type Db } from '../db/index.js'
import { AppError } from '../errors.js'
import { newId, nowIso } from '../lib/crypto.js'
import { writeLog } from '../services/logs.js'

const idParams = z.object({ id: z.string() })

export interface FormRow {
  id: string
  name: string
  title: string
  description: string | null
  button_text: string
  success_message: string
  redirect_url: string | null
  list_ids: string
  let_subscriber_choose: number
  tag_ids: string
  fields: string
  double_opt_in: number
  consent_text: string
  consent_required: number
  enabled: number
  submissions: number
  created_at: string
  updated_at: string
}

export function toForm(row: FormRow): SignupForm {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description,
    buttonText: row.button_text,
    successMessage: row.success_message,
    redirectUrl: row.redirect_url,
    listIds: parseJson<string[]>(row.list_ids, []),
    letSubscriberChoose: row.let_subscriber_choose === 1,
    tagIds: parseJson<string[]>(row.tag_ids, []),
    fields: parseJson<FormFieldDef[]>(row.fields, []),
    doubleOptIn: row.double_opt_in === 1,
    consentText: row.consent_text,
    consentRequired: row.consent_required === 1,
    enabled: row.enabled === 1,
    submissions: row.submissions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getFormRow(db: Db, id: string): FormRow {
  const row = db.prepare('SELECT * FROM forms WHERE id = ?').get(id) as FormRow | undefined
  if (!row) throw AppError.notFound('form')
  return row
}

export async function formRoutes(base: FastifyInstance): Promise<void> {
  const app = base.withTypeProvider<ZodTypeProvider>()
  const { db } = app.ctx
  const viewer = app.requireRole('viewer')
  const editor = app.requireRole('editor')

  const write = (
    id: string,
    input: z.output<typeof formInputSchema>,
    now: string,
    isNew: boolean,
  ) => {
    const values = {
      id,
      name: input.name,
      title: input.title,
      description: input.description,
      buttonText: input.buttonText,
      successMessage: input.successMessage,
      redirectUrl: input.redirectUrl ?? null,
      listIds: JSON.stringify(input.listIds),
      choose: input.letSubscriberChoose ? 1 : 0,
      tagIds: JSON.stringify(input.tagIds),
      fields: JSON.stringify(input.fields),
      doubleOptIn: input.doubleOptIn ? 1 : 0,
      consentText: input.consentText,
      consentRequired: input.consentRequired ? 1 : 0,
      enabled: input.enabled ? 1 : 0,
      now,
    }
    if (isNew) {
      db.prepare(
        /* sql */ `INSERT INTO forms (id, name, title, description, button_text, success_message, redirect_url, list_ids,
                   let_subscriber_choose, tag_ids, fields, double_opt_in, consent_text, consent_required, enabled, created_at, updated_at)
                   VALUES (@id, @name, @title, @description, @buttonText, @successMessage, @redirectUrl, @listIds,
                   @choose, @tagIds, @fields, @doubleOptIn, @consentText, @consentRequired, @enabled, @now, @now)`,
      ).run(values)
    } else {
      db.prepare(
        /* sql */ `UPDATE forms SET name = @name, title = @title, description = @description, button_text = @buttonText,
                   success_message = @successMessage, redirect_url = @redirectUrl, list_ids = @listIds,
                   let_subscriber_choose = @choose, tag_ids = @tagIds, fields = @fields, double_opt_in = @doubleOptIn,
                   consent_text = @consentText, consent_required = @consentRequired, enabled = @enabled, updated_at = @now
                   WHERE id = @id`,
      ).run(values)
    }
  }

  app.get('/forms', { preHandler: viewer }, async (): Promise<SignupForm[]> =>
    (db.prepare('SELECT * FROM forms ORDER BY created_at DESC').all() as FormRow[]).map(toForm),
  )

  app.post(
    '/forms',
    { preHandler: editor, schema: { body: formInputSchema } },
    async (request, reply): Promise<SignupForm> => {
      const id = newId('frm')
      write(id, request.body, nowIso(), true)
      reply.code(201)
      return toForm(getFormRow(db, id))
    },
  )

  app.get(
    '/forms/:id',
    { preHandler: viewer, schema: { params: idParams } },
    async (request): Promise<SignupForm> => toForm(getFormRow(db, request.params.id)),
  )

  app.patch(
    '/forms/:id',
    { preHandler: editor, schema: { params: idParams, body: formInputSchema } },
    async (request): Promise<SignupForm> => {
      getFormRow(db, request.params.id)
      write(request.params.id, request.body, nowIso(), false)
      return toForm(getFormRow(db, request.params.id))
    },
  )

  app.delete(
    '/forms/:id',
    { preHandler: editor, schema: { params: idParams } },
    async (request) => {
      const row = getFormRow(db, request.params.id)
      db.prepare('DELETE FROM forms WHERE id = ?').run(row.id)
      writeLog(db, 'info', 'forms', `Form deleted: ${row.name}`, null, request.actor!.name)
      return { ok: true }
    },
  )
}
