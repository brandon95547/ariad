import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  bulkContactsSchema,
  contactInputSchema,
  contactQuerySchema,
  contactUpdateSchema,
  customFieldInputSchema,
  customFieldUpdateSchema,
  importContactsSchema,
  isEmail,
  listInputSchema,
  listUpdateSchema,
  mergeContactsSchema,
  normalizeEmail,
  pageQuerySchema,
  segmentDefinitionSchema,
  segmentInputSchema,
  suppressionInputSchema,
  tagInputSchema,
  tagUpdateSchema,
  type Contact,
  type ContactEvent,
  type ContactList,
  type CustomField,
  type DuplicateGroup,
  type ImportSummary,
  type Paged,
  type Segment,
  type SegmentRule,
  type Suppression,
  type Tag,
} from '@ariad/shared'
import { likeTerm, parseJson, placeholders } from '../db/index.js'
import { AppError } from '../errors.js'
import { parseCsv, toCsv } from '../lib/csv.js'
import { newId, nowIso } from '../lib/crypto.js'
import { enroll, getAutomationRow } from '../services/automations.js'
import {
  addTag,
  addToList,
  canonicalMailbox,
  findByEmail,
  getContact,
  getContactRow,
  hydrateContacts,
  listEvents,
  mergeContacts,
  recordEvent,
  removeFromList,
  removeTag,
  resubscribeContact,
  setMemberships,
  suppress,
  unsubscribeContact,
  upsertContact,
  type ContactRow,
} from '../services/contacts.js'
import { writeLog } from '../services/logs.js'
import { compileSegment, countSegment, loadSegment, type Compiled } from '../services/segments.js'

const idParams = z.object({ id: z.string() })

const SORTS: Record<string, string> = {
  created_desc: 'c.created_at DESC',
  created_asc: 'c.created_at ASC',
  email_asc: 'c.email ASC',
  email_desc: 'c.email DESC',
  name_asc: "COALESCE(c.last_name, '') ASC, COALESCE(c.first_name, '') ASC, c.email ASC",
  activity_desc: "COALESCE(c.last_opened_at, c.last_sent_at, '') DESC",
}

