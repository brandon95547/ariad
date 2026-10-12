import {
  GMAIL_DAILY_LIMIT,
  GMAIL_SMTP,
  type CreateSendingAccountInput,
  type SendingAccount,
  type UpdateSendingAccountInput,
  type VerifyResult,
} from '@ariad/shared'
import type { z } from 'zod'
import type { createSendingAccountSchema, updateSendingAccountSchema } from '@ariad/shared'
import type { Ctx } from '../context.js'
import { AppError } from '../errors.js'
import { newId, nowIso } from '../lib/crypto.js'
import type { Mailer, SmtpCredentials } from './mailer.js'
import { getSettings, updateSettings } from './settings.js'
import { writeLog } from './logs.js'

export interface AccountRow {
  id: string
  kind: 'gmail' | 'smtp'
  label: string
  from_name: string
  from_email: string
  reply_to: string | null
  host: string
  port: number
  security: 'ssl' | 'starttls' | 'none'
  username: string
  password_enc: string
  daily_limit: number
  per_minute: number
  enabled: number
  is_default: number
  status: 'unverified' | 'ok' | 'error'
  last_error: string | null
  last_verified_at: string | null
  paused_until: string | null
  created_at: string
  updated_at: string
}

type CreateInput = z.output<typeof createSendingAccountSchema>
type UpdateInput = z.output<typeof updateSendingAccountSchema>

const dayAgo = () => new Date(Date.now() - 86_400_000).toISOString()

/** The password never leaves the server. Not masked, not hinted at: absent. */
function toAccount(ctx: Ctx, row: AccountRow): SendingAccount {
  const usage = ctx.db
    .prepare(
      /* sql */ `SELECT
        (SELECT COUNT(*) FROM messages WHERE account_id = @id AND sent_at >= @since) AS sent,
        (SELECT COUNT(*) FROM messages WHERE account_id = @id AND status = 'queued') AS queued`,
    )
    .get({ id: row.id, since: dayAgo() }) as { sent: number; queued: number }
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    fromName: row.from_name,
    fromEmail: row.from_email,
    replyTo: row.reply_to,
    host: row.host,
    port: row.port,
    security: row.security,
    username: row.username,
    dailyLimit: row.daily_limit,
    perMinute: row.per_minute,
    enabled: row.enabled === 1,
    isDefault: row.is_default === 1,
    status: row.status,
    lastError: row.last_error,
    lastVerifiedAt: row.last_verified_at,
    pausedUntil: row.paused_until && row.paused_until > nowIso() ? row.paused_until : null,
    sentLast24h: usage.sent,
    queued: usage.queued,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getAccountRow(ctx: Ctx, id: string): AccountRow {
  const row = ctx.db.prepare('SELECT * FROM sending_accounts WHERE id = ?').get(id) as AccountRow | undefined
  if (!row) throw AppError.notFound('sending account')
  return row
}

export function credentialsOf(ctx: Ctx, row: AccountRow): SmtpCredentials {
  return {
    id: row.id,
    kind: row.kind,
    host: row.host,
    port: row.port,
    security: row.security,
    username: row.username,
    password: ctx.secrets.decrypt(row.password_enc),
  }
}

export function listAccounts(ctx: Ctx): SendingAccount[] {
  const rows = ctx.db
    .prepare('SELECT * FROM sending_accounts ORDER BY is_default DESC, created_at ASC')
    .all() as AccountRow[]
  return rows.map((row) => toAccount(ctx, row))
}

export function getAccount(ctx: Ctx, id: string): SendingAccount {
  return toAccount(ctx, getAccountRow(ctx, id))
}

/** The account to use when nothing names one: the default, if it can send. */
export function defaultAccountRow(ctx: Ctx): AccountRow | undefined {
  return ctx.db
    .prepare('SELECT * FROM sending_accounts WHERE enabled = 1 ORDER BY is_default DESC, created_at ASC LIMIT 1')
    .get() as AccountRow | undefined
}

function setDefault(ctx: Ctx, id: string): void {
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE sending_accounts SET is_default = 0 WHERE is_default = 1').run()
    ctx.db.prepare('UPDATE sending_accounts SET is_default = 1 WHERE id = ?').run(id)
  })()
  updateSettings(ctx.db, { sending: { defaultAccountId: id } })
}

