import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  UNSUBSCRIBE_REASONS,
  formSubmissionSchema,
  preferencesSchema,
  publicFieldsOf,
  unsubscribeSchema,
  type ConfirmationResult,
  type FormSubmissionResult,
  type PublicForm,
  type PublicPreferences,
} from '@ariad/shared'
import { parseJson, placeholders } from '../db/index.js'
import { AppError } from '../errors.js'
import { nowIso } from '../lib/crypto.js'
import { accountFor, getCampaignRow } from '../services/campaigns.js'
import {
  addToList,
  recordEvent,
  removeFromList,
  unsubscribeContact,
  type ContactRow,
} from '../services/contacts.js'
import { renderEmail } from '../services/render.js'
import { getSettings, publicUrl } from '../services/settings.js'
import { confirmSignup, signup } from '../services/subscribe.js'
import { campaignSource, type MessageRow } from '../services/worker.js'
import { getFormRow, toForm } from './forms.js'

/**
 * The routes a stranger can reach: the ones behind the links in an email, and
 * the signup forms. No session, no API key. Each is keyed by a long random
 * token, says as little as it can about who the token belongs to, and can be
 * repeated without doing anything twice.
 */

/** Per-address throttle for the signup endpoint. In memory; see auth.ts for why that is enough. */
const hits = new Map<string, { count: number; resetAt: number }>()
function throttled(key: string, max: number, windowMs: number): boolean {
  const entry = hits.get(key)
  if (!entry || entry.resetAt < Date.now()) {
    hits.set(key, { count: 1, resetAt: Date.now() + windowMs })
    if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt < Date.now()) hits.delete(k)
    return false
  }
  entry.count += 1
  return entry.count > max
}

