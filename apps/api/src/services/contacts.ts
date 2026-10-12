import type {
  Contact,
  ContactEvent,
  ContactEventType,
  ContactListMembership,
  ContactStatus,
  SuppressionReason,
} from '@ariad/shared'
import type { Ctx } from '../context.js'
import { parseJson, placeholders, type Db } from '../db/index.js'
import { AppError } from '../errors.js'
import { newId, nowIso, randomToken } from '../lib/crypto.js'
import { fireTrigger } from './automations.js'

/**
 * Everything that changes a contact goes through this file, so the rules that
 * must always hold are in one place:
 *
 *   - an address on the suppression list is never set back to `subscribed`
 *     by an import or a form, only by a person choosing to
 *   - unsubscribing always writes a suppression, so deleting the contact does
 *     not make the address mailable again
 *   - every change leaves an event on the contact's timeline
 */
export interface ContactRow {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  company: string | null
  phone: string | null
  birthday: string | null
  status: ContactStatus
  source: string | null
  custom: string
  token: string
  consent_at: string | null
  consent_source: string | null
  consent_text: string | null
  consent_ip: string | null
  confirmed_at: string | null
  unsubscribed_at: string | null
  unsubscribe_reason: string | null
  last_sent_at: string | null
  last_opened_at: string | null
  last_clicked_at: string | null
  created_at: string
  updated_at: string
}

