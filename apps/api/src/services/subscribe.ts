import { escapeHtml, formatAddress, type FormSubmissionResult } from '@ariad/shared'
import type { Ctx } from '../context.js'
import { parseJson, placeholders } from '../db/index.js'
import { AppError } from '../errors.js'
import { newId, nowIso, randomToken } from '../lib/crypto.js'
import { defaultAccountRow } from './accounts.js'
import { fireTrigger } from './automations.js'
import {
  addTag,
  addToList,
  findByEmail,
  getContactRow,
  recordEvent,
  suppressionOf,
  upsertContact,
  type ContactFields,
} from './contacts.js'
import { writeLog } from './logs.js'
import { getSettings, publicUrl } from './settings.js'

/**
 * A person signing themselves up — through a form, or the public API.
 *
 * With double opt-in they are `pending` until they click the link in a
 * confirmation email, and only that click subscribes them. It is the one
 * record that proves the owner of the address asked for this, which is what
 * consent means under GDPR and what keeps typos and bots off the list.
 */
export interface SignupInput {
  fields: ContactFields
  listIds: string[]
  tagIds: string[]
  doubleOptIn: boolean
  source: string
  consentText: string | null
  ip: string | null
  formId: string | null
}

function confirmationEmail(ctx: Ctx, token: string, lists: string[]): { subject: string; html: string } {
  const settings = getSettings(ctx.db)
  const organization = settings.organization.name || 'us'
  const link = `${publicUrl(ctx)}/confirm/${token}`
  const address = formatAddress(settings.organization)
  const what = lists.length === 1 ? escapeHtml(lists[0]!) : `emails from ${escapeHtml(organization)}`
  return {
    subject: `Please confirm your subscription to ${organization}`,
    html: `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;background:#ffffff;border-radius:8px;">
<tr><td style="padding:32px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1f2933;">
<h1 style="margin:0 0 14px 0;font-size:22px;line-height:1.3;">One more step</h1>
<p style="margin:0 0 20px 0;">Someone, hopefully you, asked to subscribe to ${what}. Confirm that this is your address and you are in.</p>
<p style="margin:0 0 24px 0;"><a href="${link}" style="display:inline-block;background:#5b5bd6;color:#ffffff;font-weight:600;text-decoration:none;padding:13px 24px;border-radius:8px;">Yes, subscribe me</a></p>
<p style="margin:0;font-size:13px;color:#6b7280;">If this was not you, do nothing. You will not be subscribed and will not hear from us again.</p>
</td></tr></table>
<p style="margin:16px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#6b7280;">${escapeHtml(organization)}${address ? ` &middot; ${escapeHtml(address)}` : ''}</p>
</td></tr></table></body></html>`,
  }
}

