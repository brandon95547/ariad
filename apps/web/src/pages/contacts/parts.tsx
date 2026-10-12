import { useEffect, useId, useState, type ReactNode } from 'react'
import {
  CONTACT_STATUS_LABELS,
  MONTHS,
  roleAtLeast,
  type Contact,
  type ContactList,
  type ContactStatus,
  type CustomField,
  type Role,
  type Tag,
} from '@ariad/shared'
import { cn } from '@/lib/cn'
import { formatNumber } from '@/lib/format'
import { useAuthState } from '@/lib/queries'
import { Badge } from '@/ui/Badge'
import { Field, Select, type SelectOption } from '@/ui/Controls'
import type { Tone } from '@/ui/Display'
import { TextInput } from '@/ui/Inputs'
import { MultiSelect } from '@/ui/MultiSelect'

/**
 * What the contact and audience pages share: query keys, the status badge,
 * the heading of an audience tab, and the fields a contact is edited through.
 */
export const contactKeys = {
  all: ['contacts'] as const,
  list: (query: object) => ['contacts', 'list', query] as const,
  detail: (id: string) => ['contacts', 'detail', id] as const,
  activity: (id: string) => ['contacts', 'activity', id] as const,
  duplicates: ['contacts', 'duplicates'] as const,
  suppressions: ['suppressions'] as const,
}

export function useCan(minimum: Role): boolean {
  return roleAtLeast(useAuthState().data?.user?.role ?? 'viewer', minimum)
}

/** The value, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return settled
}

const focusRing =
  'rounded-[var(--radius-xs)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]'

/** A link in a sentence. */
export const inlineLink = cn(focusRing, 'text-[var(--ds-accent-text)] underline underline-offset-2 hover:text-[var(--ds-fg)]')

/** The name in a table row, when the name is the way in. */
export const rowLink = cn(focusRing, 'font-medium text-[var(--ds-fg)] underline-offset-2 hover:underline')

const STATUS_TONE: Record<ContactStatus, Tone> = {
  subscribed: 'success',
  pending: 'warning',
  unsubscribed: 'neutral',
  bounced: 'danger',
  complained: 'danger',
}

export function StatusBadge({ status, size }: { status: ContactStatus; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot size={size}>
      {CONTACT_STATUS_LABELS[status]}
    </Badge>
  )
}

/** A tag's own color, as the dot that goes with its name. */
export function TagDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('block h-2 w-2 shrink-0 rounded-full', className)} style={{ backgroundColor: color }} />
}

/** The heading of an audience tab: what the tab holds, and its one verb. */
export function TabHeader({ title, description, action }: { title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex max-w-[40rem] flex-col gap-1">
        <h2 className="text-h3 text-[var(--ds-fg)]">{title}</h2>
        <p className="text-body-sm text-[var(--ds-fg-muted)]">{description}</p>
      </div>
      {action && <div className="flex items-center gap-2 coarse:gap-3">{action}</div>}
    </div>
  )
}

/** Adds the current value to a select's options when it is no longer one of them. */
export function withCurrent(options: SelectOption[], value: string, label: string): SelectOption[] {
  return value && !options.some((option) => option.value === value) ? [...options, { value, label }] : options
}

/* ---- Editing a contact ---------------------------------------------------- */

export interface ContactDraft {
  email: string
  firstName: string
  lastName: string
  company: string
  phone: string
  birthday: string
  custom: Record<string, string>
  listIds: string[]
  tagIds: string[]
}

export const EMPTY_DRAFT: ContactDraft = {
  email: '',
  firstName: '',
  lastName: '',
  company: '',
  phone: '',
  birthday: '',
  custom: {},
  listIds: [],
  tagIds: [],
}

