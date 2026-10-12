import type { Database } from 'better-sqlite3'

/**
 * Migrations, applied in order and tracked with SQLite's own `user_version`
 * pragma. Append only: never edit a shipped migration, and each one has to be
 * safe to run against a database that already has data in it.
 *
 * Times are ISO-8601 UTC strings throughout. They sort correctly as text and
 * read correctly in a SQL shell.
 */
export interface Migration {
  readonly version: number
  readonly name: string
  readonly up: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: /* sql */ `
      -- People who sign in to Ariad.
      CREATE TABLE users (
        id             TEXT PRIMARY KEY,
        email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name           TEXT NOT NULL,
        password_hash  TEXT NOT NULL,
        role           TEXT NOT NULL CHECK (role IN ('viewer','editor','admin','owner')),
        status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
        created_at     TEXT NOT NULL,
        last_login_at  TEXT
      );

      -- The id is a hash of the cookie, so a leaked database is not a set of
      -- working sessions.
      CREATE TABLE sessions (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        user_agent  TEXT,
        ip          TEXT
      );

      CREATE TABLE api_keys (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        prefix        TEXT NOT NULL,
        key_hash      TEXT NOT NULL UNIQUE,
        role          TEXT NOT NULL CHECK (role IN ('viewer','editor','admin')),
        created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at    TEXT NOT NULL,
        last_used_at  TEXT,
        revoked_at    TEXT
      );

      CREATE TABLE settings (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      -- Mailboxes Ariad may send through. password_enc is AES-GCM under a key
      -- that is not in this file (see lib/crypto.ts).
      CREATE TABLE sending_accounts (
        id                TEXT PRIMARY KEY,
        kind              TEXT NOT NULL CHECK (kind IN ('gmail','smtp')),
        label             TEXT NOT NULL,
        from_name         TEXT NOT NULL,
        from_email        TEXT NOT NULL COLLATE NOCASE,
        reply_to          TEXT,
        host              TEXT NOT NULL,
        port              INTEGER NOT NULL,
        security          TEXT NOT NULL CHECK (security IN ('ssl','starttls','none')),
        username          TEXT NOT NULL DEFAULT '',
        password_enc      TEXT NOT NULL DEFAULT '',
        daily_limit       INTEGER NOT NULL,
        per_minute        INTEGER NOT NULL,
        enabled           INTEGER NOT NULL DEFAULT 1,
        is_default        INTEGER NOT NULL DEFAULT 0,
        status            TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','ok','error')),
        last_error        TEXT,
        last_verified_at  TEXT,
        paused_until      TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );

      CREATE TABLE contacts (
        id                  TEXT PRIMARY KEY,
        email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
        first_name          TEXT,
        last_name           TEXT,
        company             TEXT,
        phone               TEXT,
        birthday            TEXT,
        status              TEXT NOT NULL DEFAULT 'subscribed'
                            CHECK (status IN ('subscribed','pending','unsubscribed','bounced','complained')),
        source              TEXT,
        custom              TEXT NOT NULL DEFAULT '{}',
        -- In every unsubscribe and preferences link. Not the id, so a link
        -- cannot be guessed from another one.
        token               TEXT NOT NULL UNIQUE,
        consent_at          TEXT,
        consent_source      TEXT,
        consent_text        TEXT,
        consent_ip          TEXT,
        confirmed_at        TEXT,
        unsubscribed_at     TEXT,
        unsubscribe_reason  TEXT,
        last_sent_at        TEXT,
        last_opened_at      TEXT,
        last_clicked_at     TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE INDEX contacts_status  ON contacts(status);
      CREATE INDEX contacts_created ON contacts(created_at);

      CREATE TABLE lists (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        description    TEXT,
        double_opt_in  INTEGER NOT NULL DEFAULT 0,
        is_public      INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL
      );

      CREATE TABLE list_members (
        list_id          TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        contact_id       TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        status           TEXT NOT NULL DEFAULT 'subscribed'
                         CHECK (status IN ('subscribed','pending','unsubscribed')),
        subscribed_at    TEXT,
        unsubscribed_at  TEXT,
        PRIMARY KEY (list_id, contact_id)
      ) WITHOUT ROWID;
      CREATE INDEX list_members_contact ON list_members(contact_id);

      CREATE TABLE tags (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
        color       TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE contact_tags (
        contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (contact_id, tag_id)
      ) WITHOUT ROWID;
      CREATE INDEX contact_tags_tag ON contact_tags(tag_id);

      CREATE TABLE custom_fields (
        id          TEXT PRIMARY KEY,
        key         TEXT NOT NULL UNIQUE,
        label       TEXT NOT NULL,
        type        TEXT NOT NULL CHECK (type IN ('text','number','date','boolean','select')),
        options     TEXT NOT NULL DEFAULT '[]',
        created_at  TEXT NOT NULL
      );

      CREATE TABLE segments (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        description  TEXT,
        match        TEXT NOT NULL CHECK (match IN ('all','any')),
        rules        TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      -- Addresses that are never sent to, whatever any list says. Kept apart
      -- from contacts on purpose: deleting a contact must not make them
      -- mailable again.
      CREATE TABLE suppressions (
        email       TEXT PRIMARY KEY COLLATE NOCASE,
        reason      TEXT NOT NULL CHECK (reason IN ('unsubscribed','bounced','complained','manual')),
        note        TEXT,
        created_at  TEXT NOT NULL
      );

      -- One contact's history, newest last.
      CREATE TABLE contact_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        type        TEXT NOT NULL,
        summary     TEXT NOT NULL,
        detail      TEXT,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX contact_events_contact ON contact_events(contact_id, id);

      CREATE TABLE templates (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        description  TEXT,
        subject      TEXT NOT NULL DEFAULT '',
        preheader    TEXT,
        html         TEXT NOT NULL DEFAULT '',
        design       TEXT,
        builtin      INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      CREATE TABLE campaigns (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        subject       TEXT NOT NULL DEFAULT '',
        preheader     TEXT,
        from_name     TEXT,
        from_email    TEXT,
        reply_to      TEXT,
        account_id    TEXT REFERENCES sending_accounts(id) ON DELETE SET NULL,
        audience      TEXT NOT NULL,
        html          TEXT NOT NULL DEFAULT '',
        design        TEXT,
        status        TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','scheduled','sending','paused','sent','canceled')),
        scheduled_at  TEXT,
        started_at    TEXT,
        finished_at   TEXT,
        track_opens   INTEGER NOT NULL DEFAULT 1,
        track_clicks  INTEGER NOT NULL DEFAULT 1,
        created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX campaigns_status ON campaigns(status, scheduled_at);

      CREATE TABLE automations (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        description  TEXT,
        status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused')),
        trigger      TEXT NOT NULL,
        steps        TEXT NOT NULL DEFAULT '[]',
        account_id   TEXT REFERENCES sending_accounts(id) ON DELETE SET NULL,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      -- A contact's trip through an automation. "occasion" is what makes a
      -- repeat a repeat: 'once' for a welcome, the year for a birthday, the
      -- campaign id for a follow-up.
      CREATE TABLE automation_runs (
        id             TEXT PRIMARY KEY,
        automation_id  TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
        contact_id     TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        occasion       TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','completed','exited','failed')),
        step_index     INTEGER NOT NULL DEFAULT 0,
        next_run_at    TEXT,
        note           TEXT,
        started_at     TEXT NOT NULL,
        finished_at    TEXT,
        UNIQUE (automation_id, contact_id, occasion)
      );
      CREATE INDEX automation_runs_due ON automation_runs(status, next_run_at);

      -- The send queue and the send history are the same table: a message is
      -- queued, then sent, then opened, and it is one row throughout.
      --
      -- Campaign messages carry no body: they are rendered from the campaign
      -- at send time, so ten thousand recipients do not store ten thousand
      -- copies. Every other kind carries its own subject and html.
      CREATE TABLE messages (
        id               TEXT PRIMARY KEY,
        kind             TEXT NOT NULL CHECK (kind IN ('campaign','automation','test','system')),
        campaign_id      TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
        automation_id    TEXT REFERENCES automations(id) ON DELETE SET NULL,
        step_id          TEXT,
        contact_id       TEXT REFERENCES contacts(id) ON DELETE SET NULL,
        to_email         TEXT NOT NULL,
        account_id       TEXT REFERENCES sending_accounts(id) ON DELETE SET NULL,
        subject          TEXT,
        html             TEXT,
        -- Higher goes first. A confirmation email should not wait behind a
        -- ten-thousand-recipient campaign.
        priority         INTEGER NOT NULL DEFAULT 0,
        status           TEXT NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued','sending','sent','failed','bounced','canceled')),
        attempts         INTEGER NOT NULL DEFAULT 0,
        next_attempt_at  TEXT NOT NULL,
        last_error       TEXT,
        smtp_id          TEXT,
        token            TEXT NOT NULL UNIQUE,
        queued_at        TEXT NOT NULL,
        sent_at          TEXT,
        opened_at        TEXT,
        open_count       INTEGER NOT NULL DEFAULT 0,
        clicked_at       TEXT,
        click_count      INTEGER NOT NULL DEFAULT 0,
        bounced_at       TEXT,
        unsubscribed_at  TEXT,
        complained_at    TEXT
      );
      CREATE INDEX messages_queue      ON messages(status, account_id, next_attempt_at);
      CREATE INDEX messages_campaign   ON messages(campaign_id, status);
      CREATE INDEX messages_contact    ON messages(contact_id);
      CREATE INDEX messages_sent       ON messages(account_id, sent_at);
      CREATE INDEX messages_automation ON messages(automation_id);

      CREATE TABLE message_events (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        campaign_id  TEXT,
        contact_id   TEXT,
        type         TEXT NOT NULL CHECK (type IN ('open','click','bounce','unsubscribe','complaint')),
        url          TEXT,
        ip           TEXT,
        user_agent   TEXT,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX message_events_campaign ON message_events(campaign_id, type, created_at);
      CREATE INDEX message_events_created  ON message_events(created_at);

      CREATE TABLE forms (
        id                     TEXT PRIMARY KEY,
        name                   TEXT NOT NULL,
        title                  TEXT NOT NULL,
        description            TEXT,
        button_text            TEXT NOT NULL,
        success_message        TEXT NOT NULL,
        redirect_url           TEXT,
        list_ids               TEXT NOT NULL DEFAULT '[]',
        let_subscriber_choose  INTEGER NOT NULL DEFAULT 0,
        tag_ids                TEXT NOT NULL DEFAULT '[]',
        fields                 TEXT NOT NULL DEFAULT '[]',
        double_opt_in          INTEGER NOT NULL DEFAULT 1,
        consent_text           TEXT NOT NULL DEFAULT '',
        consent_required       INTEGER NOT NULL DEFAULT 1,
        enabled                INTEGER NOT NULL DEFAULT 1,
        submissions            INTEGER NOT NULL DEFAULT 0,
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL
      );

      -- Double opt-in: what a confirmation link will do when it is clicked.
      CREATE TABLE confirmations (
        token         TEXT PRIMARY KEY,
        contact_id    TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        list_ids      TEXT NOT NULL DEFAULT '[]',
        form_id       TEXT,
        created_at    TEXT NOT NULL,
        confirmed_at  TEXT
      );

      CREATE TABLE domains (
        id             TEXT PRIMARY KEY,
        domain         TEXT NOT NULL UNIQUE COLLATE NOCASE,
        dkim_selector  TEXT,
        result         TEXT,
        checked_at     TEXT,
        created_at     TEXT NOT NULL
      );

      CREATE TABLE logs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        level       TEXT NOT NULL CHECK (level IN ('info','warn','error')),
        scope       TEXT NOT NULL,
        message     TEXT NOT NULL,
        detail      TEXT,
        user_name   TEXT,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX logs_created ON logs(created_at);
    `,
  },
]

export function migrate(db: Database, log?: (message: string) => void): void {
  const current = db.pragma('user_version', { simple: true }) as number
  const pending = MIGRATIONS.filter((migration) => migration.version > current)
  for (const migration of pending) {
    // The version bump is inside the transaction, so a migration that fails
    // halfway leaves the database exactly where it was.
    db.transaction(() => {
      db.exec(migration.up)
      db.pragma(`user_version = ${migration.version}`)
    })()
    log?.(`applied migration ${migration.version} (${migration.name})`)
  }
}