export function recordEvent(
  db: Db,
  contactId: string,
  type: ContactEventType,
  summary: string,
  detail?: Record<string, unknown> | null,
): void {
  db.prepare(
    'INSERT INTO contact_events (contact_id, type, summary, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(contactId, type, summary, detail ? JSON.stringify(detail) : null, nowIso())
}

export function listEvents(db: Db, contactId: string, limit = 200): ContactEvent[] {
  const rows = db
    .prepare('SELECT * FROM contact_events WHERE contact_id = ? ORDER BY id DESC LIMIT ?')
    .all(contactId, limit) as {
    id: number
    type: ContactEventType
    summary: string
    detail: string | null
    created_at: string
  }[]
  return rows.map((row) => ({
    id: String(row.id),
    type: row.type,
    summary: row.summary,
    detail: parseJson<Record<string, unknown> | null>(row.detail, null),
    createdAt: row.created_at,
  }))
}

/** Tags and lists for a page of contacts, in two queries rather than 2 × N. */
export function hydrateContacts(db: Db, rows: ContactRow[]): Contact[] {
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.id)
  const marks = placeholders(ids.length)

  const tagRows = db
    .prepare(
      `SELECT ct.contact_id, t.id, t.name, t.color FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
       WHERE ct.contact_id IN (${marks}) ORDER BY t.name`,
    )
    .all(...ids) as { contact_id: string; id: string; name: string; color: string }[]
  const listRows = db
    .prepare(
      `SELECT lm.contact_id, l.id AS listId, l.name, lm.status, lm.subscribed_at AS subscribedAt
       FROM list_members lm JOIN lists l ON l.id = lm.list_id
       WHERE lm.contact_id IN (${marks}) ORDER BY l.name`,
    )
    .all(...ids) as ({ contact_id: string } & ContactListMembership)[]

  const tags = new Map<string, Contact['tags']>()
  for (const { contact_id, ...tag } of tagRows) {
    tags.set(contact_id, [...(tags.get(contact_id) ?? []), tag])
  }
  const lists = new Map<string, ContactListMembership[]>()
  for (const { contact_id, ...membership } of listRows) {
    lists.set(contact_id, [...(lists.get(contact_id) ?? []), membership])
  }

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    company: row.company,
    phone: row.phone,
    birthday: row.birthday,
    status: row.status,
    source: row.source,
    custom: parseJson<Record<string, string>>(row.custom, {}),
    tags: tags.get(row.id) ?? [],
    lists: lists.get(row.id) ?? [],
    consentAt: row.consent_at,
    consentSource: row.consent_source,
    consentText: row.consent_text,
    consentIp: row.consent_ip,
    confirmedAt: row.confirmed_at,
    unsubscribedAt: row.unsubscribed_at,
    unsubscribeReason: row.unsubscribe_reason,
    lastSentAt: row.last_sent_at,
    lastOpenedAt: row.last_opened_at,
    lastClickedAt: row.last_clicked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export function getContactRow(db: Db, id: string): ContactRow {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as ContactRow | undefined
  if (!row) throw AppError.notFound('contact')
  return row
}

export function findByEmail(db: Db, email: string): ContactRow | undefined {
  return db.prepare('SELECT * FROM contacts WHERE email = ?').get(email) as ContactRow | undefined
}

export function getContact(db: Db, id: string): Contact {
  return hydrateContacts(db, [getContactRow(db, id)])[0]!
}

/* ---- Suppression -------------------------------------------------------- */

export function suppress(
  db: Db,
  email: string,
  reason: SuppressionReason,
  note?: string | null,
): void {
  // A bounce or complaint is not downgraded to "manual" by a later entry.
  db.prepare(
    /* sql */ `INSERT INTO suppressions (email, reason, note, created_at) VALUES (?, ?, ?, ?)
               ON CONFLICT (email) DO UPDATE SET note = COALESCE(excluded.note, suppressions.note)`,
  ).run(email, reason, note ?? null, nowIso())
}

export function suppressionOf(db: Db, email: string): SuppressionReason | null {
  const row = db.prepare('SELECT reason FROM suppressions WHERE email = ?').get(email) as
    { reason: SuppressionReason } | undefined
  return row?.reason ?? null
}

/* ---- Writing ------------------------------------------------------------ */

export interface ContactFields {
  email: string
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  phone?: string | null
  birthday?: string | null
  custom?: Record<string, string>
}

export interface Consent {
  source: string | null
  text?: string | null
  ip?: string | null
}

export interface UpsertOptions {
  status?: 'subscribed' | 'pending' | 'unsubscribed'
  source: string
  consent?: Consent
  /** When false, an existing contact's blank fields are filled but nothing is overwritten. */
  overwrite?: boolean
  event?: ContactEventType
}

export interface UpsertResult {
  row: ContactRow
  created: boolean
  /** The address is unsubscribed, bounced, complained or suppressed, and stays that way. */
  blocked: boolean
}

/**
 * Creates the contact, or updates the one with that address.
 *
 * It never raises an existing contact's standing: someone who unsubscribed is
 * not re-subscribed because their address turned up in a spreadsheet. It will
 * confirm a `pending` contact when asked to subscribe them, since that is what
 * a person importing their own confirmed list means.
 */
export function upsertContact(db: Db, fields: ContactFields, options: UpsertOptions): UpsertResult {
  const now = nowIso()
  const existing = findByEmail(db, fields.email)
  const wanted = options.status ?? 'subscribed'
  const suppressed = suppressionOf(db, fields.email)

  if (!existing) {
    const id = newId('con')
    // A suppressed address is still recorded, so the import shows where it
    // went — but it arrives in the state the suppression put it in.
    const status: ContactStatus =
      suppressed === 'bounced'
        ? 'bounced'
        : suppressed === 'complained'
          ? 'complained'
          : suppressed
            ? 'unsubscribed'
            : wanted
    db.prepare(
      /* sql */ `INSERT INTO contacts
        (id, email, first_name, last_name, company, phone, birthday, status, source, custom, token,
         consent_at, consent_source, consent_text, consent_ip, confirmed_at, unsubscribed_at, created_at, updated_at)
       VALUES
        (@id, @email, @firstName, @lastName, @company, @phone, @birthday, @status, @source, @custom, @token,
         @consentAt, @consentSource, @consentText, @consentIp, @confirmedAt, @unsubscribedAt, @now, @now)`,
    ).run({
      id,
      email: fields.email,
      firstName: fields.firstName ?? null,
      lastName: fields.lastName ?? null,
      company: fields.company ?? null,
      phone: fields.phone ?? null,
      birthday: fields.birthday ?? null,
      status,
      source: options.source,
      custom: JSON.stringify(fields.custom ?? {}),
      token: randomToken(18),
      consentAt: options.consent ? now : null,
      consentSource: options.consent?.source ?? null,
      consentText: options.consent?.text ?? null,
      consentIp: options.consent?.ip ?? null,
      confirmedAt: status === 'subscribed' && options.consent ? now : null,
      unsubscribedAt: status === 'unsubscribed' ? now : null,
      now,
    })
    recordEvent(db, id, options.event ?? 'created', `Added (${options.source})`, {
      status,
      consent: options.consent?.source ?? null,
    })
    return { row: getContactRow(db, id), created: true, blocked: status !== wanted }
  }

  const overwrite = options.overwrite ?? true
  const choose = (next: string | null | undefined, current: string | null) =>
    next === undefined || next === null || next === ''
      ? current
      : overwrite || !current
        ? next
        : current
  const custom = { ...parseJson<Record<string, string>>(existing.custom, {}) }
  for (const [key, value] of Object.entries(fields.custom ?? {})) {
    if (value !== '' && (overwrite || !custom[key])) custom[key] = value
  }

  const blocked = existing.status !== 'subscribed' && existing.status !== 'pending'
  const status: ContactStatus =
    blocked || suppressed
      ? existing.status
      : existing.status === 'pending' && wanted === 'subscribed'
        ? 'subscribed'
        : existing.status
  const confirming = existing.status === 'pending' && status === 'subscribed'

  db.prepare(
    /* sql */ `UPDATE contacts SET
      first_name = @firstName, last_name = @lastName, company = @company, phone = @phone, birthday = @birthday,
      custom = @custom, status = @status,
      consent_at = COALESCE(consent_at, @consentAt), consent_source = COALESCE(consent_source, @consentSource),
      consent_text = COALESCE(consent_text, @consentText), consent_ip = COALESCE(consent_ip, @consentIp),
      confirmed_at = CASE WHEN @confirming = 1 THEN @now ELSE confirmed_at END,
      updated_at = @now
     WHERE id = @id`,
  ).run({
    id: existing.id,
    firstName: choose(fields.firstName, existing.first_name),
    lastName: choose(fields.lastName, existing.last_name),
    company: choose(fields.company, existing.company),
    phone: choose(fields.phone, existing.phone),
    birthday: choose(fields.birthday, existing.birthday),
    custom: JSON.stringify(custom),
    status,
    consentAt: options.consent ? now : null,
    consentSource: options.consent?.source ?? null,
    consentText: options.consent?.text ?? null,
    consentIp: options.consent?.ip ?? null,
    confirming: confirming ? 1 : 0,
    now,
  })
  return {
    row: getContactRow(db, existing.id),
    created: false,
    blocked: blocked || Boolean(suppressed),
  }
}

/**
 * Puts a contact on a list. `subscribed` fires the list's automations; that
 * is the one place a welcome email starts from, however the contact got here.
 */
export function addToList(
  ctx: Ctx,
  contactId: string,
  listId: string,
  status: 'subscribed' | 'pending' = 'subscribed',
  options: { quiet?: boolean } = {},
): void {
  const { db } = ctx
  const now = nowIso()
  const current = db
    .prepare('SELECT status FROM list_members WHERE list_id = ? AND contact_id = ?')
    .get(listId, contactId) as { status: string } | undefined
  if (current?.status === status) return
  // Asking to subscribe someone who is already subscribed must not drop them
  // back to pending.
  if (current?.status === 'subscribed' && status === 'pending') return

  db.prepare(
    /* sql */ `INSERT INTO list_members (list_id, contact_id, status, subscribed_at)
               VALUES (@listId, @contactId, @status, @at)
               ON CONFLICT (list_id, contact_id) DO UPDATE SET
                 status = excluded.status, subscribed_at = excluded.subscribed_at, unsubscribed_at = NULL`,
  ).run({ listId, contactId, status, at: status === 'subscribed' ? now : null })

  const list = db.prepare('SELECT name FROM lists WHERE id = ?').get(listId) as
    { name: string } | undefined
  if (status === 'subscribed') {
    recordEvent(db, contactId, 'list_added', `Subscribed to ${list?.name ?? 'a list'}`, { listId })
    if (!options.quiet) fireTrigger(ctx, { type: 'list_subscribed', listId, contactId })
  }
}

export function removeFromList(
  db: Db,
  contactId: string,
  listId: string,
  mode: 'unsubscribe' | 'remove',
): void {
  const list = db.prepare('SELECT name FROM lists WHERE id = ?').get(listId) as
    { name: string } | undefined
  if (mode === 'remove') {
    db.prepare('DELETE FROM list_members WHERE list_id = ? AND contact_id = ?').run(
      listId,
      contactId,
    )
  } else {
    db.prepare(
      "UPDATE list_members SET status = 'unsubscribed', unsubscribed_at = ? WHERE list_id = ? AND contact_id = ?",
    ).run(nowIso(), listId, contactId)
  }
  recordEvent(
    db,
    contactId,
    'list_removed',
    `${mode === 'remove' ? 'Removed from' : 'Unsubscribed from'} ${list?.name ?? 'a list'}`,
    { listId },
  )
}

export function addTag(
  ctx: Ctx,
  contactId: string,
  tagId: string,
  options: { quiet?: boolean } = {},
): void {
  const { db } = ctx
  const result = db
    .prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id, created_at) VALUES (?, ?, ?)')
    .run(contactId, tagId, nowIso())
  if (result.changes === 0) return
  const tag = db.prepare('SELECT name FROM tags WHERE id = ?').get(tagId) as
    { name: string } | undefined
  recordEvent(db, contactId, 'tag_added', `Tagged ${tag?.name ?? ''}`.trim(), { tagId })
  if (!options.quiet) fireTrigger(ctx, { type: 'tag_added', tagId, contactId })
}