export function makeDefault(ctx: Ctx, id: string): SendingAccount {
  getAccountRow(ctx, id)
  setDefault(ctx, id)
  return getAccount(ctx, id)
}

/**
 * Saves the account and signs in with it straight away. The result of that
 * sign-in comes back with the account rather than blocking the save: a typo
 * in a password should leave a record to correct, not an empty form to fill
 * in again.
 */
export async function createAccount(
  ctx: Ctx,
  mailer: Mailer,
  input: CreateInput,
  userName: string,
): Promise<{ account: SendingAccount; verify: VerifyResult }> {
  const now = nowIso()
  const id = newId('acc')
  const values =
    input.kind === 'gmail'
      ? {
          label: input.label ?? input.email,
          fromName: input.fromName,
          fromEmail: input.email,
          host: GMAIL_SMTP.host as string,
          port: GMAIL_SMTP.port as number,
          security: GMAIL_SMTP.security as 'ssl',
          username: input.email,
          password: input.appPassword,
          dailyLimit: input.dailyLimit ?? GMAIL_DAILY_LIMIT,
          perMinute: input.perMinute ?? 20,
        }
      : {
          label: input.label,
          fromName: input.fromName,
          fromEmail: input.fromEmail,
          host: input.host,
          port: input.port,
          security: input.security,
          username: input.username,
          password: input.password,
          dailyLimit: input.dailyLimit ?? 2000,
          perMinute: input.perMinute ?? 30,
        }

  const taken = ctx.db
    .prepare('SELECT 1 FROM sending_accounts WHERE username = ? AND host = ? AND from_email = ?')
    .get(values.username, values.host, values.fromEmail)
  if (taken) throw AppError.conflict(`${values.fromEmail} is already connected.`)

  const isFirst = (ctx.db.prepare('SELECT COUNT(*) AS n FROM sending_accounts').get() as { n: number }).n === 0

  ctx.db
    .prepare(
      /* sql */ `INSERT INTO sending_accounts
        (id, kind, label, from_name, from_email, reply_to, host, port, security, username, password_enc,
         daily_limit, per_minute, enabled, is_default, status, created_at, updated_at)
       VALUES
        (@id, @kind, @label, @fromName, @fromEmail, @replyTo, @host, @port, @security, @username, @passwordEnc,
         @dailyLimit, @perMinute, 1, 0, 'unverified', @now, @now)`,
    )
    .run({
      id,
      kind: input.kind,
      label: values.label,
      fromName: values.fromName,
      fromEmail: values.fromEmail,
      replyTo: input.replyTo ?? null,
      host: values.host,
      port: values.port,
      security: values.security,
      username: values.username,
      passwordEnc: ctx.secrets.encrypt(values.password),
      dailyLimit: values.dailyLimit,
      perMinute: values.perMinute,
      now,
    })
  if (isFirst) setDefault(ctx, id)

  writeLog(ctx.db, 'info', 'accounts', `Sending account added: ${values.fromEmail}`, { kind: input.kind, host: values.host }, userName)
  const verify = await verifyAccount(ctx, mailer, id)
  return { account: getAccount(ctx, id), verify }
}

