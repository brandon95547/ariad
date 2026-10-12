# Ariad

Email marketing you host yourself. Contacts, campaigns, automations, signup
forms and reports, sending through your own Gmail or SMTP accounts.

<!-- Nothing in here phones home. Your contacts and your mail stay on your
     machine and go out through the mailboxes you connect. -->

## Running it

```bash
npm install
npm run dev          # http://localhost:5190
```

The first time you open it there are no accounts, so it asks you to create the
owner. After that it is a normal sign-in.

`npm run dev` starts the API (port 5191), the web app (5190) and a watcher on
the shared package. It is safe to run twice: it reuses whichever halves are
already up.

```bash
npm test             # API tests, against a real SMTP server on localhost
npm run typecheck
npm run build        # then: npm start — one process, one port, serves everything
```

### Trying it without emailing anyone

```bash
npm run mail:catch   # an SMTP server on 127.0.0.1:2525 that prints what it gets
```

Add an SMTP account in Ariad with host `127.0.0.1`, port `2525`, security
**None**, any username and password. Campaigns, automations and signup
confirmations are then printed in that terminal instead of going out.

## Connecting Gmail

Settings › Sending accounts › **Add Gmail**. Ariad signs in to Gmail with an
*app password*, a 16-letter password Google makes for one app:

1. Turn on 2-Step Verification for the Google account.
2. Create an app password at <https://myaccount.google.com/apppasswords>.
3. Paste it into Ariad, with or without the spaces.

Saving the account signs in straight away, and **Send test** sends one real
email through it. Google allows 500 recipients a day on a personal account and
2,000 on Google Workspace; the daily limit on the account is set to match, and
mail over it waits in the queue rather than being refused.

Any other mailbox or sending service is an **SMTP account**. Amazon SES,
SendGrid, Mailgun, Postmark, Brevo, Microsoft 365, Zoho, Yahoo and iCloud are
presets: pick one and the host, port and security are filled in.

Passwords are stored encrypted (AES-256-GCM) under a key that is not in the
database: `ARIAD_SECRET` if you set it, otherwise `apps/api/data/secret.key`,
generated on first run. **Back that file up with the database.** Without it the
stored passwords cannot be read and each account has to be re-entered.

## Before a real campaign

Three things the dashboard's checklist walks you through:

- **A mailing address** (Settings › Organization). US law requires a physical
  postal address in every marketing email; Ariad puts it in the footer and
  will not send a campaign without one.
- **A public URL** (same page). Unsubscribe links, open tracking and click
  tracking are links back to this server, so they only work for other people
  once Ariad is somewhere they can reach. On `localhost` you can connect
  accounts and send yourself tests; real recipients need a real address.
- **Domain records** (Settings › Domains), when you send from your own domain.
  It looks up SPF, DKIM and DMARC and says what to add. Gmail and Yahoo refuse
  bulk mail from domains without them.

## What is in it

| Area | What it does |
| --- | --- |
| **Contacts** | Add, edit, delete; CSV import with column mapping and export; lists, tags and custom fields; segments built from rules; duplicate detection and merge; a suppression list. |
| **Campaigns** | A block builder with drag and drop, or hand-written HTML; reusable templates; merge tags with fallbacks (`{{first_name\|there}}`); desktop and phone preview; test sends; send now or schedule; pause, resume and cancel. |
| **Automations** | A trigger and a line of steps. Welcome emails and series, birthdays and anniversaries, follow-ups to people who did or did not open a campaign, tag and form triggers; emails, waits and tag changes as steps. |
| **Signup forms** | A hosted page, an iframe embed and a plain HTML form; double opt-in; choose-your-lists; a preferences page and an unsubscribe page for subscribers. |
| **Reports** | Sent, delivered, opened, clicked, bounced, unsubscribed, per campaign and over time; which links were clicked; each contact's own history. |
| **Delivery** | A queue with per-account per-minute and per-day limits, retries with backoff, and bounces and provider throttling told apart. |
| **Compliance** | The CAN-SPAM footer, one-click unsubscribe (RFC 8058), consent recorded with its source, time and wording, SPF/DKIM/DMARC checks. |
| **Administration** | Four roles (viewer, editor, admin, owner), API keys, system logs, settings. |

### Not built

Said plainly, so nothing here is assumed:

- **Bounces that arrive later.** An address the mail server refuses on the spot
  is recorded as a bounce and suppressed. A bounce that comes back afterwards
  as an email to the sender — which is how Gmail reports most of them — is not
  read. Add those addresses to the suppression list by hand.
- **Spam complaints.** There is no feedback loop from mailbox providers, so
  complaints are not recorded automatically.
- **Provider HTTP APIs.** SES, SendGrid and the rest are connected through
  their SMTP endpoints, not their own APIs.
- A/B testing, a visual workflow canvas, AI writing, e-commerce integrations
  and outgoing webhooks.

## How it is put together

An npm-workspaces monorepo.

```
packages/shared   The contract: types and zod schemas both sides import, plus
                  the two things that must not drift between them — merge tags
                  and the function that turns a design into email HTML.
apps/api          Fastify + SQLite. Routes, the mailer, the background sender.
apps/web          React 19 + Vite + Tailwind v4.
```

**One process, one file.** The API, the background sender and (in production)
the built web app are one Node process, and the data is one SQLite file. The
sender reads rows that are due, so stopping it mid-send loses nothing: what was
queued is still queued when it comes back.

**The queue is the history.** A message is one row from queued to sent to
opened. A campaign's report and a contact's timeline are read from those rows,
not from copies of them.

**What can be emailed is decided in one place.** A contact is sent to only if
they are subscribed and not on the suppression list, and that is checked again
at the moment of sending — someone who unsubscribes an hour into a two-day send
does not get the email. Unsubscribing writes a suppression, so deleting a
contact or re-importing a spreadsheet does not make the address mailable again.

**The interface follows the UI Bible.** `apps/web/src/styles/tokens.css` and
`globals.css` are verbatim copies of its token and base layers, and each
component in `apps/web/src/ui` implements that page's measurements and rules.
Ariad's own CSS is in `ariad.css`.

## Configuration

`apps/api/.env.example` lists every variable with its default. The ones that
matter outside development:

| Variable | What it is |
| --- | --- |
| `PORT`, `HOST` | Where the server listens. |
| `DATABASE_PATH` | The SQLite file. Uploads and the secret key live beside it. |
| `APP_URL` | The address used in links until a public URL is saved in Settings. |
| `ARIAD_SECRET` | 64 hex characters. Optional; see *Connecting Gmail*. |
| `WORKER` | `0` runs the API without the background sender. |

### Backups

SQLite runs in WAL mode, so the newest writes are in `ariad.sqlite-wal`, not
the main file. Copying `ariad.sqlite` on its own silently loses them. Take a
backup with:

```bash
sqlite3 apps/api/data/ariad.sqlite "VACUUM INTO 'backup.sqlite'"
```

and keep `secret.key` with it.
