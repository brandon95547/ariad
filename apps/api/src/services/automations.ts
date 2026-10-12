import {
  delayMs,
  withPreheader,
  type Automation,
  type AutomationStats,
  type AutomationStep,
  type AutomationTrigger,
} from '@ariad/shared'
import type { Ctx } from '../context.js'
import { parseJson, type Db } from '../db/index.js'
import { AppError } from '../errors.js'
import { newId, nowIso, randomToken } from '../lib/crypto.js'
import { defaultAccountRow } from './accounts.js'
import { SENDABLE } from './campaigns.js'
import { addTag, recordEvent, removeTag } from './contacts.js'
import { writeLog } from './logs.js'
import { getSettings } from './settings.js'

/**
 * The automation engine.
 *
 * A run is one contact's place in one automation: which step they are at and
 * when they next move. Everything is driven by the worker reading rows that
 * are due, so a restart loses nothing — a run that was mid-delay is simply
 * still mid-delay when the process comes back.
 */
export interface AutomationRow {
  id: string
  name: string
  description: string | null
  status: 'draft' | 'active' | 'paused'
  trigger: string
  steps: string
  account_id: string | null
  created_at: string
  updated_at: string
}

export function getAutomationRow(db: Db, id: string): AutomationRow {
  const row = db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as
    AutomationRow | undefined
  if (!row) throw AppError.notFound('automation')
  return row
}

function statsOf(db: Db, id: string): AutomationStats {
  const runs = db
    .prepare(
      /* sql */ `SELECT SUM(status = 'active') AS active, SUM(status = 'completed') AS completed,
                        SUM(status IN ('exited','failed')) AS exited
                 FROM automation_runs WHERE automation_id = ?`,
    )
    .get(id) as Record<string, number | null>
  const mail = db
    .prepare(
      /* sql */ `SELECT SUM(status = 'sent') AS sent, SUM(opened_at IS NOT NULL) AS opened, SUM(clicked_at IS NOT NULL) AS clicked
                 FROM messages WHERE automation_id = ?`,
    )
    .get(id) as Record<string, number | null>
  return {
    active: runs.active ?? 0,
    completed: runs.completed ?? 0,
    exited: runs.exited ?? 0,
    emailsSent: mail.sent ?? 0,
    opened: mail.opened ?? 0,
    clicked: mail.clicked ?? 0,
  }
}