export async function updateAccount(
  ctx: Ctx,
  mailer: Mailer,
  id: string,
  input: UpdateInput,
  userName: string,
): Promise<{ account: SendingAccount; verify: VerifyResult | null }> {
  const row = getAccountRow(ctx, id)
  const isGmail = row.kind === 'gmail'
  // A Gmail account's address is its sign-in, so the two move together, and
  // its server settings are not editable at all.
  const fromEmail = input.fromEmail ?? row.from_email
  // Google shows an app password in four spaced groups; people paste it that way.
  const password = input.password && isGmail ? input.password.replace(/\s+/g, '') : input.password
  const next = {
    label: input.label ?? row.label,
    from_name: input.fromName ?? row.from_name,
    from_email: fromEmail,
    reply_to: input.replyTo === undefined ? row.reply_to : input.replyTo,
    host: isGmail ? row.host : (input.host ?? row.host),
    port: isGmail ? row.port : (input.port ?? row.port),
    security: isGmail ? row.security : (input.security ?? row.security),
    username: isGmail ? fromEmail : (input.username ?? row.username),
    password_enc: password ? ctx.secrets.encrypt(password) : row.password_enc,
    daily_limit: input.dailyLimit ?? row.daily_limit,
    per_minute: input.perMinute ?? row.per_minute,
    enabled: input.enabled === undefined ? row.enabled : input.enabled ? 1 : 0,
  }
  const connectionChanged =
    next.host !== row.host ||
    next.port !== row.port ||
    next.security !== row.security ||
    next.username !== row.username ||
    next.password_enc !== row.password_enc

  ctx.db
    .prepare(
      /* sql */ `UPDATE sending_accounts SET
        label = @label, from_name = @from_name, from_email = @from_email, reply_to = @reply_to,
        host = @host, port = @port, security = @security, username = @username, password_enc = @password_enc,
        daily_limit = @daily_limit, per_minute = @per_minute, enabled = @enabled,
        status = @status, paused_until = @paused_until, updated_at = @now
       WHERE id = @id`,
    )
    .run({
      ...next,
      id,
      status: connectionChanged ? 'unverified' : row.status,
      // Re-enabling or fixing an account is also "try again now".
      paused_until: connectionChanged || input.enabled ? null : row.paused_until,
      now: nowIso(),
    })
  mailer.forget(id)

  writeLog(ctx.db, 'info', 'accounts', `Sending account updated: ${next.from_email}`, null, userName)
  const verify = connectionChanged ? await verifyAccount(ctx, mailer, id) : null
  return { account: getAccount(ctx, id), verify }
}

export function deleteAccount(ctx: Ctx, mailer: Mailer, id: string, userName: string): void {
  const row = getAccountRow(ctx, id)
  const waiting = (
    ctx.db
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND status IN ('queued','sending')")
      .get(id) as { n: number }
  ).n
  if (waiting > 0) {
    throw AppError.conflict(
      `${waiting} ${waiting === 1 ? 'email is' : 'emails are'} still queued on this account. Pause or cancel the campaign first, or disable the account instead.`,
    )
  }
  ctx.db.prepare('DELETE FROM sending_accounts WHERE id = ?').run(id)
  mailer.forget(id)

  // The default has to land somewhere, or the next campaign has no sender.
  if (row.is_default === 1 || getSettings(ctx.db).sending.defaultAccountId === id) {
    const heir = defaultAccountRow(ctx)
    if (heir) setDefault(ctx, heir.id)
    else updateSettings(ctx.db, { sending: { defaultAccountId: null } })
  }
  writeLog(ctx.db, 'warn', 'accounts', `Sending account removed: ${row.from_email}`, null, userName)
}

export async function verifyAccount(ctx: Ctx, mailer: Mailer, id: string): Promise<VerifyResult> {
  const row = getAccountRow(ctx, id)
  const result = await mailer.verify(credentialsOf(ctx, row))
  ctx.db
    .prepare(
      'UPDATE sending_accounts SET status = ?, last_error = ?, last_verified_at = ?, paused_until = CASE WHEN ? THEN NULL ELSE paused_until END WHERE id = ?',
    )
    .run(result.ok ? 'ok' : 'error', result.ok ? null : result.message, nowIso(), result.ok ? 1 : 0, id)
  if (!result.ok) {
    writeLog(ctx.db, 'error', 'accounts', `Could not sign in to ${row.from_email}: ${result.message}`, {
      detail: result.detail,
    })
  }
  return result
}

export type { CreateSendingAccountInput, UpdateSendingAccountInput }
