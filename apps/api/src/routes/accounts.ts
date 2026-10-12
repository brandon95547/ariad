import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  createSendingAccountSchema,
  sendTestSchema,
  updateSendingAccountSchema,
  type SendingAccount,
  type VerifyResult,
} from '@ariad/shared'
import {
  createAccount,
  credentialsOf,
  deleteAccount,
  getAccount,
  getAccountRow,
  listAccounts,
  makeDefault,
  updateAccount,
  verifyAccount,
} from '../services/accounts.js'
import { explainSmtpError } from '../services/mailer.js'
import { getSettings } from '../services/settings.js'
import { writeLog } from '../services/logs.js'

const idParams = z.object({ id: z.string() })

/**
 * Sending accounts: the Gmail and SMTP mailboxes Ariad sends through.
 * Reading them needs no more than a viewer, since a campaign has to name one;
 * anything that touches a credential needs an admin.
 */
export async function accountRoutes(base: FastifyInstance): Promise<void> {
  const app = base.withTypeProvider<ZodTypeProvider>()
  const { ctx, mailer } = app

  app.get('/sending-accounts', { preHandler: app.requireRole('viewer') }, async (): Promise<SendingAccount[]> =>
    listAccounts(ctx),
  )

  app.post(
    '/sending-accounts',
    { preHandler: app.requireRole('admin'), schema: { body: createSendingAccountSchema } },
    async (request, reply): Promise<{ account: SendingAccount; verify: VerifyResult }> => {
      reply.code(201)
      return createAccount(ctx, mailer, request.body, request.actor!.name)
    },
  )

  app.patch(
    '/sending-accounts/:id',
    { preHandler: app.requireRole('admin'), schema: { params: idParams, body: updateSendingAccountSchema } },
    async (request): Promise<{ account: SendingAccount; verify: VerifyResult | null }> =>
      updateAccount(ctx, mailer, request.params.id, request.body, request.actor!.name),
  )

  app.delete(
    '/sending-accounts/:id',
    { preHandler: app.requireRole('admin'), schema: { params: idParams } },
    async (request) => {
      deleteAccount(ctx, mailer, request.params.id, request.actor!.name)
      return { ok: true }
    },
  )

  app.post(
    '/sending-accounts/:id/default',
    { preHandler: app.requireRole('admin'), schema: { params: idParams } },
    async (request): Promise<SendingAccount> => makeDefault(ctx, request.params.id),
  )

  /** Signs in again and records the result. */
  app.post(
    '/sending-accounts/:id/verify',
    { preHandler: app.requireRole('admin'), schema: { params: idParams } },
    async (request): Promise<{ account: SendingAccount; verify: VerifyResult }> => {
      const verify = await verifyAccount(ctx, mailer, request.params.id)
      return { account: getAccount(ctx, request.params.id), verify }
    },
  )

  /**
   * Sends one real email, now, outside the queue — so the answer to "does
   * this account work?" arrives while the person is still looking at it.
   */
  app.post(
    '/sending-accounts/:id/test',
    { preHandler: app.requireRole('admin'), schema: { params: idParams, body: sendTestSchema } },
    async (request): Promise<VerifyResult> => {
      const row = getAccountRow(ctx, request.params.id)
      const organization = getSettings(ctx.db).organization.name || 'Ariad'
      try {
        const result = await mailer.send(credentialsOf(ctx, row), row.updated_at, {
          from: { name: row.from_name, address: row.from_email },
          to: request.body.to,
          replyTo: row.reply_to,
          subject: `Test email from ${organization}`,
          html: `<p>This is a test from Ariad.</p><p>It was sent through <strong>${row.label}</strong> (${row.host}), so that account is ready to send.</p>`,
          text: `This is a test from Ariad.\n\nIt was sent through ${row.label} (${row.host}), so that account is ready to send.`,
        })
        ctx.db
          .prepare("UPDATE sending_accounts SET status = 'ok', last_error = NULL, last_verified_at = ? WHERE id = ?")
          .run(new Date().toISOString(), row.id)
        writeLog(ctx.db, 'info', 'accounts', `Test email sent through ${row.from_email} to ${request.body.to}`, null, request.actor!.name)
        return { ok: true, message: `Sent to ${request.body.to}. Check the inbox, and the spam folder.`, detail: result.response }
      } catch (error) {
        const message = explainSmtpError(error, row)
        writeLog(ctx.db, 'error', 'accounts', `Test email through ${row.from_email} failed: ${message}`, null, request.actor!.name)
        return { ok: false, message, detail: String((error as Error).message ?? error).slice(0, 500) }
      }
    },
  )
}
