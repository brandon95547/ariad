#!/usr/bin/env node
/**
 * A local SMTP server that accepts mail and delivers it nowhere.
 *
 *   npm run mail:catch
 *
 * Then add an SMTP account in Ariad with host 127.0.0.1, port 2525, security
 * None, any username and password. Everything Ariad sends is printed here
 * instead of going out, so a campaign, an automation or a signup form can be
 * tried end to end without a real mailbox and without emailing anyone.
 */
import { SMTPServer } from 'smtp-server'

const PORT = Number(process.env.CATCHER_PORT ?? 2525)
let count = 0

const server = new SMTPServer({
  secure: false,
  disabledCommands: ['STARTTLS'],
  allowInsecureAuth: true,
  logger: false,
  onAuth: (auth, _session, callback) => callback(null, { user: auth.username || 'anyone' }),
  onData(stream, session, callback) {
    const chunks = []
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const header = (name) => new RegExp(`^${name}: (.*)$`, 'im').exec(raw)?.[1] ?? ''
      count += 1
      process.stdout.write(
        `\n#${count}  to ${session.envelope.rcptTo.map((rcpt) => rcpt.address).join(', ')}\n` +
          `    from     ${header('From')}\n    subject  ${header('Subject')}\n` +
          (process.env.CATCHER_VERBOSE ? `${raw}\n` : ''),
      )
      callback()
    })
  },
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`\n  Mail catcher listening on 127.0.0.1:${PORT}\n  CATCHER_VERBOSE=1 prints each message in full.\n`)
})