export function draftOf(contact: Contact): ContactDraft {
  return {
    email: contact.email,
    firstName: contact.firstName ?? '',
    lastName: contact.lastName ?? '',
    company: contact.company ?? '',
    phone: contact.phone ?? '',
    birthday: contact.birthday ?? '',
    custom: { ...contact.custom },
    listIds: contact.lists.filter((membership) => membership.status !== 'unsubscribed').map((membership) => membership.listId),
    tagIds: contact.tags.map((tag) => tag.id),
  }
}

/** Order does not make two drafts different: the same lists picked in another order are the same lists. */
export function sameDraft(a: ContactDraft, b: ContactDraft): boolean {
  const flat = (draft: ContactDraft) =>
    JSON.stringify({
      ...draft,
      custom: Object.entries(draft.custom)
        .filter(([, value]) => value !== '')
        .sort(([one], [two]) => one.localeCompare(two)),
      listIds: [...draft.listIds].sort(),
      tagIds: [...draft.tagIds].sort(),
    })
  return flat(a) === flat(b)
}

/** The request body for a draft. A blank custom field is left out, not saved as "". */
export function draftBody(draft: ContactDraft) {
  return {
    ...draft,
    custom: Object.fromEntries(Object.entries(draft.custom).filter(([, value]) => value.trim() !== '')),
  }
}

/**
 * A birthday as month, day and an optional year, because that is how it is
 * known: plenty of people give the day and never the year. Stored as
 * YYYY-MM-DD, or --MM-DD without one. A month with no day is not a birthday
 * yet, and is saved as nothing.
 */
