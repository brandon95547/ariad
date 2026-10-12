import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'
import { migrate } from './migrations.js'
import { seedTemplates } from './seed.js'

export type { Db }

export interface OpenDatabaseOptions {
  path: string
  log?: (message: string) => void
}

/**
 * Opens the database, applies migrations and seeds the starter templates.
 * Safe to call repeatedly; every step is idempotent.
 *
 * Note on backups: WAL mode means the newest writes live in `-wal`, not in the
 * main file. Copying the `.sqlite` on its own silently loses them — take a
 * backup with `VACUUM INTO 'backup.sqlite'` instead of `cp`.
 */
export function openDatabase({ path: dbPath, log }: OpenDatabaseOptions): Db {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  }

  const db = new Database(dbPath)

  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  migrate(db, log)
  seedTemplates(db, log)

  return db
}

/** JSON columns: a bad value in one row should not take the whole page down. */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/** `?, ?, ?` for an IN list. Callers guard against an empty list themselves. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

/**
 * Escapes the wildcards in a user's search term. Used with `ESCAPE '\'`, so
 * searching for "50%" finds "50%" and not everything starting with "50".
 */
export function likeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`)
}