export function removeTag(db: Db, contactId: string, tagId: string): void {
  const result = db
    .prepare('DELETE FROM contact_tags WHERE contact_id = ? AND tag_id = ?')
    .run(contactId, tagId)
  if (result.changes === 0) return
  const tag = db.prepare('SELECT name FROM tags WHERE id = ?').get(tagId) as
    { name: string } | undefined
  recordEvent(db, contactId, 'tag_removed', `Tag removed: ${tag?.name ?? ''}`.trim(), { tagId })
}

/** Replaces a contact's tags and list memberships with exactly these. */
export function setMemberships(
  ctx: Ctx,
  contactId: string,
  next: { listIds?: string[]; tagIds?: string[] },
): void {
  const { db } = ctx
  if (next.tagIds) {
    const current = (
      db.prepare('SELECT tag_id FROM contact_tags WHERE contact_id = ?').all(contactId) as {
        tag_id: string
      }[]
    ).map((row) => row.tag_id)
    for (const tagId of next.tagIds) if (!current.includes(tagId)) addTag(ctx, contactId, tagId)
    for (const tagId of current) if (!next.tagIds.includes(tagId)) removeTag(db, contactId, tagId)
  }
  if (next.listIds) {
    const current = (
      db
        .prepare(
          "SELECT list_id FROM list_members WHERE contact_id = ? AND status <> 'unsubscribed'",
        )
        .all(contactId) as { list_id: string }[]
    ).map((row) => row.list_id)
    for (const listId of next.listIds)
      if (!current.includes(listId)) addToList(ctx, contactId, listId)
    for (const listId of current)
      if (!next.listIds.includes(listId)) removeFromList(db, contactId, listId, 'remove')
  }
}

