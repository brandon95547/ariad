import type { SegmentDefinition, SegmentRule } from '@ariad/shared'
import { likeTerm, type Db } from '../db/index.js'
import { AppError } from '../errors.js'

/**
 * Turns a segment's rules into a WHERE clause over `contacts c`.
 *
 * Every value is bound, never concatenated. The only text that reaches the SQL
 * from a rule is a column name out of the table below or a custom-field key
 * that has been checked against the same pattern keys are created with.
 */
export interface Compiled {
  sql: string
  params: unknown[]
}

const TEXT_COLUMNS: Record<string, string> = {
  email: 'c.email',
  first_name: 'c.first_name',
  last_name: 'c.last_name',
  company: 'c.company',
  phone: 'c.phone',
  source: 'c.source',
}

const DATE_COLUMNS: Record<string, string> = {
  created_at: 'c.created_at',
  last_sent_at: 'c.last_sent_at',
  last_opened_at: 'c.last_opened_at',
  last_clicked_at: 'c.last_clicked_at',
}

const STATUSES = new Set(['subscribed', 'pending', 'unsubscribed', 'bounced', 'complained'])
const CUSTOM_KEY = /^[a-z][a-z0-9_]{0,39}$/

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

function need(rule: SegmentRule): string {
  const value = rule.value === null || rule.value === undefined ? '' : String(rule.value).trim()
  if (value === '') throw AppError.badRequest(`The "${rule.field}" condition needs a value.`)
  return value
}

function numberOf(rule: SegmentRule): number {
  const value = Number(need(rule))
  if (!Number.isFinite(value))
    throw AppError.badRequest(`The "${rule.field}" condition needs a number.`)
  return value
}

function textRule(column: string, rule: SegmentRule): Compiled {
  switch (rule.op) {
    case 'is':
      return { sql: `LOWER(COALESCE(${column}, '')) = LOWER(?)`, params: [need(rule)] }
    case 'is_not':
      return { sql: `LOWER(COALESCE(${column}, '')) <> LOWER(?)`, params: [need(rule)] }
    case 'contains':
      return { sql: `${column} LIKE ? ESCAPE '\\'`, params: [`%${likeTerm(need(rule))}%`] }
    case 'not_contains':
      return {
        sql: `COALESCE(${column}, '') NOT LIKE ? ESCAPE '\\'`,
        params: [`%${likeTerm(need(rule))}%`],
      }
    case 'starts_with':
      return { sql: `${column} LIKE ? ESCAPE '\\'`, params: [`${likeTerm(need(rule))}%`] }
    case 'ends_with':
      return { sql: `${column} LIKE ? ESCAPE '\\'`, params: [`%${likeTerm(need(rule))}`] }
    case 'is_blank':
      return { sql: `COALESCE(${column}, '') = ''`, params: [] }
    case 'is_not_blank':
      return { sql: `COALESCE(${column}, '') <> ''`, params: [] }
    default:
      throw AppError.badRequest(`"${rule.op}" cannot be used on ${rule.field}.`)
  }
}

function dateRule(column: string, rule: SegmentRule): Compiled {
  switch (rule.op) {
    case 'in_last_days':
      return { sql: `${column} >= ?`, params: [daysAgo(numberOf(rule))] }
    case 'not_in_last_days':
      // Never having happened is also "not in the last N days".
      return { sql: `(${column} IS NULL OR ${column} < ?)`, params: [daysAgo(numberOf(rule))] }
    case 'before':
      return { sql: `${column} < ?`, params: [need(rule)] }
    case 'after':
      return { sql: `${column} > ?`, params: [need(rule)] }
    case 'is_blank':
      return { sql: `COALESCE(${column}, '') = ''`, params: [] }
    case 'is_not_blank':
      return { sql: `COALESCE(${column}, '') <> ''`, params: [] }
    default:
      throw AppError.badRequest(`"${rule.op}" cannot be used on ${rule.field}.`)
  }
}