function BirthdayField({
  value,
  onChange,
  error,
  readOnly,
}: {
  value: string
  onChange: (value: string) => void
  error?: string
  readOnly?: boolean
}) {
  const id = useId()
  const [parts, setParts] = useState(() => splitBirthday(value))

  useEffect(() => {
    if (joinBirthday(parts) !== value) setParts(splitBirthday(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const change = (next: typeof parts) => {
    setParts(next)
    onChange(joinBirthday(next))
  }

  return (
    <Field label="Birthday" htmlFor={`${id}-month`} hint="The year is optional." error={error}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_6rem]">
        <div className="col-span-2 sm:col-span-1">
          <Select
            id={`${id}-month`}
            value={parts.month}
            onChange={(event) => change({ ...parts, month: event.target.value })}
            disabled={readOnly}
            aria-describedby={`${id}-month-hint`}
            options={[{ value: '', label: 'Month' }, ...MONTHS.map((month, index) => ({ value: String(index + 1), label: month }))]}
          />
        </div>
        <TextInput
          id={`${id}-day`}
          aria-label="Day"
          placeholder="Day"
          inputMode="numeric"
          maxLength={2}
          value={parts.day}
          onChange={(event) => change({ ...parts, day: event.target.value.replace(/\D/g, '') })}
          readOnly={readOnly}
        />
        <TextInput
          id={`${id}-year`}
          aria-label="Year"
          placeholder="Year"
          inputMode="numeric"
          maxLength={4}
          value={parts.year}
          onChange={(event) => change({ ...parts, year: event.target.value.replace(/\D/g, '') })}
          readOnly={readOnly}
        />
      </div>
    </Field>
  )
}

function splitBirthday(value: string) {
  const match = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return { month: '', day: '', year: '' }
  return { month: String(Number(match[2])), day: String(Number(match[3])), year: match[1] === '-' ? '' : match[1]! }
}

function joinBirthday(parts: { month: string; day: string; year: string }): string {
  const day = Number(parts.day)
  if (!parts.month || !(day >= 1 && day <= 31)) return ''
  const pad = (text: string | number) => String(text).padStart(2, '0')
  return `${/^\d{4}$/.test(parts.year) ? parts.year : '-'}-${pad(parts.month)}-${pad(day)}`
}

/** One custom field, as the control its type calls for. Every value is kept as text. */
function CustomFieldControl({
  field,
  value,
  onChange,
  error,
  readOnly,
}: {
  field: CustomField
  value: string
  onChange: (value: string) => void
  error?: string
  readOnly?: boolean
}) {
  const id = useId()
  if (field.type === 'select' || field.type === 'boolean') {
    const choices = field.type === 'boolean' ? ['Yes', 'No'] : field.options
    return (
      <Field label={field.label} htmlFor={id} error={error}>
        <Select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={readOnly}
          options={withCurrent([{ value: '', label: 'Not set' }, ...choices.map((choice) => ({ value: choice, label: choice }))], value, value)}
        />
      </Field>
    )
  }
  return (
    <Field label={field.label} error={error}>
      <TextInput
        type={field.type === 'date' ? 'date' : 'text'}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={readOnly}
      />
    </Field>
  )
}

/** Who the contact is. Other people's details, so the browser is told not to fill in the user's own. */
export function ProfileFields({
  draft,
  onChange,
  fields,
  errors = {},
  readOnly,
}: {
  draft: ContactDraft
  onChange: (draft: ContactDraft) => void
  /** The custom fields, each drawn as its type. */
  fields: readonly CustomField[]
  errors?: Record<string, string>
  readOnly?: boolean
}) {
  const text = (key: 'email' | 'firstName' | 'lastName' | 'company' | 'phone') => ({
    value: draft[key],
    onChange: (event: { target: { value: string } }) => onChange({ ...draft, [key]: event.target.value }),
    autoComplete: 'off',
    readOnly,
  })
  return (
    <>
      <Field label="Email address" error={errors.email}>
        <TextInput type="email" inputMode="email" spellCheck={false} {...text('email')} />
      </Field>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="First name" error={errors.firstName}>
          <TextInput {...text('firstName')} />
        </Field>
        <Field label="Last name" error={errors.lastName}>
          <TextInput {...text('lastName')} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Company" error={errors.company}>
          <TextInput {...text('company')} />
        </Field>
        <Field label="Phone" error={errors.phone}>
          <TextInput type="tel" inputMode="tel" {...text('phone')} />
        </Field>
      </div>
      <BirthdayField value={draft.birthday} onChange={(birthday) => onChange({ ...draft, birthday })} error={errors.birthday} readOnly={readOnly} />
      {fields.map((field) => (
        <CustomFieldControl
          key={field.id}
          field={field}
          value={draft.custom[field.key] ?? ''}
          onChange={(value) => onChange({ ...draft, custom: { ...draft.custom, [field.key]: value } })}
          error={errors[`custom.${field.key}`]}
          readOnly={readOnly}
        />
      ))}
    </>
  )
}

/** The lists a contact is on and the tags they carry. */
export function MembershipFields({
  draft,
  onChange,
  lists,
  tags,
  listHint,
  readOnly,
}: {
  draft: ContactDraft
  onChange: (draft: ContactDraft) => void
  lists: readonly ContactList[]
  tags: readonly Tag[]
  listHint?: ReactNode
  readOnly?: boolean
}) {
  return (
    <>
      <Field label="Lists" hint={listHint}>
        <MultiSelect
          options={lists.map((list) => ({ value: list.id, label: list.name, hint: formatNumber(list.subscribedCount) }))}
          value={draft.listIds}
          onChange={(listIds) => onChange({ ...draft, listIds })}
          placeholder={readOnly ? 'None' : 'Choose lists…'}
          emptyText={lists.length === 0 ? 'No lists yet' : 'No matches'}
          disabled={readOnly}
        />
      </Field>
      <Field label="Tags">
        <MultiSelect
          options={tags.map((tag) => ({ value: tag.id, label: tag.name, hint: formatNumber(tag.contactCount) }))}
          value={draft.tagIds}
          onChange={(tagIds) => onChange({ ...draft, tagIds })}
          placeholder={readOnly ? 'None' : 'Choose tags…'}
          emptyText={tags.length === 0 ? 'No tags yet' : 'No matches'}
          disabled={readOnly}
        />
      </Field>
    </>
  )
}
