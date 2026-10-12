import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Filter, MoreHorizontal, Pencil, Plus, Trash2, Users, X } from 'lucide-react'
import {
  CONTACT_STATUSES,
  CONTACT_STATUS_LABELS,
  MONTHS,
  SEGMENT_FIELDS,
  SEGMENT_OPERATORS,
  type Contact,
  type ContactList,
  type CustomField,
  type Segment,
  type SegmentFieldType,
  type SegmentOperator,
  type Tag,
} from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ApiError, api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { contactName, formatNumber, formatRelative, plural } from '@/lib/format'
import { keys, useFields, useInvalidate, useLists, useSegments, useTags } from '@/lib/queries'
import { Button, IconButton } from '@/ui/Button'
import { Combobox, Field, SegmentedControl, Select, type ComboboxOption, type SelectOption } from '@/ui/Controls'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { Banner, EmptyState, Spinner } from '@/ui/Feedback'
import { TextInput, Textarea } from '@/ui/Inputs'
import { ActionMenu } from '@/ui/Menu'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'
import { StatusBadge, TabHeader, rowLink, useCan, useDebounced, withCurrent } from './parts'

/** A condition being edited. The value is kept as text whatever it will be read as. */
interface RuleDraft {
  id: number
  field: string
  op: string
  value: string
}

/** A field a condition can be about: a built-in one, or a custom field under `custom.<key>`. */
interface FieldChoice {
  key: string
  label: string
  type: SegmentFieldType
  group: string
  /** The choices of a custom field that has them, offered in place of typing one. */
  choices?: string[]
}

/** Which conditions a custom field takes: a choice or a yes/no is compared as the text it is stored as. */
const CUSTOM_TYPE: Record<CustomField['type'], SegmentFieldType> = {
  text: 'text',
  number: 'number',
  date: 'date',
  select: 'text',
  boolean: 'text',
}

function fieldChoices(custom: readonly CustomField[]): FieldChoice[] {
  return [
    ...SEGMENT_FIELDS.map((field) => ({ key: field.key, label: field.label, type: field.type, group: field.group as string })),
    ...custom.map((field) => ({
      key: `custom.${field.key}`,
      label: field.label,
      type: CUSTOM_TYPE[field.type],
      group: 'Custom fields',
      choices: field.type === 'select' ? field.options : field.type === 'boolean' ? ['Yes', 'No'] : undefined,
    })),
  ]
}

const operatorOf = (choice: FieldChoice | undefined, op: string): SegmentOperator | undefined =>
  choice ? SEGMENT_OPERATORS[choice.type].find((operator) => operator.key === op) : undefined

/** Whether a condition says enough to be counted: a known field, one of its operators, and a value where one is called for. */
function complete(rule: RuleDraft, choices: readonly FieldChoice[]): boolean {
  const operator = operatorOf(
    choices.find((choice) => choice.key === rule.field),
    rule.op,
  )
  return Boolean(operator) && (operator!.value === 'none' || rule.value.trim() !== '')
}

const toRules = (rules: readonly RuleDraft[], choices: readonly FieldChoice[]) =>
  rules.map((rule) => {
    const operator = operatorOf(
      choices.find((choice) => choice.key === rule.field),
      rule.op,
    )
    return { field: rule.field, op: rule.op, value: operator?.value === 'none' ? null : rule.value.trim() }
  })

type Editor = { segment: Segment | null } | null

/**
 * Lists and segments › Segments. A segment is a saved question about your
 * contacts, answered fresh each time it is used: nobody is put in one, they
 * match it or they do not.
 */