export function signup(ctx: Ctx, input: SignupInput): FormSubmissionResult['status'] {
  const { db } = ctx
  const existing = findByEmail(db, input.fields.email)
  const suppression = suppressionOf(db, input.fields.email)

  // A bounced or complained address is not coming back through a form. The
  // caller answers as if it worked: a signup form must not confirm to a
  // stranger which addresses are on the list or why.
  if (suppression === 'bounced' || suppression === 'complained' || existing?.status === 'bounced' || existing?.status === 'complained') {
    return 'already_subscribed'
  }

  // Someone who unsubscribed and is now signing up again has changed their
  // mind — but only the owner of the address can say so, so it always goes
  // through a confirmation email, whatever the form's setting.
  const returning = existing?.status === 'unsubscribed' || suppression === 'unsubscribed' || suppression === 'manual'
  const confirm = input.doubleOptIn || returning

  if (confirm && !defaultAccountRow(ctx)) {
    writeLog(db, 'error', 'forms', 'A signup could not be confirmed: there is no sending account to send the confirmation email from.')
    throw new AppError(503, 'signups_unavailable', 'Signups are not available right now. Please try again later.')
  }

  return db.transaction((): FormSubmissionResult['status'] => {
    const consent = { source: input.source, text: input.consentText, ip: input.ip }

    if (!confirm) {
      const { row } = upsertContact(db, input.fields, { status: 'subscribed', source: input.source, consent, overwrite: false })
      const before = (
        db.prepare(`SELECT COUNT(*) AS n FROM list_members WHERE contact_id = ? AND status = 'subscribed' AND list_id IN (${placeholders(input.listIds.length || 1)})`).get(row.id, ...(input.listIds.length ? input.listIds : [''])) as { n: number }
      ).n
      for (const listId of input.listIds) addToList(ctx, row.id, listId, 'subscribed')
      for (const tagId of input.tagIds) addTag(ctx, row.id, tagId)
      recordEvent(db, row.id, 'form_submitted', `Signed up (${input.source})`, { formId: input.formId })
      if (input.formId) fireTrigger(ctx, { type: 'form_submitted', formId: input.formId, contactId: row.id })
      return existing && before === input.listIds.length && input.listIds.length > 0 ? 'already_subscribed' : 'subscribed'
    }

    // A returning contact keeps the standing they have until they confirm:
    // upsert never raises it, it only fills in what the form added.
    const { row } = upsertContact(db, input.fields, { status: 'pending', source: input.source, overwrite: false })

    const alreadyOnAll =
      !returning &&
      row.status === 'subscribed' &&
      input.listIds.length > 0 &&
      input.listIds.every((listId) =>
        db.prepare("SELECT 1 FROM list_members WHERE list_id = ? AND contact_id = ? AND status = 'subscribed'").get(listId, row.id),
      )
    if (alreadyOnAll) return 'already_subscribed'

    for (const listId of input.listIds) addToList(ctx, row.id, listId, 'pending')

    const token = randomToken(24)
    db.prepare('INSERT INTO confirmations (token, contact_id, list_ids, form_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
      token,
      row.id,
      JSON.stringify({ listIds: input.listIds, tagIds: input.tagIds, consent }),
      input.formId,
      nowIso(),
    )
    const listNames = input.listIds.length
      ? (db.prepare(`SELECT name FROM lists WHERE id IN (${placeholders(input.listIds.length)})`).all(...input.listIds) as { name: string }[]).map((list) => list.name)
      : []
    const mail = confirmationEmail(ctx, token, listNames)
    const now = nowIso()
    db.prepare(
      /* sql */ `INSERT INTO messages (id, kind, contact_id, to_email, account_id, subject, html, priority, status, next_attempt_at, token, queued_at)
                 VALUES (?, 'system', ?, ?, ?, ?, ?, 10, 'queued', ?, ?, ?)`,
    ).run(newId('msg'), row.id, row.email, defaultAccountRow(ctx)?.id ?? null, mail.subject, mail.html, now, randomToken(16), now)
    recordEvent(db, row.id, 'form_submitted', `Asked to subscribe (${input.source}); confirmation email sent`, { formId: input.formId })
    return 'confirmation_sent'
  })()
}

/** The click on the confirmation link. Safe to repeat. */
export function confirmSignup(ctx: Ctx, token: string, ip: string | null): { email: string; organization: string } {
  const { db } = ctx
  const row = db.prepare('SELECT * FROM confirmations WHERE token = ?').get(token) as
    | { token: string; contact_id: string; list_ids: string; form_id: string | null; confirmed_at: string | null }
    | undefined
  if (!row) throw new AppError(404, 'not_found', 'This confirmation link is not valid. It may have been used on a different address.')
  const contact = getContactRow(db, row.contact_id)
  const organization = getSettings(db).organization.name

  if (!row.confirmed_at) {
    const payload = parseJson<{ listIds: string[]; tagIds: string[]; consent: { source: string | null; text: string | null } }>(row.list_ids, {
      listIds: [],
      tagIds: [],
      consent: { source: null, text: null },
    })
    db.transaction(() => {
      const now = nowIso()
      db.prepare(
        /* sql */ `UPDATE contacts SET status = 'subscribed', confirmed_at = ?, unsubscribed_at = NULL, unsubscribe_reason = NULL,
                   consent_at = ?, consent_source = ?, consent_text = ?, consent_ip = ?, updated_at = ? WHERE id = ?`,
      ).run(now, now, payload.consent.source, payload.consent.text, ip, now, contact.id)
      // They asked to come back and proved the address is theirs.
      db.prepare("DELETE FROM suppressions WHERE email = ? AND reason IN ('unsubscribed','manual')").run(contact.email)
      db.prepare('UPDATE confirmations SET confirmed_at = ? WHERE token = ?').run(now, token)
      recordEvent(db, contact.id, 'confirmed', 'Confirmed their subscription by email', { ip })
      for (const listId of payload.listIds) {
        if (db.prepare('SELECT 1 FROM lists WHERE id = ?').get(listId)) addToList(ctx, contact.id, listId, 'subscribed')
      }
      for (const tagId of payload.tagIds) {
        if (db.prepare('SELECT 1 FROM tags WHERE id = ?').get(tagId)) addTag(ctx, contact.id, tagId)
      }
      if (row.form_id) fireTrigger(ctx, { type: 'form_submitted', formId: row.form_id, contactId: contact.id })
    })()
  }
  return { email: contact.email, organization }
}