/**
 * Stops all email to a contact. The suppression is what makes it stick: it
 * outlives the contact record, an import, and a re-added list membership.
 */
export function unsubscribeContact(
  db: Db,
  contactId: string,
  options: { reason?: string | null; via: string },
): void {
  const row = getContactRow(db, contactId)
  if (row.status === 'unsubscribed') return
  const now = nowIso()
  db.prepare(
    "UPDATE contacts SET status = 'unsubscribed', unsubscribed_at = ?, unsubscribe_reason = ?, updated_at = ? WHERE id = ?",
  ).run(now, options.reason ?? null, now, contactId)
  db.prepare(
    "UPDATE list_members SET status = 'unsubscribed', unsubscribed_at = ? WHERE contact_id = ? AND status <> 'unsubscribed'",
  ).run(now, contactId)
  suppress(db, row.email, 'unsubscribed', options.via)
  // Anything still waiting to go to them is withdrawn, and any automation
  // they were partway through ends here.
  db.prepare(
    "UPDATE messages SET status = 'canceled', last_error = 'Contact unsubscribed' WHERE contact_id = ? AND status = 'queued' AND kind <> 'system'",
  ).run(contactId)
  db.prepare(
    "UPDATE automation_runs SET status = 'exited', note = 'Unsubscribed', finished_at = ? WHERE contact_id = ? AND status = 'active'",
  ).run(now, contactId)
  recordEvent(db, contactId, 'unsubscribed', `Unsubscribed (${options.via})`, {
    reason: options.reason ?? null,
  })
}

/** A person deciding, on the record, that this contact may be emailed again. */
export function resubscribeContact(db: Db, contactId: string, userName: string): void {
  const row = getContactRow(db, contactId)
  const now = nowIso()
  db.prepare(
    "UPDATE contacts SET status = 'subscribed', unsubscribed_at = NULL, unsubscribe_reason = NULL, updated_at = ? WHERE id = ?",
  ).run(now, contactId)
  db.prepare('DELETE FROM suppressions WHERE email = ?').run(row.email)
  recordEvent(db, contactId, 'resubscribed', `Re-subscribed by ${userName}`, { from: row.status })
}