function compileRule(rule: SegmentRule, customTypes: ReadonlyMap<string, string>): Compiled {
  const { field } = rule

  if (field in TEXT_COLUMNS) return textRule(TEXT_COLUMNS[field]!, rule)
  if (field in DATE_COLUMNS) return dateRule(DATE_COLUMNS[field]!, rule)

  if (field === 'status') {
    const value = need(rule)
    if (!STATUSES.has(value)) throw AppError.badRequest('That is not a contact status.')
    if (rule.op === 'is') return { sql: 'c.status = ?', params: [value] }
    if (rule.op === 'is_not') return { sql: 'c.status <> ?', params: [value] }
  }

  if (field === 'birthday') {
    // Stored as YYYY-MM-DD or --MM-DD, so the month is read from the end.
    if (rule.op === 'month_is') {
      const month = numberOf(rule)
      if (month < 1 || month > 12) throw AppError.badRequest('Choose a month.')
      return { sql: 'substr(c.birthday, -5, 2) = ?', params: [String(month).padStart(2, '0')] }
    }
    if (rule.op === 'is_blank') return { sql: "COALESCE(c.birthday, '') = ''", params: [] }
    if (rule.op === 'is_not_blank') return { sql: "COALESCE(c.birthday, '') <> ''", params: [] }
  }

  if (field === 'tag' || field === 'list') {
    const exists =
      field === 'tag'
        ? 'EXISTS (SELECT 1 FROM contact_tags x WHERE x.contact_id = c.id AND x.tag_id = ?)'
        : "EXISTS (SELECT 1 FROM list_members x WHERE x.contact_id = c.id AND x.list_id = ? AND x.status = 'subscribed')"
    if (rule.op === 'has') return { sql: exists, params: [need(rule)] }
    if (rule.op === 'has_not') return { sql: `NOT ${exists}`, params: [need(rule)] }
  }

  if (field.startsWith('custom.')) {
    const key = field.slice(7)
    if (!CUSTOM_KEY.test(key) || !customTypes.has(key)) {
      throw AppError.badRequest(`There is no custom field "${key}".`)
    }
    const column = `json_extract(c.custom, '$.${key}')`
    const type = customTypes.get(key)
    if (type === 'number' && ['eq', 'gt', 'lt'].includes(rule.op)) {
      const op = { eq: '=', gt: '>', lt: '<' }[rule.op as 'eq' | 'gt' | 'lt']
      return { sql: `CAST(${column} AS REAL) ${op} ?`, params: [numberOf(rule)] }
    }
    if (
      type === 'date' &&
      ['in_last_days', 'not_in_last_days', 'before', 'after'].includes(rule.op)
    ) {
      return dateRule(column, rule)
    }
    return textRule(column, rule)
  }

  throw AppError.badRequest(`"${rule.op}" cannot be used on ${field}.`)
}

export function customFieldTypes(db: Db): Map<string, string> {
  const rows = db.prepare('SELECT key, type FROM custom_fields').all() as {
    key: string
    type: string
  }[]
  return new Map(rows.map((row) => [row.key, row.type]))
}

export function compileSegment(db: Db, definition: SegmentDefinition): Compiled {
  const types = customFieldTypes(db)
  const parts = definition.rules.map((rule) => compileRule(rule, types))
  if (parts.length === 0) return { sql: '1 = 1', params: [] }
  return {
    sql: `(${parts.map((part) => `(${part.sql})`).join(definition.match === 'any' ? ' OR ' : ' AND ')})`,
    params: parts.flatMap((part) => part.params),
  }
}

export function loadSegment(db: Db, id: string): SegmentDefinition {
  const row = db.prepare('SELECT match, rules FROM segments WHERE id = ?').get(id) as
    { match: 'all' | 'any'; rules: string } | undefined
  if (!row) throw AppError.notFound('segment')
  return { match: row.match, rules: JSON.parse(row.rules) as SegmentRule[] }
}

export function countSegment(db: Db, definition: SegmentDefinition): number {
  const { sql, params } = compileSegment(db, definition)
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM contacts c WHERE ${sql}`).get(...params) as { n: number }
  ).n
}
