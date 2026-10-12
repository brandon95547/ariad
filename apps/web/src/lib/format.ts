/**
 * How things are written on screen. One place, so "12 minutes ago" and "62.4%"
 * read the same on every page.
 */
const number = new Intl.NumberFormat('en-US')
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})
const dateOnly = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})
const shortDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

export const formatNumber = (value: number): string => number.format(value)
export const formatCompact = (value: number): string =>
  Math.abs(value) < 10_000 ? number.format(value) : compact.format(value)

/** A rate as a percentage. Null (nothing to divide by) is a dash, not 0%. */
export function formatRate(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(value > 0 && value < 0.001 ? 2 : digits)}%`
}

export const rate = (count: number, base: number): number | null => (base > 0 ? count / base : null)

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : '—'
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateOnly.format(new Date(iso)) : '—'
}

/** `2026-10-12` → `Oct 12`, for a chart axis. */
export function formatDay(day: string): string {
  return shortDay.format(new Date(`${day}T00:00:00Z`))
}

/** "3 minutes ago", "in 2 hours", falling back to the date past a week. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  const seconds = Math.round((then - Date.now()) / 1000)
  const ahead = seconds > 0
  const abs = Math.abs(seconds)
  const say = (count: number, unit: string) => {
    const label = `${count} ${unit}${count === 1 ? '' : 's'}`
    return ahead ? `in ${label}` : `${label} ago`
  }
  if (abs < 45) return ahead ? 'in a moment' : 'just now'
  if (abs < 3600) return say(Math.round(abs / 60), 'minute')
  if (abs < 86_400) return say(Math.round(abs / 3600), 'hour')
  if (abs < 7 * 86_400) return say(Math.round(abs / 86_400), 'day')
  return dateOnly.format(new Date(iso))
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`
}

export function contactName(contact: {
  firstName: string | null
  lastName: string | null
  email: string
}): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email
}

/** For `<input type="datetime-local">`, which wants local time with no zone. */
export function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