/** A hard bounce or a spam complaint: the address is finished. */
export function markUndeliverable(
  db: Db,
  contactId: string,
  kind: 'bounced' | 'complained',
  detail: string,
): void {
  const row = getContactRow(db, contactId)
  const now = nowIso()
  db.prepare('UPDATE contacts SET status = ?, updated_at = ? WHERE id = ?').run(
    kind,
    now,
    contactId,
  )
  suppress(db, row.email, kind, detail.slice(0, 300))
  db.prepare(
    "UPDATE messages SET status = 'canceled', last_error = ? WHERE contact_id = ? AND status = 'queued'",
  ).run(kind === 'bounced' ? 'Address bounced' : 'Marked as spam', contactId)
  db.prepare(
    "UPDATE automation_runs SET status = 'exited', note = ?, finished_at = ? WHERE contact_id = ? AND status = 'active'",
  ).run(kind === 'bounced' ? 'Bounced' : 'Complained', now, contactId)
  recordEvent(
    db,
    contactId,
    kind,
    kind === 'bounced' ? 'Email bounced' : 'Marked an email as spam',
    { detail },
  )
}

/* ---- Duplicates --------------------------------------------------------- */

/**
 * The mailbox an address really delivers to. Gmail ignores dots and anything
 * after a plus, so `j.smith+news@gmail.com` and `jsmith@gmail.com` are one
 * inbox; plus-addressing is treated as an alias everywhere else too.
 */
export function canonicalMailbox(email: string): string {
  const [local = '', domain = ''] = email.toLowerCase().split('@')
  const base = local.split('+')[0]!
  const isGmail = domain === 'gmail.com' || domain === 'googlemail.com'
  return `${isGmail ? base.replace(/\./g, '') : base}@${isGmail ? 'gmail.com' : domain}`
}

/** Folds the others into `keepId`: blanks filled, memberships and history moved. */
export function mergeContacts(
  ctx: Ctx,
  keepId: string,
  mergeIds: string[],
  userName: string,
): Contact {
  const { db } = ctx
  const keep = getContactRow(db, keepId)
  db.transaction(() => {
    for (const id of mergeIds) {
      if (id === keepId) continue
      const other = getContactRow(db, id)
      const custom = {
        ...parseJson<Record<string, string>>(other.custom, {}),
        ...parseJson<Record<string, string>>(keep.custom, {}),
      }
      db.prepare(
        /* sql */ `UPDATE contacts SET
          first_name = COALESCE(NULLIF(first_name, ''), @firstName), last_name = COALESCE(NULLIF(last_name, ''), @lastName),
          company = COALESCE(NULLIF(company, ''), @company), phone = COALESCE(NULLIF(phone, ''), @phone),
          birthday = COALESCE(NULLIF(birthday, ''), @birthday), custom = @custom, updated_at = @now
         WHERE id = @id`,
      ).run({
        id: keepId,
        firstName: other.first_name,
        lastName: other.last_name,
        company: other.company,
        phone: other.phone,
        birthday: other.birthday,
        custom: JSON.stringify(custom),
        now: nowIso(),
      })
      db.prepare(
        'INSERT OR IGNORE INTO contact_tags (contact_id, tag_id, created_at) SELECT ?, tag_id, created_at FROM contact_tags WHERE contact_id = ?',
      ).run(keepId, id)
      db.prepare(
        'INSERT OR IGNORE INTO list_members (list_id, contact_id, status, subscribed_at, unsubscribed_at) SELECT list_id, ?, status, subscribed_at, unsubscribed_at FROM list_members WHERE contact_id = ?',
      ).run(keepId, id)
      db.prepare('UPDATE messages SET contact_id = ? WHERE contact_id = ?').run(keepId, id)
      db.prepare('UPDATE message_events SET contact_id = ? WHERE contact_id = ?').run(keepId, id)
      db.prepare('UPDATE contact_events SET contact_id = ? WHERE contact_id = ?').run(keepId, id)
      db.prepare('DELETE FROM contacts WHERE id = ?').run(id)
      recordEvent(db, keepId, 'merged', `Merged with ${other.email} by ${userName}`, {
        email: other.email,
      })
    }
  })()
  return getContact(db, keepId)
}