export function SegmentsPage() {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const canEdit = useCan('editor')
  const segments = useSegments()
  const [editor, setEditor] = useState<Editor>(null)
  const [removing, setRemoving] = useState<Segment | null>(null)

  const remove = useMutation({
    mutationFn: (segment: Segment) => api.delete(`/segments/${segment.id}`),
    onSuccess: (_result, segment) => {
      setRemoving(null)
      void invalidate(keys.segments)
      toast.success(`${segment.name} deleted`)
    },
  })

  const rows = segments.data ?? []

  const columns: Column<Segment>[] = [
    {
      key: 'name',
      header: 'Segment',
      cell: (segment) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link to={`/contacts?segmentId=${segment.id}`} className={`${rowLink} self-start`}>
            {segment.name}
          </Link>
          {segment.description && <span className="text-caption text-[var(--ds-fg-muted)]">{segment.description}</span>}
        </div>
      ),
    },
    {
      key: 'rules',
      header: 'Matches',
      hideBelow: 'md',
      className: 'whitespace-nowrap',
      cell: (segment) =>
        segment.rules.length === 1 ? '1 condition' : `${segment.match === 'all' ? 'All' : 'Any'} of ${formatNumber(segment.rules.length)} conditions`,
    },
    { key: 'contacts', header: 'Contacts', align: 'right', cell: (segment) => <span data-tabular>{formatNumber(segment.contactCount)}</span> },
    { key: 'updated', header: 'Changed', hideBelow: 'sm', className: 'whitespace-nowrap', cell: (segment) => formatRelative(segment.updatedAt) },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: <span className="sr-only-ds">Actions</span>,
            align: 'right' as const,
            width: '1%',
            cell: (segment: Segment) => (
              <ActionMenu
                label={`Actions for ${segment.name}`}
                icon={<MoreHorizontal size={16} />}
                actions={[
                  { id: 'edit', label: 'Edit', icon: <Pencil size={14} />, onSelect: () => setEditor({ segment }) },
                  { id: 'contacts', label: 'View contacts', icon: <Users size={14} />, onSelect: () => navigate(`/contacts?segmentId=${segment.id}`) },
                  {
                    id: 'delete',
                    label: 'Delete',
                    icon: <Trash2 size={14} />,
                    onSelect: () => {
                      remove.reset()
                      setRemoving(segment)
                    },
                    danger: true,
                    separated: true,
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <TabHeader
        title="Segments"
        description="A saved question about your contacts, answered fresh each time it is used. Nobody is put in a segment: they match it or they do not."
        action={
          canEdit && rows.length > 0 ? (
            <Button startIcon={<Plus />} onClick={() => setEditor({ segment: null })}>
              New segment
            </Button>
          ) : undefined
        }
      />

      {segments.isError && <Banner tone="danger">{errorMessage(segments.error)}</Banner>}

      {segments.isSuccess && rows.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={<Filter />}
            title="No segments yet"
            description={
              canEdit
                ? 'Build one from what you know about people: a tag, when they joined, whether they opened your last email.'
                : 'An editor can build segments from what is known about each contact.'
            }
            action={
              canEdit ? (
                <Button startIcon={<Plus />} onClick={() => setEditor({ segment: null })}>
                  New segment
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        !segments.isError && (
          <Card padding="none" className="overflow-hidden">
            <DataTable
              aria-label="Segments"
              gutter="md"
              columns={columns}
              rows={rows}
              rowKey={(segment) => segment.id}
              loading={segments.isPending}
              skeletonRows={3}
            />
          </Card>
        )
      )}

      <SegmentDialog
        open={editor !== null}
        segment={editor?.segment ?? null}
        onClose={() => setEditor(null)}
        onSaved={(segment, created) => {
          setEditor(null)
          void invalidate(keys.segments)
          toast.success(created ? `${segment.name} created` : `${segment.name} saved`, {
            description: `${plural(segment.contactCount, 'contact')} ${segment.contactCount === 1 ? 'matches' : 'match'} right now`,
          })
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title={`Delete ${removing?.name ?? 'segment'}?`}
        confirmLabel="Delete segment"
        loading={remove.isPending}
      >
        <p>Only the saved question goes. The contacts who match it are not touched. Check any campaign or automation set to use it afterward.</p>
        {remove.isError && <Banner tone="danger">{errorMessage(remove.error)}</Banner>}
      </ConfirmDialog>
    </div>
  )
}

/**
 * The segment builder. Conditions are rows of field, comparison and value, and
 * under them the number of contacts who match as it stands, counted by the
 * server each time the conditions settle.
 */
function SegmentDialog({
  open,
  segment,
  onClose,
  onSaved,
}: {
  open: boolean
  /** The segment being edited, or null to build one. */
  segment: Segment | null
  onClose: () => void
  onSaved: (segment: Segment, created: boolean) => void
}) {
  const formId = useId()
  const nextId = useRef(1)
  const lists = useLists()
  const tags = useTags()
  const fields = useFields()
  const choices = useMemo(() => fieldChoices(fields.data ?? []), [fields.data])

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [match, setMatch] = useState<'all' | 'any'>('all')
  const [rules, setRules] = useState<RuleDraft[]>([])
  /** Set by a save that found a condition unfinished, so the unfinished ones are pointed out. */
  const [checked, setChecked] = useState(false)

  const blank = (): RuleDraft => ({ id: nextId.current++, field: 'email', op: 'contains', value: '' })

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, match, rules: toRules(rules, choices) }
      return segment ? api.patch<Segment>(`/segments/${segment.id}`, body) : api.post<Segment>('/segments', body)
    },
    onSuccess: (saved) => onSaved(saved, !segment),
  })

  useEffect(() => {
    if (!open) return
    setName(segment?.name ?? '')
    setDescription(segment?.description ?? '')
    setMatch(segment?.match ?? 'all')
    setRules(
      segment && segment.rules.length > 0
        ? segment.rules.map((rule) => ({ id: nextId.current++, field: rule.field, op: rule.op, value: rule.value === null || rule.value === undefined ? '' : String(rule.value) }))
        : [blank()],
    )
    setChecked(false)
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, segment?.id])

  const ready = rules.length > 0 && rules.every((rule) => complete(rule, choices))
  const definition = useDebounced(ready ? JSON.stringify({ match, rules: toRules(rules, choices) }) : '', 400)
  const preview = useQuery({
    queryKey: ['segments', 'preview', definition],
    queryFn: () => api.post<{ count: number; sample: Contact[] }>('/segments/preview', JSON.parse(definition)),
    enabled: open && definition !== '',
    placeholderData: keepPreviousData,
  })

  const setRule = (id: number, changes: Partial<RuleDraft>) =>
    setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...changes } : rule)))

  const errors = save.error instanceof ApiError ? save.error.fields : {}
  const general = save.isError && !errors.name && !errors.description ? errorMessage(save.error) : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!ready) {
      setChecked(true)
      return
    }
    save.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={segment ? `Edit ${segment.name}` : 'New segment'}
      size="lg"
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {segment ? 'Save segment' : 'Create segment'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {general && <Banner tone="danger">{general}</Banner>}
        <Field label="Name" error={errors.name}>
          <TextInput
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (save.isError) save.reset()
            }}
            placeholder="Customers who opened last month"
          />
        </Field>
        <Field label="Description" optional error={errors.description}>
          <Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>

        <div className="flex flex-col gap-4 border-t border-[var(--ds-border-subtle)] pt-5">
          <h3 className="text-overline text-[var(--ds-fg-muted)] uppercase">Conditions</h3>
          {rules.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-label text-[var(--ds-fg-secondary)]">A contact matches when</span>
              <SegmentedControl
                label="A contact matches when"
                value={match}
                onChange={setMatch}
                className="sm:max-w-[26rem]"
                options={[
                  { value: 'all', label: 'Every condition is true' },
                  { value: 'any', label: 'Any condition is true' },
                ]}
              />
            </div>
          )}

          <ul className="flex flex-col gap-3 sm:gap-2">
            {rules.map((rule, index) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                index={index}
                choices={choices}
                lists={lists.data ?? []}
                tags={tags.data ?? []}
                flagged={checked && !complete(rule, choices)}
                onChange={(changes) => {
                  setRule(rule.id, changes)
                  if (save.isError) save.reset()
                }}
                onRemove={rules.length > 1 ? () => setRules((current) => current.filter((one) => one.id !== rule.id)) : undefined}
              />
            ))}
          </ul>

          <Button
            variant="outlined"
            size="sm"
            startIcon={<Plus />}
            className="self-start"
            onClick={() => setRules((current) => [...current, blank()])}
            disabled={rules.length >= 30}
          >
            Add a condition
          </Button>
          {checked && !ready && (
            <p role="alert" className="text-caption text-[var(--ds-danger-text)]">
              Finish the conditions marked above, or remove them, before saving.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-[var(--ds-border-subtle)] pt-5" aria-live="polite">
          {!ready ? (
            <p className="text-body-sm text-[var(--ds-fg-muted)]">Finish the conditions to see who matches.</p>
          ) : preview.isError ? (
            <Banner tone="danger">{errorMessage(preview.error)}</Banner>
          ) : !preview.data ? (
            <p className="flex items-center gap-2 text-body-sm text-[var(--ds-fg-muted)]">
              <Spinner size={14} label="Counting" /> Counting who matches…
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <p className="flex flex-wrap items-center gap-x-2 text-h4 text-[var(--ds-fg)]">
                  <span data-tabular>
                    {plural(preview.data.count, 'contact')} {preview.data.count === 1 ? 'matches' : 'match'}
                  </span>
                  {(preview.isFetching || definition === '') && <Spinner size={14} label="Counting again" />}
                </p>
                <p className="text-caption text-[var(--ds-fg-muted)]">Everyone who fits is counted, subscribed or not. Only subscribed contacts are ever emailed.</p>
              </div>
              {preview.data.sample.length > 0 && (
                <ul className="flex flex-col">
                  {preview.data.sample.map((contact) => (
                    <li
                      key={contact.id}
                      className="flex min-w-0 items-center justify-between gap-3 border-t border-[var(--ds-border-subtle)] py-2 first:border-t-0 first:pt-0 last:pb-0"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-label text-[var(--ds-fg)]">{contactName(contact)}</span>
                        {contactName(contact) !== contact.email && <span className="truncate text-caption text-[var(--ds-fg-muted)]">{contact.email}</span>}
                      </span>
                      <StatusBadge status={contact.status} size="sm" />
                    </li>
                  ))}
                  {preview.data.count > preview.data.sample.length && (
                    <li className="border-t border-[var(--ds-border-subtle)] pt-2 text-caption text-[var(--ds-fg-muted)]">
                      and {formatNumber(preview.data.count - preview.data.sample.length)} more
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
        </div>
      </form>
    </Dialog>
  )
}

/** One condition: what it is about, how it is compared, and what with. */
function RuleRow({
  rule,
  index,
  choices,
  lists,
  tags,
  flagged,
  onChange,
  onRemove,
}: {
  rule: RuleDraft
  index: number
  choices: readonly FieldChoice[]
  lists: readonly ContactList[]
  tags: readonly Tag[]
  /** Pointed out as unfinished after a save was tried. */
  flagged: boolean
  onChange: (changes: Partial<RuleDraft>) => void
  /** Left out for the only condition: a segment has at least one. */
  onRemove?: () => void
}) {
  const choice = choices.find((one) => one.key === rule.field)
  const operators = choice ? SEGMENT_OPERATORS[choice.type] : []
  const operator = operators.find((one) => one.key === rule.op)
  const kind = operator?.value ?? 'none'
  const number = index + 1

  const fieldOptions: ComboboxOption[] = choices.map((one) => ({ value: one.key, label: one.label, group: one.group }))

  const chooseField = (key: string) => {
    const next = choices.find((one) => one.key === key)
    if (!next) return
    // The comparison and the value belong to the kind of field, so a new field starts both again.
    onChange({ field: key, op: SEGMENT_OPERATORS[next.type][0]?.key ?? '', value: '' })
  }
  const chooseOperator = (key: string) => {
    const next = operators.find((one) => one.key === key)
    onChange({ op: key, value: next && next.value === kind ? rule.value : '' })
  }
  const setValue = (value: string) => onChange({ value })

  const pick = (label: string, placeholder: string, options: SelectOption[], gone: string) => (
    <Select
      aria-label={label}
      value={rule.value}
      onChange={(event) => setValue(event.target.value)}
      options={withCurrent([{ value: '', label: placeholder }, ...options], rule.value, gone)}
    />
  )

  const valueLabel = `Value for condition ${number}`
  let control = null
  if (kind === 'status') {
    control = pick(valueLabel, 'Choose a status', CONTACT_STATUSES.map((status) => ({ value: status, label: CONTACT_STATUS_LABELS[status] })), rule.value)
  } else if (kind === 'tag') {
    control = pick(valueLabel, 'Choose a tag', tags.map((tag) => ({ value: tag.id, label: tag.name })), 'A deleted tag')
  } else if (kind === 'list') {
    control = pick(valueLabel, 'Choose a list', lists.map((list) => ({ value: list.id, label: list.name })), 'A deleted list')
  } else if (kind === 'month') {
    control = pick(valueLabel, 'Choose a month', MONTHS.map((month, at) => ({ value: String(at + 1), label: month })), rule.value)
  } else if (kind === 'text' && choice?.choices && (rule.op === 'is' || rule.op === 'is_not')) {
    control = pick(valueLabel, 'Choose one', choice.choices.map((option) => ({ value: option, label: option })), rule.value)
  } else if (kind === 'days') {
    control = (
      <TextInput
        aria-label={`Number of days for condition ${number}`}
        inputMode="numeric"
        value={rule.value}
        onChange={(event) => setValue(event.target.value.replace(/\D/g, ''))}
        endAdornment={<span className="text-body-sm">days</span>}
        invalid={flagged}
      />
    )
  } else if (kind === 'number' || kind === 'date' || kind === 'text') {
    control = (
      <TextInput
        aria-label={valueLabel}
        type={kind === 'date' ? 'date' : 'text'}
        inputMode={kind === 'number' ? 'decimal' : undefined}
        value={rule.value}
        onChange={(event) => setValue(event.target.value)}
        invalid={flagged}
      />
    )
  }

  return (
    <li
      className={cn(
        // On a phone the controls stack, with the way to remove the condition beside its first line, and the frame
        // is what keeps them one condition. Side by side they are a row, and need none.
        'grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-[var(--radius-lg)] border border-[var(--ds-border-subtle)] p-3',
        'sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto] sm:items-start sm:rounded-none sm:border-0 sm:p-0',
      )}
    >
      <div className={cn('min-w-0 sm:col-span-1', !onRemove && 'col-span-2')}>
        <Combobox aria-label={`Field for condition ${number}`} options={fieldOptions} value={choice ? rule.field : ''} onChange={chooseField} />
      </div>
      <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <Select
          aria-label={`Comparison for condition ${number}`}
          value={operator ? rule.op : ''}
          onChange={(event) => chooseOperator(event.target.value)}
          disabled={!choice}
          // With nothing chosen the list says so, in place of showing its first comparison as if it had been picked.
          options={[...(operator ? [] : [{ value: '', label: 'Choose…' }]), ...operators.map((one) => ({ value: one.key, label: one.label }))]}
        />
      </div>
      {/* Nothing to show for "is blank" on a phone; side by side, the column is held. */}
      <div className={cn('col-span-2 min-w-0 sm:col-span-1 sm:col-start-3 sm:row-start-1', !control && 'hidden sm:block')}>{control}</div>
      {onRemove ? (
        <IconButton label={`Remove condition ${number}`} icon={<X />} size="md" onClick={onRemove} className="col-start-2 row-start-1 sm:col-start-4" />
      ) : (
        // Holds the column, so one condition lines up with the many it may become.
        <span aria-hidden className="hidden w-9 sm:col-start-4 sm:row-start-1 sm:block" />
      )}
      {!choice ? (
        <p role="alert" className="col-span-2 text-caption text-[var(--ds-danger-text)] sm:col-span-4">
          This condition is about a field that no longer exists. Choose another field, or remove the condition.
        </p>
      ) : (
        flagged && (
          <p role="alert" className="col-span-2 text-caption text-[var(--ds-danger-text)] sm:col-span-4">
            {operator ? 'This condition needs a value.' : 'Choose how to compare.'}
          </p>
        )
      )}
    </li>
  )
}