export async function contactRoutes(base: FastifyInstance): Promise<void> {
  const app = base.withTypeProvider<ZodTypeProvider>()
  const { ctx } = app
  const { db } = ctx
  const viewer = app.requireRole('viewer')
  const editor = app.requireRole('editor')

  /** The filters shared by the list, the export and "select everything". */
  function filterWhere(query: {
    q?: string
    status?: string
    listId?: string
    tagId?: string
    segmentId?: string
  }): Compiled {
    const where: string[] = []
    const params: unknown[] = []
    if (query.q) {
      const term = `%${likeTerm(query.q)}%`
      where.push(
        "(c.email LIKE ? ESCAPE '\\' OR c.first_name LIKE ? ESCAPE '\\' OR c.last_name LIKE ? ESCAPE '\\' OR c.company LIKE ? ESCAPE '\\' OR (COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) LIKE ? ESCAPE '\\')",
      )
      params.push(term, term, term, term, term)
    }
    if (query.status) {
      where.push('c.status = ?')
      params.push(query.status)
    }
    if (query.listId) {
      where.push(
        "EXISTS (SELECT 1 FROM list_members lm WHERE lm.contact_id = c.id AND lm.list_id = ? AND lm.status <> 'unsubscribed')",
      )
      params.push(query.listId)
    }
    if (query.tagId) {
      where.push(
        'EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ?)',
      )
      params.push(query.tagId)
    }
    if (query.segmentId) {
      const segment = compileSegment(db, loadSegment(db, query.segmentId))
      where.push(segment.sql)
      params.push(...segment.params)
    }
    return { sql: where.length ? where.join(' AND ') : '1 = 1', params }
  }

  /* ---- Contacts --------------------------------------------------------- */

  app.get(
    '/contacts',
    { preHandler: viewer, schema: { querystring: contactQuerySchema } },
    async (request): Promise<Paged<Contact>> => {
      const { page, pageSize, sort } = request.query
      const where = filterWhere(request.query)
      const total = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM contacts c WHERE ${where.sql}`)
          .get(...where.params) as { n: number }
      ).n
      const rows = db
        .prepare(
          `SELECT c.* FROM contacts c WHERE ${where.sql} ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`,
        )
        .all(...where.params, pageSize, (page - 1) * pageSize) as ContactRow[]
      return { items: hydrateContacts(db, rows), total, page, pageSize }
    },
  )

  /** Ids only: what "select all 4,312 matching" needs, without 4,312 rows of detail. */
  app.get(
    '/contacts/ids',
    { preHandler: viewer, schema: { querystring: contactQuerySchema } },
    async (request): Promise<{ ids: string[] }> => {
      const where = filterWhere(request.query)
      const rows = db
        .prepare(`SELECT c.id FROM contacts c WHERE ${where.sql} LIMIT 5000`)
        .all(...where.params) as { id: string }[]
      return { ids: rows.map((row) => row.id) }
    },
  )

  app.get(
    '/contacts/export',
    { preHandler: viewer, schema: { querystring: contactQuerySchema } },
    async (request, reply) => {
      const where = filterWhere(request.query)
      const rows = db
        .prepare(`SELECT c.* FROM contacts c WHERE ${where.sql} ORDER BY c.created_at ASC`)
        .all(...where.params) as ContactRow[]
      const fields = db.prepare('SELECT key FROM custom_fields ORDER BY created_at').all() as {
        key: string
      }[]
      const tagsOf = db.prepare(
        "SELECT group_concat(t.name, ', ') AS v FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = ?",
      )
      const listsOf = db.prepare(
        "SELECT group_concat(l.name, ', ') AS v FROM list_members lm JOIN lists l ON l.id = lm.list_id WHERE lm.contact_id = ? AND lm.status = 'subscribed'",
      )
      const headers = [
        'email',
        'first_name',
        'last_name',
        'company',
        'phone',
        'birthday',
        'status',
        'tags',
        'lists',
        ...fields.map((field) => field.key),
        'source',
        'consent_at',
        'consent_source',
        'created_at',
      ]
      const body = rows.map((row) => {
        const custom = parseJson<Record<string, string>>(row.custom, {})
        return [
          row.email,
          row.first_name,
          row.last_name,
          row.company,
          row.phone,
          row.birthday,
          row.status,
          (tagsOf.get(row.id) as { v: string | null }).v,
          (listsOf.get(row.id) as { v: string | null }).v,
          ...fields.map((field) => custom[field.key] ?? ''),
          row.source,
          row.consent_at,
          row.consent_source,
          row.created_at,
        ]
      })
      writeLog(
        db,
        'info',
        'contacts',
        `Exported ${rows.length.toLocaleString('en-US')} contacts`,
        null,
        request.actor!.name,
      )
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="contacts-${nowIso().slice(0, 10)}.csv"`,
        )
        .send('﻿' + toCsv(headers, body))
    },
  )

  app.post(
    '/contacts',
    { preHandler: editor, schema: { body: contactInputSchema } },
    async (request, reply): Promise<Contact> => {
      const input = request.body
      const existing = findByEmail(db, input.email)
      if (existing) {
        // Not an error to explain away: tell them who it is, so they can go there.
        throw new AppError(409, 'duplicate_contact', `${input.email} is already a contact.`, {
          id: existing.id,
        })
      }
      const contact = db.transaction(() => {
        const { row } = upsertContact(db, input, {
          status:
            input.status === 'pending' || input.status === 'unsubscribed'
              ? input.status
              : 'subscribed',
          source: 'Added by hand',
          consent: {
            source: input.consentSource ?? `Added by ${request.actor!.name}`,
            text: input.consentText ?? null,
          },
        })
        setMemberships(ctx, row.id, { listIds: input.listIds ?? [], tagIds: input.tagIds ?? [] })
        return getContact(db, row.id)
      })()
      reply.code(201)
      return contact
    },
  )

  app.get(
    '/contacts/:id',
    { preHandler: viewer, schema: { params: idParams } },
    async (request): Promise<Contact> => getContact(db, request.params.id),
  )

  /**
   * The contact's whole history in one list: what was done to the record, and
   * every email sent to them with what they did with it. Mail activity is read
   * from the messages themselves rather than copied onto the contact.
   */
  app.get(
    '/contacts/:id/activity',
    { preHandler: viewer, schema: { params: idParams } },
    async (request): Promise<ContactEvent[]> => {
      const { id } = request.params
      getContactRow(db, id)
      const events = listEvents(db, id)

      const subjectOf = /* sql */ `COALESCE(c.name, a.name, m.subject, 'an email')`
      const sent = db
        .prepare(
          /* sql */ `SELECT m.id, m.status, m.sent_at, m.bounced_at, m.last_error, m.campaign_id, ${subjectOf} AS title
                     FROM messages m LEFT JOIN campaigns c ON c.id = m.campaign_id LEFT JOIN automations a ON a.id = m.automation_id
                     WHERE m.contact_id = ? AND m.kind IN ('campaign','automation') AND m.status IN ('sent','bounced','failed')
                     ORDER BY COALESCE(m.sent_at, m.queued_at) DESC LIMIT 200`,
        )
        .all(id) as {
        id: string
        status: string
        sent_at: string | null
        bounced_at: string | null
        last_error: string | null
        campaign_id: string | null
        title: string
      }[]
      const tracked = db
        .prepare(
          /* sql */ `SELECT e.id, e.type, e.url, e.created_at, e.campaign_id, ${subjectOf} AS title
                     FROM message_events e JOIN messages m ON m.id = e.message_id
                     LEFT JOIN campaigns c ON c.id = m.campaign_id LEFT JOIN automations a ON a.id = m.automation_id
                     WHERE e.contact_id = ? AND e.type IN ('open','click') ORDER BY e.id DESC LIMIT 300`,
        )
        .all(id) as {
        id: number
        type: 'open' | 'click'
        url: string | null
        created_at: string
        campaign_id: string | null
        title: string
      }[]

      const mail: ContactEvent[] = [
        ...sent
          .filter((row) => row.sent_at)
          .map((row) => ({
            id: `sent-${row.id}`,
            type: 'sent' as const,
            summary: `Was sent "${row.title}"`,
            detail: { campaignId: row.campaign_id },
            createdAt: row.sent_at!,
          })),
        ...sent
          .filter((row) => row.status === 'failed')
          .map((row) => ({
            id: `failed-${row.id}`,
            type: 'failed' as const,
            summary: `"${row.title}" could not be sent`,
            detail: { error: row.last_error },
            createdAt: row.sent_at ?? nowIso(),
          })),
        ...tracked.map((row) => ({
          id: `track-${row.id}`,
          type: row.type === 'open' ? ('opened' as const) : ('clicked' as const),
          summary:
            row.type === 'open' ? `Opened "${row.title}"` : `Clicked a link in "${row.title}"`,
          detail: { campaignId: row.campaign_id, url: row.url },
          createdAt: row.created_at,
        })),
      ]
      return [...events, ...mail].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 400)
    },
  )

  app.patch(
    '/contacts/:id',
    { preHandler: editor, schema: { params: idParams, body: contactUpdateSchema } },
    async (request): Promise<Contact> => {
      const { id } = request.params
      const input = request.body
      const row = getContactRow(db, id)

      if (input.email && input.email !== normalizeEmail(row.email)) {
        const clash = findByEmail(db, input.email)
        if (clash && clash.id !== id) {
          throw new AppError(
            409,
            'duplicate_contact',
            `${input.email} is already another contact.`,
            { id: clash.id },
          )
        }
      }

      db.transaction(() => {
        const pick = (next: string | null | undefined, current: string | null) =>
          next === undefined ? current : next
        db.prepare(
          /* sql */ `UPDATE contacts SET email = @email, first_name = @firstName, last_name = @lastName, company = @company,
                     phone = @phone, birthday = @birthday, custom = @custom, updated_at = @now WHERE id = @id`,
        ).run({
          id,
          email: input.email ?? row.email,
          firstName: pick(input.firstName, row.first_name),
          lastName: pick(input.lastName, row.last_name),
          company: pick(input.company, row.company),
          phone: pick(input.phone, row.phone),
          birthday: pick(input.birthday, row.birthday),
          custom: JSON.stringify(input.custom ?? parseJson<Record<string, string>>(row.custom, {})),
          now: nowIso(),
        })

        if (input.status && input.status !== row.status) {
          if (input.status === 'unsubscribed') {
            unsubscribeContact(db, id, { via: `by ${request.actor!.name}` })
          } else if (input.status === 'subscribed') {
            resubscribeContact(db, id, request.actor!.name)
          } else {
            db.prepare('UPDATE contacts SET status = ? WHERE id = ?').run(input.status, id)
            recordEvent(
              db,
              id,
              'updated',
              `Status set to ${input.status} by ${request.actor!.name}`,
            )
          }
        }
        setMemberships(ctx, id, { listIds: input.listIds, tagIds: input.tagIds })
      })()
      return getContact(db, id)
    },
  )

  app.delete(
    '/contacts/:id',
    { preHandler: editor, schema: { params: idParams } },
    async (request) => {
      const row = getContactRow(db, request.params.id)
      db.prepare('DELETE FROM contacts WHERE id = ?').run(row.id)
      writeLog(db, 'info', 'contacts', `Contact deleted: ${row.email}`, null, request.actor!.name)
      return { ok: true }
    },
  )

  app.post(
    '/contacts/bulk',
    { preHandler: editor, schema: { body: bulkContactsSchema } },
    async (request): Promise<{ affected: number }> => {
      const { ids, action, tagId, listId } = request.body
      const needTag = action === 'add_tag' || action === 'remove_tag'
      const needList = action === 'add_to_list' || action === 'remove_from_list'
      if (needTag && !(tagId && db.prepare('SELECT 1 FROM tags WHERE id = ?').get(tagId)))
        throw AppError.badRequest('Choose a tag.')
      if (needList && !(listId && db.prepare('SELECT 1 FROM lists WHERE id = ?').get(listId)))
        throw AppError.badRequest('Choose a list.')

      const existing = (
        db
          .prepare(`SELECT id FROM contacts WHERE id IN (${placeholders(ids.length)})`)
          .all(...ids) as { id: string }[]
      ).map((row) => row.id)

      db.transaction(() => {
        for (const id of existing) {
          if (action === 'delete') db.prepare('DELETE FROM contacts WHERE id = ?').run(id)
          else if (action === 'add_tag') addTag(ctx, id, tagId!)
          else if (action === 'remove_tag') removeTag(db, id, tagId!)
          else if (action === 'add_to_list') addToList(ctx, id, listId!)
          else if (action === 'remove_from_list') removeFromList(db, id, listId!, 'remove')
          else if (action === 'unsubscribe')
            unsubscribeContact(db, id, { via: `by ${request.actor!.name}` })
          else if (action === 'resubscribe') resubscribeContact(db, id, request.actor!.name)
        }
      })()
      writeLog(
        db,
        'info',
        'contacts',
        `Bulk ${action.replace(/_/g, ' ')}: ${existing.length.toLocaleString('en-US')} contacts`,
        null,
        request.actor!.name,
      )
      return { affected: existing.length }
    },
  )

  /** Starts a contact on a manual automation, or on any automation by hand. */
  app.post(
    '/contacts/:id/automations',
    {
      preHandler: editor,
      schema: { params: idParams, body: z.object({ automationId: z.string() }) },
    },
    async (request) => {
      getContactRow(db, request.params.id)
      const automation = getAutomationRow(db, request.body.automationId)
      if (automation.status !== 'active') throw AppError.conflict('Turn the automation on first.')
      const started = enroll(db, automation.id, request.params.id, `manual:${Date.now()}`)
      return { started }
    },
  )

  /* ---- Import ----------------------------------------------------------- */

  app.post(
    '/contacts/import',
    { preHandler: editor, bodyLimit: 32 * 1024 * 1024, schema: { body: importContactsSchema } },
    async (request): Promise<ImportSummary> => {
      const input = request.body
      const { headers, rows } = parseCsv(input.csv)
      const targets = headers.map((header) => input.mapping[header] ?? 'skip')
      const emailColumn = targets.indexOf('email')
      if (emailColumn === -1)
        throw AppError.badRequest('Choose which column holds the email address.')

      const customKeys = new Set(
        (db.prepare('SELECT key FROM custom_fields').all() as { key: string }[]).map(
          (row) => row.key,
        ),
      )
      const tagIdByName = new Map(
        (db.prepare('SELECT id, name FROM tags').all() as { id: string; name: string }[]).map(
          (tag) => [tag.name.toLowerCase(), tag.id],
        ),
      )
      const summary: ImportSummary = {
        total: rows.length,
        created: 0,
        updated: 0,
        duplicatesInFile: 0,
        invalid: [],
        suppressed: 0,
      }

      // Fold the file onto itself first: the same address twice is one
      // contact. Where both rows have a value the later row wins, as the more
      // recent line of an export usually is; a blank never erases anything.
      interface Pending {
        fields: {
          email: string
          firstName?: string
          lastName?: string
          company?: string
          phone?: string
          birthday?: string
          custom: Record<string, string>
        }
        tags: Set<string>
      }
      const pending = new Map<string, Pending>()
      rows.forEach((cells, index) => {
        const raw = (cells[emailColumn] ?? '').trim()
        if (!isEmail(raw)) {
          if (summary.invalid.length < 200)
            summary.invalid.push({
              row: index + 2,
              value: raw,
              reason: raw ? 'Not a valid email address' : 'No email address',
            })
          return
        }
        const email = normalizeEmail(raw)
        const entry = pending.get(email) ?? {
          fields: { email, custom: {} },
          tags: new Set<string>(),
        }
        if (pending.has(email)) summary.duplicatesInFile += 1
        cells.forEach((cell, column) => {
          const value = cell.trim()
          const target = targets[column]
          if (!value || !target || target === 'skip' || target === 'email') return
          if (target === 'fullName') {
            const [first, ...rest] = value.split(/\s+/)
            entry.fields.firstName ??= first
            if (rest.length) entry.fields.lastName ??= rest.join(' ')
          } else if (target === 'tags') {
            for (const name of value.split(/[,;|]/)) if (name.trim()) entry.tags.add(name.trim())
          } else if (target === 'birthday') {
            const birthday = parseBirthday(value)
            if (birthday) entry.fields.birthday = birthday
          } else if (
            target === 'firstName' ||
            target === 'lastName' ||
            target === 'company' ||
            target === 'phone'
          ) {
            entry.fields[target] = value
          } else if (target.startsWith('custom.') && customKeys.has(target.slice(7))) {
            entry.fields.custom[target.slice(7)] = value
          }
        })
        pending.set(email, entry)
      })
      const invalidRows = rows.length - [...pending.values()].length - summary.duplicatesInFile

      db.transaction(() => {
        for (const entry of pending.values()) {
          const result = upsertContact(db, entry.fields, {
            status: input.status,
            source: 'CSV import',
            consent:
              input.status === 'subscribed'
                ? {
                    source: input.consentSource,
                    text: `Imported by ${request.actor!.name}, who confirmed these contacts agreed to be emailed.`,
                  }
                : undefined,
            overwrite: input.updateExisting,
            event: 'imported',
          })
          if (result.created) summary.created += 1
          else summary.updated += 1
          if (result.blocked) summary.suppressed += 1

          // An import is not a signup: nobody gets a welcome series for
          // turning up in a spreadsheet.
          if (!result.blocked && input.status !== 'unsubscribed') {
            for (const listId of input.listIds)
              addToList(
                ctx,
                result.row.id,
                listId,
                input.status === 'pending' ? 'pending' : 'subscribed',
                { quiet: true },
              )
          }
          for (const tagId of input.tagIds) addTag(ctx, result.row.id, tagId, { quiet: true })
          for (const name of entry.tags) {
            let tagId = tagIdByName.get(name.toLowerCase())
            if (!tagId) {
              tagId = newId('tag')
              db.prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
                tagId,
                name.slice(0, 60),
                '#706fd3',
                nowIso(),
              )
              tagIdByName.set(name.toLowerCase(), tagId)
            }
            addTag(ctx, result.row.id, tagId, { quiet: true })
          }
        }
      })()

      writeLog(
        db,
        'info',
        'import',
        `Imported ${rows.length.toLocaleString('en-US')} rows: ${summary.created} new, ${summary.updated} updated, ${invalidRows} invalid`,
        { duplicatesInFile: summary.duplicatesInFile, suppressed: summary.suppressed },
        request.actor!.name,
      )
      return summary
    },
  )

  /* ---- Duplicates ------------------------------------------------------- */

  app.get('/contacts-duplicates', { preHandler: viewer }, async (): Promise<DuplicateGroup[]> => {
    type Slim = {
      id: string
      email: string
      first_name: string | null
      last_name: string | null
      company: string | null
      phone: string | null
      status: Contact['status']
      created_at: string
    }
    const all = db
      .prepare(
        'SELECT id, email, first_name, last_name, company, phone, status, created_at FROM contacts ORDER BY created_at',
      )
      .all() as Slim[]
    const slim = (row: Slim) => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      company: row.company,
      status: row.status,
      createdAt: row.created_at,
    })
    const groups: DuplicateGroup[] = []
    const claimed = new Set<string>()

    const collect = (reason: DuplicateGroup['reason'], keyOf: (row: Slim) => string | null) => {
      const buckets = new Map<string, Slim[]>()
      for (const row of all) {
        if (claimed.has(row.id)) continue
        const key = keyOf(row)
        if (key) buckets.set(key, [...(buckets.get(key) ?? []), row])
      }
      for (const [key, members] of buckets) {
        if (members.length < 2) continue
        for (const member of members) claimed.add(member.id)
        groups.push({ reason, key, contacts: members.map(slim) })
      }
    }
    const name = (row: Slim) =>
      `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim().toLowerCase()
    const digits = (value: string | null) => (value ?? '').replace(/\D/g, '')

    collect('same_mailbox', (row) => canonicalMailbox(row.email))
    collect('same_name_and_phone', (row) =>
      name(row).includes(' ') && digits(row.phone).length >= 7
        ? `${name(row)}|${digits(row.phone)}`
        : null,
    )
    collect('same_name_and_company', (row) =>
      name(row).includes(' ') && row.company
        ? `${name(row)}|${row.company.trim().toLowerCase()}`
        : null,
    )
    return groups.slice(0, 500)
  })

  app.post(
    '/contacts-merge',
    { preHandler: editor, schema: { body: mergeContactsSchema } },
    async (request): Promise<Contact> =>
      mergeContacts(ctx, request.body.keepId, request.body.mergeIds, request.actor!.name),
  )

  /* ---- Lists ------------------------------------------------------------ */

  const LISTS_SQL = /* sql */ `
    SELECT l.*,
      (SELECT COUNT(*) FROM list_members m JOIN contacts c ON c.id = m.contact_id WHERE m.list_id = l.id AND m.status = 'subscribed' AND c.status = 'subscribed') AS subscribed,
      (SELECT COUNT(*) FROM list_members m WHERE m.list_id = l.id AND m.status = 'pending') AS pending,
      (SELECT COUNT(*) FROM list_members m WHERE m.list_id = l.id AND m.status = 'unsubscribed') AS unsubscribed
    FROM lists l`
  interface ListRow {
    id: string
    name: string
    description: string | null
    double_opt_in: number
    is_public: number
    created_at: string
    subscribed: number
    pending: number
    unsubscribed: number
  }
  const toList = (row: ListRow): ContactList => ({
    id: row.id,
    name: row.name,
    description: row.description,
    doubleOptIn: row.double_opt_in === 1,
    isPublic: row.is_public === 1,
    subscribedCount: row.subscribed,
    pendingCount: row.pending,
    unsubscribedCount: row.unsubscribed,
    createdAt: row.created_at,
  })
  const getList = (id: string): ContactList => {
    const row = db.prepare(`${LISTS_SQL} WHERE l.id = ?`).get(id) as ListRow | undefined
    if (!row) throw AppError.notFound('list')
    return toList(row)
  }

  app.get('/lists', { preHandler: viewer }, async (): Promise<ContactList[]> =>
    (db.prepare(`${LISTS_SQL} ORDER BY l.name`).all() as ListRow[]).map(toList),
  )

  app.post(
    '/lists',
    { preHandler: editor, schema: { body: listInputSchema } },
    async (request, reply): Promise<ContactList> => {
      const id = newId('lst')
      const { name, description, doubleOptIn, isPublic } = request.body
      db.prepare(
        'INSERT INTO lists (id, name, description, double_opt_in, is_public, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, name, description, doubleOptIn ? 1 : 0, isPublic ? 1 : 0, nowIso())
      reply.code(201)
      return getList(id)
    },
  )

  app.patch(
    '/lists/:id',
    { preHandler: editor, schema: { params: idParams, body: listUpdateSchema } },
    async (request): Promise<ContactList> => {
      const current = getList(request.params.id)
      const next = { ...current, ...request.body }
      db.prepare(
        'UPDATE lists SET name = ?, description = ?, double_opt_in = ?, is_public = ? WHERE id = ?',
      ).run(
        next.name,
        next.description ?? null,
        next.doubleOptIn ? 1 : 0,
        next.isPublic ? 1 : 0,
        current.id,
      )
      return getList(current.id)
    },
  )

  app.delete(
    '/lists/:id',
    { preHandler: editor, schema: { params: idParams } },
    async (request) => {
      const list = getList(request.params.id)
      db.prepare('DELETE FROM lists WHERE id = ?').run(list.id)
      writeLog(db, 'info', 'contacts', `List deleted: ${list.name}`, null, request.actor!.name)
      return { ok: true }
    },
  )

  /* ---- Tags ------------------------------------------------------------- */

  const TAGS_SQL =
    'SELECT t.id, t.name, t.color, (SELECT COUNT(*) FROM contact_tags ct WHERE ct.tag_id = t.id) AS contactCount FROM tags t'

  app.get(
    '/tags',
    { preHandler: viewer },
    async (): Promise<Tag[]> => db.prepare(`${TAGS_SQL} ORDER BY t.name`).all() as Tag[],
  )

  app.post(
    '/tags',
    { preHandler: editor, schema: { body: tagInputSchema } },
    async (request, reply): Promise<Tag> => {
      if (db.prepare('SELECT 1 FROM tags WHERE name = ?').get(request.body.name)) {
        throw AppError.conflict(`There is already a tag called "${request.body.name}".`)
      }
      const id = newId('tag')
      db.prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        request.body.name,
        request.body.color,
        nowIso(),
      )
      reply.code(201)
      return db.prepare(`${TAGS_SQL} WHERE t.id = ?`).get(id) as Tag
    },
  )

  app.patch(
    '/tags/:id',
    { preHandler: editor, schema: { params: idParams, body: tagUpdateSchema } },
    async (request): Promise<Tag> => {
      const current = db.prepare(`${TAGS_SQL} WHERE t.id = ?`).get(request.params.id) as
        Tag | undefined
      if (!current) throw AppError.notFound('tag')
      const name = request.body.name ?? current.name
      if (db.prepare('SELECT 1 FROM tags WHERE name = ? AND id <> ?').get(name, current.id)) {
        throw AppError.conflict(`There is already a tag called "${name}".`)
      }
      db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(
        name,
        request.body.color ?? current.color,
        current.id,
      )
      return db.prepare(`${TAGS_SQL} WHERE t.id = ?`).get(current.id) as Tag
    },
  )

  app.delete('/tags/:id', { preHandler: editor, schema: { params: idParams } }, async (request) => {
    db.prepare('DELETE FROM tags WHERE id = ?').run(request.params.id)
    return { ok: true }
  })

  /* ---- Custom fields ---------------------------------------------------- */

  interface FieldRow {
    id: string
    key: string
    label: string
    type: CustomField['type']
    options: string
    created_at: string
  }
  const toField = (row: FieldRow): CustomField => ({
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type,
    options: parseJson<string[]>(row.options, []),
    createdAt: row.created_at,
  })

  app.get('/fields', { preHandler: viewer }, async (): Promise<CustomField[]> =>
    (db.prepare('SELECT * FROM custom_fields ORDER BY created_at').all() as FieldRow[]).map(
      toField,
    ),
  )

  app.post(
    '/fields',
    { preHandler: editor, schema: { body: customFieldInputSchema } },
    async (request, reply): Promise<CustomField> => {
      const { key, label, type, options } = request.body
      if (db.prepare('SELECT 1 FROM custom_fields WHERE key = ?').get(key)) {
        throw AppError.conflict(`There is already a field with the key "${key}".`)
      }
      const id = newId('fld')
      db.prepare(
        'INSERT INTO custom_fields (id, key, label, type, options, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, key, label, type, JSON.stringify(options), nowIso())
      reply.code(201)
      return toField(db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(id) as FieldRow)
    },
  )

  /** The key is the field's identity in merge tags and segments, so it does not change. */
  app.patch(
    '/fields/:id',
    { preHandler: editor, schema: { params: idParams, body: customFieldUpdateSchema } },
    async (request): Promise<CustomField> => {
      const row = db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(request.params.id) as
        FieldRow | undefined
      if (!row) throw AppError.notFound('field')
      db.prepare('UPDATE custom_fields SET label = ?, type = ?, options = ? WHERE id = ?').run(
        request.body.label ?? row.label,
        request.body.type ?? row.type,
        request.body.options ? JSON.stringify(request.body.options) : row.options,
        row.id,
      )
      return toField(db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(row.id) as FieldRow)
    },
  )

  app.delete(
    '/fields/:id',
    { preHandler: editor, schema: { params: idParams } },
    async (request) => {
      db.prepare('DELETE FROM custom_fields WHERE id = ?').run(request.params.id)
      return { ok: true }
    },
  )

  /* ---- Segments --------------------------------------------------------- */

  interface SegmentRow {
    id: string
    name: string
    description: string | null
    match: 'all' | 'any'
    rules: string
    created_at: string
    updated_at: string
  }
  const toSegment = (row: SegmentRow): Segment => {
    const definition = { match: row.match, rules: parseJson<SegmentRule[]>(row.rules, []) }
    let contactCount = 0
    try {
      contactCount = countSegment(db, definition)
    } catch {
      // A rule that names a tag or field since deleted. The segment still
      // lists, with nobody in it, so it can be opened and repaired.
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      ...definition,
      contactCount,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
  const getSegment = (id: string): Segment => {
    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as SegmentRow | undefined
    if (!row) throw AppError.notFound('segment')
    return toSegment(row)
  }

  app.get('/segments', { preHandler: viewer }, async (): Promise<Segment[]> =>
    (db.prepare('SELECT * FROM segments ORDER BY name').all() as SegmentRow[]).map(toSegment),
  )

  /** Counts a definition that has not been saved, for the builder's live number. */
  app.post(
    '/segments/preview',
    { preHandler: viewer, schema: { body: segmentDefinitionSchema } },
    async (request): Promise<{ count: number; sample: Contact[] }> => {
      const where = compileSegment(db, request.body)
      const count = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM contacts c WHERE ${where.sql}`)
          .get(...where.params) as { n: number }
      ).n
      const rows = db
        .prepare(`SELECT c.* FROM contacts c WHERE ${where.sql} ORDER BY c.created_at DESC LIMIT 5`)
        .all(...where.params) as ContactRow[]
      return { count, sample: hydrateContacts(db, rows) }
    },
  )

  app.post(
    '/segments',
    { preHandler: editor, schema: { body: segmentInputSchema } },
    async (request, reply): Promise<Segment> => {
      const { name, description, match, rules } = request.body
      compileSegment(db, { match, rules })
      const id = newId('seg')
      const now = nowIso()
      db.prepare(
        'INSERT INTO segments (id, name, description, match, rules, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, name, description, match, JSON.stringify(rules), now, now)
      reply.code(201)
      return getSegment(id)
    },
  )

  app.patch(
    '/segments/:id',
    { preHandler: editor, schema: { params: idParams, body: segmentInputSchema } },
    async (request): Promise<Segment> => {
      getSegment(request.params.id)
      const { name, description, match, rules } = request.body
      compileSegment(db, { match, rules })
      db.prepare(
        'UPDATE segments SET name = ?, description = ?, match = ?, rules = ?, updated_at = ? WHERE id = ?',
      ).run(name, description, match, JSON.stringify(rules), nowIso(), request.params.id)
      return getSegment(request.params.id)
    },
  )

  app.delete(
    '/segments/:id',
    { preHandler: editor, schema: { params: idParams } },
    async (request) => {
      db.prepare('DELETE FROM segments WHERE id = ?').run(request.params.id)
      return { ok: true }
    },
  )

  /* ---- Suppression list ------------------------------------------------- */

  app.get(
    '/suppressions',
    {
      preHandler: viewer,
      schema: { querystring: pageQuerySchema.extend({ q: z.string().trim().max(200).optional() }) },
    },
    async (request): Promise<Paged<Suppression>> => {
      const { page, pageSize, q } = request.query
      const where = q ? "WHERE email LIKE ? ESCAPE '\\'" : ''
      const params = q ? [`%${likeTerm(q)}%`] : []
      const total = (
        db.prepare(`SELECT COUNT(*) AS n FROM suppressions ${where}`).get(...params) as {
          n: number
        }
      ).n
      const items = db
        .prepare(
          `SELECT email, reason, note, created_at AS createdAt FROM suppressions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, pageSize, (page - 1) * pageSize) as Suppression[]
      return { items, total, page, pageSize }
    },
  )

  app.post(
    '/suppressions',
    { preHandler: editor, schema: { body: suppressionInputSchema } },
    async (request): Promise<{ added: number; invalid: number }> => {
      const { emails, reason, note } = request.body
      const candidates = emails
        .split(/[\s,;]+/)
        .map((value) => value.trim())
        .filter(Boolean)
      let added = 0
      let invalid = 0
      db.transaction(() => {
        for (const candidate of candidates) {
          if (!isEmail(candidate)) {
            invalid += 1
            continue
          }
          const email = normalizeEmail(candidate)
          suppress(db, email, reason, note ?? `Added by ${request.actor!.name}`)
          // An existing contact at that address stops being mailable too.
          const contact = findByEmail(db, email)
          if (contact && contact.status === 'subscribed')
            unsubscribeContact(db, contact.id, { via: 'suppression list' })
          added += 1
        }
      })()
      writeLog(
        db,
        'info',
        'contacts',
        `${added} ${added === 1 ? 'address' : 'addresses'} added to the suppression list`,
        null,
        request.actor!.name,
      )
      return { added, invalid }
    },
  )

  app.delete(
    '/suppressions/:email',
    { preHandler: app.requireRole('admin'), schema: { params: z.object({ email: z.string() }) } },
    async (request) => {
      db.prepare('DELETE FROM suppressions WHERE email = ?').run(request.params.email)
      writeLog(
        db,
        'warn',
        'contacts',
        `${request.params.email} removed from the suppression list`,
        null,
        request.actor!.name,
      )
      return { ok: true }
    },
  )
}

/** Accepts the formats spreadsheets actually hold a birthday in. */
function parseBirthday(value: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value)
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, '0')}-${iso[3]!.padStart(2, '0')}`
  const us = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(value)
  if (us) {
    const [, month, day, year] = us
    if (Number(month) > 12 || Number(day) > 31) return null
    const fullYear = year ? (year.length === 2 ? `19${year}` : year) : '-'
    return `${fullYear}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`
  }
  return null
}