/** `a•••@example.com`: enough for the owner to recognize, not enough to harvest. */
function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(3, Math.min(6, local.length - 1)))}@${domain}`
}

export async function publicRoutes(base: FastifyInstance): Promise<void> {
  const app = base.withTypeProvider<ZodTypeProvider>()
  const { ctx } = app
  const { db } = ctx

  // A plain HTML form on someone else's site posts urlencoded, not JSON.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)))
    },
  )

  const contactByToken = (token: string): ContactRow => {
    const row = db.prepare('SELECT * FROM contacts WHERE token = ?').get(token) as
      ContactRow | undefined
    if (!row) throw new AppError(404, 'not_found', 'This link is no longer valid.')
    return row
  }

  /** Which message the unsubscribe came from, so the campaign's report can count it. */
  const attribute = (contact: ContactRow, messageToken: string | undefined) => {
    if (!messageToken) return
    const message = db
      .prepare('SELECT id, campaign_id FROM messages WHERE token = ? AND contact_id = ?')
      .get(messageToken, contact.id) as { id: string; campaign_id: string | null } | undefined
    if (!message) return
    const now = nowIso()
    const first = db
      .prepare('UPDATE messages SET unsubscribed_at = ? WHERE id = ? AND unsubscribed_at IS NULL')
      .run(now, message.id)
    if (first.changes > 0) {
      db.prepare(
        "INSERT INTO message_events (message_id, campaign_id, contact_id, type, created_at) VALUES (?, ?, ?, 'unsubscribe', ?)",
      ).run(message.id, message.campaign_id, contact.id, now)
    }
  }

  const preferencesOf = (contact: ContactRow): PublicPreferences => {
    const lists = db
      .prepare(
        /* sql */ `SELECT l.id, l.name, l.description,
                          EXISTS (SELECT 1 FROM list_members m WHERE m.list_id = l.id AND m.contact_id = ? AND m.status = 'subscribed') AS subscribed
                   FROM lists l WHERE l.is_public = 1 ORDER BY l.name`,
      )
      .all(contact.id) as {
      id: string
      name: string
      description: string | null
      subscribed: number
    }[]
    return {
      email: maskEmail(contact.email),
      status: contact.status,
      organization: getSettings(db).organization.name,
      lists: lists.map((list) => ({ ...list, subscribed: list.subscribed === 1 })),
    }
  }

  const tokenParams = z.object({ token: z.string().min(8).max(200) })
  const messageQuery = z.object({ m: z.string().max(200).optional() })

  /* ---- Unsubscribe ------------------------------------------------------ */

  app.get(
    '/preferences/:token',
    { schema: { params: tokenParams } },
    async (request): Promise<PublicPreferences> =>
      preferencesOf(contactByToken(request.params.token)),
  )

  /**
   * GET on the List-Unsubscribe address lands on the page, where a person
   * decides. It must never unsubscribe by itself: link scanners and mail
   * previews fetch every URL in a message.
   */
  app.get(
    '/unsubscribe/:token',
    { schema: { params: tokenParams, querystring: messageQuery } },
    async (request, reply) =>
      reply.redirect(
        `${publicUrl(ctx)}/unsubscribe/${request.params.token}${request.query.m ? `?m=${encodeURIComponent(request.query.m)}` : ''}`,
      ),
  )

  /**
   * POST is the unsubscribe: from our page, with a reason, and from the
   * mailbox provider's own "Unsubscribe" button (RFC 8058), whose body is the
   * urlencoded `List-Unsubscribe=One-Click` and is not looked at.
   */
  app.post(
    '/unsubscribe/:token',
    { schema: { params: tokenParams, querystring: messageQuery } },
    async (request): Promise<PublicPreferences> => {
      const contact = contactByToken(request.params.token)
      const parsed = unsubscribeSchema.safeParse(request.body ?? {})
      const reasonKey = parsed.success ? parsed.data.reason : undefined
      const label = UNSUBSCRIBE_REASONS.find((reason) => reason.key === reasonKey)?.label
      const comment = parsed.success ? parsed.data.comment?.trim() : undefined
      // Our own page posts JSON, with a reason or without one; the provider's button never does.
      const oneClick = !String(request.headers['content-type'] ?? '').includes('application/json')

      db.transaction(() => {
        unsubscribeContact(db, contact.id, {
          reason: [label, comment].filter(Boolean).join(' — ') || null,
          via: oneClick ? 'one-click unsubscribe' : 'unsubscribe link',
        })
        attribute(contact, request.query.m)
        // A reason given after a one-click unsubscribe still gets recorded.
        if (contact.status === 'unsubscribed' && (label || comment)) {
          db.prepare('UPDATE contacts SET unsubscribe_reason = ? WHERE id = ?').run(
            [label, comment].filter(Boolean).join(' — '),
            contact.id,
          )
        }
      })()
      return preferencesOf(contactByToken(request.params.token))
    },
  )

  /** "That was a mistake" — offered on the page straight after unsubscribing. */
  app.post(
    '/resubscribe/:token',
    { schema: { params: tokenParams } },
    async (request): Promise<PublicPreferences> => {
      const contact = contactByToken(request.params.token)
      if (contact.status === 'unsubscribed') {
        db.transaction(() => {
          const now = nowIso()
          db.prepare(
            "UPDATE contacts SET status = 'subscribed', unsubscribed_at = NULL, unsubscribe_reason = NULL, updated_at = ? WHERE id = ?",
          ).run(now, contact.id)
          db.prepare("DELETE FROM suppressions WHERE email = ? AND reason = 'unsubscribed'").run(
            contact.email,
          )
          // Back on the lists they left with that unsubscribe, not on every list.
          db.prepare(
            "UPDATE list_members SET status = 'subscribed', unsubscribed_at = NULL WHERE contact_id = ? AND unsubscribed_at >= ?",
          ).run(contact.id, contact.unsubscribed_at ?? now)
          recordEvent(
            db,
            contact.id,
            'resubscribed',
            'Re-subscribed themselves from the unsubscribe page',
            { ip: request.ip },
          )
        })()
      }
      return preferencesOf(contactByToken(request.params.token))
    },
  )

  app.post(
    '/preferences/:token',
    { schema: { params: tokenParams, body: preferencesSchema } },
    async (request): Promise<PublicPreferences> => {
      const contact = contactByToken(request.params.token)
      if (contact.status !== 'subscribed')
        throw AppError.conflict('You are not subscribed, so there are no preferences to change.')
      const wanted = new Set(request.body.listIds)
      const lists = db.prepare('SELECT id FROM lists WHERE is_public = 1').all() as { id: string }[]
      db.transaction(() => {
        for (const list of lists) {
          const member = db
            .prepare('SELECT status FROM list_members WHERE list_id = ? AND contact_id = ?')
            .get(list.id, contact.id) as { status: string } | undefined
          if (wanted.has(list.id) && member?.status !== 'subscribed')
            addToList(ctx, contact.id, list.id, 'subscribed')
          if (!wanted.has(list.id) && member?.status === 'subscribed')
            removeFromList(db, contact.id, list.id, 'unsubscribe')
        }
      })()
      return preferencesOf(contact)
    },
  )

  /* ---- Double opt-in ---------------------------------------------------- */

  app.post(
    '/confirm/:token',
    { schema: { params: tokenParams } },
    async (request): Promise<ConfirmationResult> => {
      const result = confirmSignup(ctx, request.params.token, request.ip)
      // With double opt-in this is where the signup ends, so it is where the form's own message or page belongs.
      const form = result.formId
        ? (db
            .prepare('SELECT success_message, redirect_url FROM forms WHERE id = ?')
            .get(result.formId) as
            { success_message: string; redirect_url: string | null } | undefined)
        : undefined
      return {
        email: maskEmail(result.email),
        organization: result.organization,
        message: form?.success_message ?? null,
        redirectUrl: form?.redirect_url ?? null,
      }
    },
  )

  /* ---- Signup forms ----------------------------------------------------- */

  const formParams = z.object({ id: z.string() })

  const publicForm = (id: string): { form: ReturnType<typeof toForm>; view: PublicForm } => {
    const form = toForm(getFormRow(db, id))
    if (!form.enabled)
      throw new AppError(404, 'not_found', 'This form is no longer accepting signups.')
    const lists = form.listIds.length
      ? (db
          .prepare(
            `SELECT id, name, description FROM lists WHERE id IN (${placeholders(form.listIds.length)}) ORDER BY name`,
          )
          .all(...form.listIds) as PublicForm['lists'])
      : []
    const custom = (
      db.prepare('SELECT key, type, options FROM custom_fields').all() as {
        key: string
        type: PublicForm['fields'][number]['type']
        options: string
      }[]
    ).map((row) => ({
      key: row.key,
      type: row.type,
      options: parseJson<string[]>(row.options, []),
    }))
    return {
      form,
      view: {
        id: form.id,
        title: form.title,
        description: form.description,
        buttonText: form.buttonText,
        successMessage: form.successMessage,
        fields: publicFieldsOf(form.fields, custom),
        lists,
        letSubscriberChoose: form.letSubscriberChoose,
        consentText: form.consentText,
        consentRequired: form.consentRequired,
        organization: getSettings(db).organization.name,
      },
    }
  }

  app.get(
    '/forms/:id',
    { schema: { params: formParams } },
    async (request): Promise<PublicForm> => publicForm(request.params.id).view,
  )

  const submit = (request: FastifyRequest, id: string, body: unknown): FormSubmissionResult => {
    const { form, view } = publicForm(id)
    if (throttled(`form|${request.ip}`, 20, 10 * 60_000)) {
      throw new AppError(
        429,
        'too_many_requests',
        'Too many signups from this address. Try again in a few minutes.',
      )
    }
    const input = formSubmissionSchema.parse(body)
    const done = (status: FormSubmissionResult['status']): FormSubmissionResult => ({
      status,
      message:
        status === 'confirmation_sent'
          ? 'Almost done. Check your inbox and click the link to confirm.'
          : form.successMessage,
      redirectUrl: status === 'confirmation_sent' ? null : form.redirectUrl,
    })
    // The hidden field. A bot fills it in and is told everything went fine.
    if (input.website) return done(form.doubleOptIn ? 'confirmation_sent' : 'subscribed')
    if (form.consentRequired && !input.consent)
      throw AppError.badRequest('Please tick the box to agree before subscribing.')
    for (const field of form.fields) {
      if (field.required && !input.fields[field.key]?.trim())
        throw AppError.badRequest(`${field.label} is required.`)
    }

    const allowed = new Set(view.lists.map((list) => list.id))
    const chosen =
      form.letSubscriberChoose && input.listIds
        ? input.listIds.filter((listId) => allowed.has(listId))
        : [...allowed]
    if (chosen.length === 0) throw AppError.badRequest('Choose at least one list.')

    const custom: Record<string, string> = {}
    for (const field of form.fields) {
      if (field.key.startsWith('custom.') && input.fields[field.key])
        custom[field.key.slice(7)] = input.fields[field.key]!.trim()
    }
    const allowedKeys = new Set(form.fields.map((field) => field.key))
    const value = (key: string) => (allowedKeys.has(key) ? input.fields[key]?.trim() || null : null)

    const status = signup(ctx, {
      fields: {
        email: input.email,
        firstName: value('firstName'),
        lastName: value('lastName'),
        company: value('company'),
        phone: value('phone'),
        birthday: value('birthday'),
        custom,
      },
      listIds: chosen,
      tagIds: form.tagIds,
      doubleOptIn: form.doubleOptIn,
      source: `Form: ${form.name}`,
      consentText: input.consent ? form.consentText : null,
      ip: request.ip,
      formId: form.id,
    })
    db.prepare('UPDATE forms SET submissions = submissions + 1 WHERE id = ?').run(form.id)
    void app.worker.tick()
    // Every outcome reads the same to the person on the form.
    return done(
      status === 'already_subscribed'
        ? form.doubleOptIn
          ? 'confirmation_sent'
          : 'subscribed'
        : status,
    )
  }

  app.post('/forms/:id/subscribe', { schema: { params: formParams } }, async (request, reply) => {
    const isHtmlPost = String(request.headers['content-type'] ?? '').includes(
      'application/x-www-form-urlencoded',
    )
    if (!isHtmlPost) return submit(request, request.params.id, request.body)

    // The plain HTML embed: flat field names in, a page to land on out.
    const flat = (request.body ?? {}) as Record<string, string>
    const { email = '', consent, website, ...rest } = flat
    const landing = `${publicUrl(ctx)}/subscribe/${request.params.id}`
    try {
      const result = submit(request, request.params.id, {
        email,
        fields: rest,
        consent: consent === 'on' || consent === 'true' || consent === '1',
        website,
      })
      return reply.redirect(result.redirectUrl ?? `${landing}?done=${result.status}`, 303)
    } catch (error) {
      const message =
        error instanceof AppError ? error.message : 'Please check the form and try again.'
      return reply.redirect(`${landing}?error=${encodeURIComponent(message)}`, 303)
    }
  })

  /* ---- View in browser -------------------------------------------------- */

  app.get('/view/:token', { schema: { params: tokenParams } }, async (request, reply) => {
    const message = db
      .prepare('SELECT * FROM messages WHERE token = ?')
      .get(request.params.token) as MessageRow | undefined
    if (!message) throw new AppError(404, 'not_found', 'This message is no longer available.')
    const contact = message.contact_id
      ? (db.prepare('SELECT * FROM contacts WHERE id = ?').get(message.contact_id) as
          ContactRow | undefined)
      : undefined
    const campaign = message.campaign_id ? getCampaignRow(db, message.campaign_id) : null
    const account = accountFor(ctx, message.account_id)
    const mail = renderEmail(ctx, {
      source: campaign
        ? { ...campaignSource(campaign), trackOpens: false, trackClicks: false }
        : {
            subject: message.subject ?? '',
            html: message.html ?? '',
            fromName: null,
            fromEmail: null,
            replyTo: null,
            trackOpens: false,
            trackClicks: false,
            marketing: message.kind === 'automation',
          },
      account:
        account ?? ({ kind: 'smtp', from_name: '', from_email: '', reply_to: null } as never),
      contact: contact ?? null,
      toEmail: message.to_email,
      messageToken: message.token,
      settings: getSettings(db),
      baseUrl: publicUrl(ctx),
    })
    return (
      reply
        .header('content-type', 'text/html; charset=utf-8')
        // The email's own markup, shown as a page: no scripts, no framing.
        .header(
          'content-security-policy',
          "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; frame-ancestors 'none'",
        )
        .header('x-robots-tag', 'noindex')
        .send(mail.html)
    )
  })
}

/* ---------------------------------------------------------------------------
   Tracking. /t/o/<token>.gif and /t/c/<token>?u=…&s=…
   ------------------------------------------------------------------------ */

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export async function trackingRoutes(base: FastifyInstance): Promise<void> {
  const app = base.withTypeProvider<ZodTypeProvider>()
  const { ctx } = app
  const { db } = ctx

  interface Tracked {
    id: string
    campaign_id: string | null
    contact_id: string | null
    opened_at: string | null
    clicked_at: string | null
  }
  const byToken = db.prepare(
    'SELECT id, campaign_id, contact_id, opened_at, clicked_at FROM messages WHERE token = ?',
  )
  const event = db.prepare(
    'INSERT INTO message_events (message_id, campaign_id, contact_id, type, url, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )

  const record = (
    request: FastifyRequest,
    message: Tracked,
    type: 'open' | 'click',
    url: string | null,
  ) => {
    const now = nowIso()
    event.run(
      message.id,
      message.campaign_id,
      message.contact_id,
      type,
      url,
      request.ip,
      String(request.headers['user-agent'] ?? '').slice(0, 300),
      now,
    )
    if (type === 'open') {
      db.prepare(
        'UPDATE messages SET open_count = open_count + 1, opened_at = COALESCE(opened_at, ?) WHERE id = ?',
      ).run(now, message.id)
      if (message.contact_id)
        db.prepare('UPDATE contacts SET last_opened_at = ? WHERE id = ?').run(
          now,
          message.contact_id,
        )
    } else {
      // A click proves an open, even when images were blocked and the pixel never loaded.
      db.prepare(
        'UPDATE messages SET click_count = click_count + 1, clicked_at = COALESCE(clicked_at, ?), opened_at = COALESCE(opened_at, ?), open_count = MAX(open_count, 1) WHERE id = ?',
      ).run(now, now, message.id)
      if (message.contact_id) {
        db.prepare(
          'UPDATE contacts SET last_clicked_at = ?, last_opened_at = COALESCE(last_opened_at, ?) WHERE id = ?',
        ).run(now, now, message.contact_id)
      }
    }
  }

  app.get(
    '/o/:file',
    { schema: { params: z.object({ file: z.string().max(200) }) } },
    async (request, reply) => {
      const message = byToken.get(request.params.file.replace(/\.gif$/i, '')) as Tracked | undefined
      // The pixel is served whatever happens: a broken image in an email is a
      // worse outcome than an uncounted open.
      if (message) {
        try {
          record(request, message, 'open', null)
        } catch (error) {
          request.log.warn({ err: error }, 'could not record open')
        }
      }
      return reply
        .header('content-type', 'image/gif')
        .header('cache-control', 'no-store, no-cache, must-revalidate, private')
        .send(PIXEL)
    },
  )

  app.get(
    '/c/:token',
    {
      schema: {
        params: z.object({ token: z.string().max(200) }),
        querystring: z.object({ u: z.string().max(8000), s: z.string().max(64) }),
      },
    },
    async (request, reply) => {
      let url: string
      try {
        url = Buffer.from(request.query.u, 'base64url').toString('utf8')
      } catch {
        throw AppError.badRequest('This link is damaged.')
      }
      // Only ever redirect to a link we signed. Without this the endpoint is
      // an open redirect on your own domain, which is what phishing wants.
      if (
        !/^https?:\/\//i.test(url) ||
        !ctx.secrets.verify(`${request.params.token}|${url}`, request.query.s)
      ) {
        throw AppError.badRequest('This link is not valid.')
      }
      const message = byToken.get(request.params.token) as Tracked | undefined
      if (message) {
        try {
          record(request, message, 'click', url)
        } catch (error) {
          request.log.warn({ err: error }, 'could not record click')
        }
      }
      return reply.redirect(url, 302)
    },
  )
}