export function toAutomation(db: Db, row: AutomationRow): Automation {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    trigger: parseJson<AutomationTrigger>(row.trigger, { type: 'manual' }),
    steps: parseJson<AutomationStep[]>(row.steps, []),
    accountId: row.account_id,
    stats: statsOf(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Starts a contact down an automation. Returns false when they have already
 * been through it for this occasion — the UNIQUE on the table is what makes a
 * welcome email something a person gets once, however many times the trigger
 * fires.
 */
export function enroll(db: Db, automationId: string, contactId: string, occasion: string): boolean {
  const result = db
    .prepare(
      /* sql */ `INSERT OR IGNORE INTO automation_runs (id, automation_id, contact_id, occasion, status, step_index, next_run_at, started_at)
                 VALUES (?, ?, ?, ?, 'active', 0, ?, ?)`,
    )
    .run(newId('run'), automationId, contactId, occasion, nowIso(), nowIso())
  if (result.changes > 0) {
    const row = db.prepare('SELECT name FROM automations WHERE id = ?').get(automationId) as {
      name: string
    }
    recordEvent(db, contactId, 'automation_started', `Started automation: ${row.name}`, {
      automationId,
    })
  }
  return result.changes > 0
}

export type TriggerEvent =
  | { type: 'list_subscribed'; listId: string; contactId: string }
  | { type: 'tag_added'; tagId: string; contactId: string }
  | { type: 'form_submitted'; formId: string; contactId: string }

/** Something happened to a contact: start every active automation that was waiting for it. */
export function fireTrigger(ctx: Ctx, event: TriggerEvent): void {
  const rows = ctx.db
    .prepare("SELECT id, trigger FROM automations WHERE status = 'active'")
    .all() as {
    id: string
    trigger: string
  }[]
  for (const row of rows) {
    const trigger = parseJson<AutomationTrigger>(row.trigger, { type: 'manual' })
    const matches =
      (trigger.type === 'list_subscribed' &&
        event.type === 'list_subscribed' &&
        (trigger.listId === null || trigger.listId === event.listId)) ||
      (trigger.type === 'tag_added' &&
        event.type === 'tag_added' &&
        trigger.tagId === event.tagId) ||
      (trigger.type === 'form_submitted' &&
        event.type === 'form_submitted' &&
        (trigger.formId === null || trigger.formId === event.formId))
    if (matches) enroll(ctx.db, row.id, event.contactId, 'once')
  }
}

interface RunRow {
  id: string
  automation_id: string
  contact_id: string
  step_index: number
}

function endRun(
  db: Db,
  run: RunRow,
  status: 'completed' | 'exited' | 'failed',
  note: string | null,
): void {
  db.prepare(
    'UPDATE automation_runs SET status = ?, note = ?, next_run_at = NULL, finished_at = ? WHERE id = ?',
  ).run(status, note, nowIso(), run.id)
  if (status === 'completed') {
    const row = db.prepare('SELECT name FROM automations WHERE id = ?').get(run.automation_id) as
      { name: string } | undefined
    recordEvent(
      db,
      run.contact_id,
      'automation_completed',
      `Finished automation: ${row?.name ?? ''}`.trim(),
      {
        automationId: run.automation_id,
      },
    )
  }
}

/**
 * Moves one run as far as it will go: through emails and tag changes without
 * stopping, up to the next delay or the end.
 */
function advance(ctx: Ctx, run: RunRow, automation: AutomationRow): void {
  const { db } = ctx
  const steps = parseJson<AutomationStep[]>(automation.steps, [])
  const sendable = db
    .prepare(`SELECT c.email FROM contacts c WHERE c.id = ? AND ${SENDABLE}`)
    .get(run.contact_id) as { email: string } | undefined
  if (!sendable) return endRun(db, run, 'exited', 'No longer subscribed')

  let index = run.step_index
  // Bounded, so a line of forty instant steps cannot spin for ever on a bug.
  for (let guard = 0; guard < 100; guard += 1) {
    const step = steps[index]
    if (!step) return endRun(db, run, 'completed', null)

    if (step.type === 'delay') {
      db.prepare('UPDATE automation_runs SET step_index = ?, next_run_at = ? WHERE id = ?').run(
        index + 1,
        new Date(Date.now() + delayMs(step)).toISOString(),
        run.id,
      )
      return
    }

    if (step.type === 'email') {
      const account = automation.account_id ? { id: automation.account_id } : defaultAccountRow(ctx)
      const now = nowIso()
      db.prepare(
        /* sql */ `INSERT INTO messages (id, kind, automation_id, step_id, contact_id, to_email, account_id, subject, html, priority, status, next_attempt_at, token, queued_at)
                   VALUES (?, 'automation', ?, ?, ?, ?, ?, ?, ?, 1, 'queued', ?, ?, ?)`,
      ).run(
        newId('msg'),
        automation.id,
        step.id,
        run.contact_id,
        sendable.email,
        account?.id ?? null,
        step.subject,
        withPreheader(step.html, step.preheader),
        now,
        randomToken(16),
        now,
      )
    } else if (step.type === 'add_tag') {
      if (db.prepare('SELECT 1 FROM tags WHERE id = ?').get(step.tagId))
        addTag(ctx, run.contact_id, step.tagId)
    } else if (step.type === 'remove_tag') {
      removeTag(db, run.contact_id, step.tagId)
    }
    index += 1
  }
  endRun(db, run, 'failed', 'Too many steps in a row')
}

/** Every run whose wait is over. Called on each worker pass. */
export function advanceDueRuns(ctx: Ctx): void {
  const due = ctx.db
    .prepare(
      /* sql */ `SELECT r.id, r.automation_id, r.contact_id, r.step_index FROM automation_runs r
                 JOIN automations a ON a.id = r.automation_id
                 WHERE r.status = 'active' AND r.next_run_at <= ? AND a.status = 'active'
                 ORDER BY r.next_run_at LIMIT 500`,
    )
    .all(nowIso()) as RunRow[]
  const cache = new Map<string, AutomationRow>()
  for (const run of due) {
    const automation = cache.get(run.automation_id) ?? getAutomationRow(ctx.db, run.automation_id)
    cache.set(run.automation_id, automation)
    try {
      ctx.db.transaction(() => advance(ctx, run, automation))()
    } catch (error) {
      endRun(ctx.db, run, 'failed', String((error as Error).message ?? error).slice(0, 300))
      writeLog(
        ctx.db,
        'error',
        'automations',
        `Automation "${automation.name}" failed for a contact`,
        {
          runId: run.id,
          error: String(error),
        },
      )
    }
  }
}

/** Today's date and hour where the account lives, not where the server does. */
export function localNow(
  timezone: string,
  at = new Date(),
): { year: number; md: string; hour: number } {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at)
  } catch {
    return localNow('UTC', at)
  }
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return {
    year: Number(get('year')),
    md: `${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
  }
}

const CUSTOM_KEY = /^[a-z][a-z0-9_]{0,39}$/

/**
 * The triggers nothing announces: a date coming round, and time passing since
 * a campaign. Checked every few minutes rather than on every pass.
 */
export function scanScheduledTriggers(ctx: Ctx): void {
  const { db } = ctx
  const rows = db
    .prepare("SELECT * FROM automations WHERE status = 'active'")
    .all() as AutomationRow[]
  const timezone = getSettings(db).timezone

  for (const row of rows) {
    const trigger = parseJson<AutomationTrigger>(row.trigger, { type: 'manual' })

    if (trigger.type === 'date') {
      const now = localNow(timezone)
      if (now.hour < trigger.hour) continue
      // An offset of -3 means "three days before", so today's send is for the
      // date three days from now.
      const target = localNow(timezone, new Date(Date.now() - trigger.offsetDays * 86_400_000))
      let column: string
      let extra = ''
      if (trigger.field === 'birthday') column = 'c.birthday'
      else if (trigger.field === 'created_at') {
        column = 'substr(c.created_at, 1, 10)'
        // An anniversary needs a year to have passed.
        extra = `AND substr(c.created_at, 1, 4) < '${target.year}'`
      } else if (trigger.field.startsWith('custom.') && CUSTOM_KEY.test(trigger.field.slice(7))) {
        column = `json_extract(c.custom, '$.${trigger.field.slice(7)}')`
      } else continue

      const contacts = db
        .prepare(
          `SELECT c.id FROM contacts c WHERE substr(${column}, -5) = ? ${extra} AND ${SENDABLE}`,
        )
        .all(target.md) as { id: string }[]
      for (const contact of contacts) enroll(db, row.id, contact.id, String(now.year))
    }

    if (trigger.type === 'campaign_followup') {
      const upper = new Date(Date.now() - trigger.afterDays * 86_400_000).toISOString()
      // Two days of slack for a worker that was down; the UNIQUE on the run
      // stops anyone being followed up twice, and the lower bound stops an
      // automation switched on today from reaching back through history.
      const lower = new Date(Date.now() - (trigger.afterDays + 2) * 86_400_000).toISOString()
      const condition = {
        sent: '1 = 1',
        opened: 'm.opened_at IS NOT NULL',
        not_opened: 'm.opened_at IS NULL',
        clicked: 'm.clicked_at IS NOT NULL',
        not_clicked: 'm.clicked_at IS NULL',
      }[trigger.condition]
      const messages = db
        .prepare(
          /* sql */ `SELECT m.contact_id AS contactId, m.campaign_id AS campaignId FROM messages m
                     JOIN contacts c ON c.id = m.contact_id
                     WHERE m.kind = 'campaign' AND m.status = 'sent' AND m.sent_at BETWEEN ? AND ?
                       AND (? IS NULL OR m.campaign_id = ?) AND ${condition} AND ${SENDABLE}`,
        )
        .all(lower, upper, trigger.campaignId, trigger.campaignId) as {
        contactId: string
        campaignId: string
      }[]
      for (const message of messages)
        enroll(db, row.id, message.contactId, `campaign:${message.campaignId}`)
    }
  }
}
