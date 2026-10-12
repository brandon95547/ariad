import type { LogEntry, LogLevel, Paged } from '@ariad/shared'
import { likeTerm, parseJson, type Db } from '../db/index.js'
import { nowIso } from '../lib/crypto.js'

/**
 * The system log people read in the app — what the queue did, which account
 * failed, who changed what. Not a replacement for the process log: this one is
 * for the person running the account, written in sentences.
 */
export function writeLog(
  db: Db,
  level: LogLevel,
  scope: string,
  message: string,
  detail?: Record<string, unknown> | null,
  userName?: string | null,
): void {
  db.prepare(
    'INSERT INTO logs (level, scope, message, detail, user_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(level, scope, message, detail ? JSON.stringify(detail) : null, userName ?? null, nowIso())
}

interface LogRow {
  id: number
  level: LogLevel
  scope: string
  message: string
  detail: string | null
  user_name: string | null
  created_at: string
}

export function listLogs(
  db: Db,
  query: { level?: LogLevel; scope?: string; q?: string; page: number; pageSize: number },
): Paged<LogEntry> {
  const where: string[] = []
  const params: unknown[] = []
  if (query.level) {
    where.push('level = ?')
    params.push(query.level)
  }
  if (query.scope) {
    where.push('scope = ?')
    params.push(query.scope)
  }
  if (query.q) {
    where.push("message LIKE ? ESCAPE '\\'")
    params.push(`%${likeTerm(query.q)}%`)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM logs ${clause}`).get(...params) as { n: number }
  ).n
  const rows = db
    .prepare(`SELECT * FROM logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as LogRow[]
  return {
    items: rows.map((row) => ({
      id: String(row.id),
      level: row.level,
      scope: row.scope,
      message: row.message,
      detail: parseJson<Record<string, unknown> | null>(row.detail, null),
      userName: row.user_name,
      createdAt: row.created_at,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  }
}

/** Old entries go; a log nobody prunes is a database that only grows. */
export function pruneLogs(db: Db, keepDays = 90): void {
  db.prepare('DELETE FROM logs WHERE created_at < ?').run(
    new Date(Date.now() - keepDays * 86_400_000).toISOString(),
  )
}
