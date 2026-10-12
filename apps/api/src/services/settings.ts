import { DEFAULT_SETTINGS, type Settings } from '@ariad/shared'
import type { Ctx } from '../context.js'
import { parseJson, type Db } from '../db/index.js'
import { nowIso } from '../lib/crypto.js'

/**
 * Settings are stored one top-level key per row, and read back over the
 * defaults — so a setting added in a later version has a value on databases
 * that predate it, without a migration.
 */
export function getSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const stored = Object.fromEntries(
    rows.map((row) => [row.key, parseJson<unknown>(row.value, null)]),
  )
  const pick = <K extends keyof Settings>(key: K): Settings[K] => {
    const fallback = DEFAULT_SETTINGS[key]
    const value = stored[key]
    if (value === null || value === undefined) return fallback
    return typeof fallback === 'object' && fallback !== null
      ? ({ ...fallback, ...(value as object) } as Settings[K])
      : (value as Settings[K])
  }
  return {
    organization: pick('organization'),
    publicUrl: pick('publicUrl'),
    timezone: pick('timezone'),
    sending: pick('sending'),
    compliance: pick('compliance'),
  }
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] }

export function updateSettings(db: Db, patch: DeepPartial<Settings>): Settings {
  const current = getSettings(db)
  const upsert = db.prepare(/* sql */ `
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)
  const now = nowIso()
  db.transaction(() => {
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      const next = patch[key]
      if (next === undefined) continue
      const base = current[key]
      const merged =
        typeof base === 'object' && base !== null ? { ...base, ...(next as object) } : next
      upsert.run(key, JSON.stringify(merged), now)
    }
  })()
  return getSettings(db)
}

/**
 * The address links in an email are built from. The saved setting wins; until
 * there is one, APP_URL does, which on a development machine is localhost.
 */
export function publicUrl(ctx: Ctx): string {
  return getSettings(ctx.db).publicUrl || ctx.config.appUrl
}

/** True when links built from this would only work on the sender's machine. */
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')
  } catch {
    return true
  }
}
