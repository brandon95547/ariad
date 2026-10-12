import { useEffect, useId, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { MoreHorizontal, Pencil, Plus, TextCursorInput, Trash2 } from 'lucide-react'
import type { CustomField, CustomFieldType } from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ApiError, api, errorMessage } from '@/lib/api'
import { keys, useFields, useInvalidate } from '@/lib/queries'
import { Button } from '@/ui/Button'
import { Field, Select } from '@/ui/Controls'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { Banner, EmptyState } from '@/ui/Feedback'
import { TextInput, Textarea } from '@/ui/Inputs'
import { ActionMenu } from '@/ui/Menu'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'
import { TabHeader, contactKeys, useCan } from './parts'

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Yes or no',
  select: 'Choice from a list',
}
const TYPE_OPTIONS = (Object.keys(TYPE_LABELS) as CustomFieldType[]).map((value) => ({
  value,
  label: TYPE_LABELS[value],
}))

const mergeTag = (key: string) => `{{custom.${key}}}`

/** "Renewal date" → "renewal_date": lowercase letters, numbers and underscores, starting with a letter. */
function suggestKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 40)
}

type Editor = { field: CustomField | null } | null

/**
 * Lists and segments › Custom fields. The extra things you keep about each
 * contact, beyond name and email. Each one can be used in an email as a merge
 * tag and in a segment as a condition.
 */
export function FieldsPage() {
  const invalidate = useInvalidate()
  const canEdit = useCan('editor')
  const fields = useFields()
  const [editor, setEditor] = useState<Editor>(null)
  const [removing, setRemoving] = useState<CustomField | null>(null)

  const remove = useMutation({
    mutationFn: (field: CustomField) => api.delete(`/fields/${field.id}`),
    onSuccess: (_result, field) => {
      setRemoving(null)
      void invalidate(keys.fields, keys.segments, contactKeys.all)
      toast.success(`${field.label} deleted`)
    },
  })

  const rows = fields.data ?? []

  const columns: Column<CustomField>[] = [
    {
      key: 'label',
      header: 'Field',
      cell: (field) => <span className="text-label text-[var(--ds-fg)]">{field.label}</span>,
    },
    {
      key: 'tag',
      header: 'Merge tag',
      cell: (field) => (
        <code className="font-mono text-code text-[var(--ds-fg-secondary)] [overflow-wrap:anywhere]">
          {mergeTag(field.key)}
        </code>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      hideBelow: 'sm',
      className: 'whitespace-nowrap',
      cell: (field) => TYPE_LABELS[field.type],
    },
    {
      key: 'options',
      header: 'Options',
      hideBelow: 'md',
      cell: (field) => (field.type === 'select' ? field.options.join(', ') : null),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: <span className="sr-only-ds">Actions</span>,
            align: 'right' as const,
            width: '1%',
            cell: (field: CustomField) => (
              <ActionMenu
                label={`Actions for ${field.label}`}
                icon={<MoreHorizontal size={16} />}
                actions={[
                  {
                    id: 'edit',
                    label: 'Edit',
                    icon: <Pencil size={14} />,
                    onSelect: () => setEditor({ field }),
                  },
                  {
                    id: 'delete',
                    label: 'Delete',
                    icon: <Trash2 size={14} />,
                    onSelect: () => {
                      remove.reset()
                      setRemoving(field)
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
        title="Custom fields"
        description="The extra things you keep about each contact, beyond their name and email. Use one in an email as a merge tag, or in a segment as a condition."
        action={
          canEdit && rows.length > 0 ? (
            <Button startIcon={<Plus />} onClick={() => setEditor({ field: null })}>
              New field
            </Button>
          ) : undefined
        }
      />

      {fields.isError && <Banner tone="danger">{errorMessage(fields.error)}</Banner>}

      {fields.isSuccess && rows.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={<TextCursorInput />}
            title="No custom fields yet"
            description={
              canEdit
                ? 'Add a field for anything you want to keep about a contact: a plan, a renewal date, a city.'
                : 'An editor can add fields for anything else worth keeping about a contact.'
            }
            action={
              canEdit ? (
                <Button startIcon={<Plus />} onClick={() => setEditor({ field: null })}>
                  New field
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        !fields.isError && (
          <Card padding="none" className="overflow-hidden">
            <DataTable
              aria-label="Custom fields"
              gutter="md"
              columns={columns}
              rows={rows}
              rowKey={(field) => field.id}
              loading={fields.isPending}
              skeletonRows={3}
            />
          </Card>
        )
      )}

      <FieldDialog
        open={editor !== null}
        field={editor?.field ?? null}
        onClose={() => setEditor(null)}
        onSaved={(field, created) => {
          setEditor(null)
          void invalidate(keys.fields)
          toast.success(created ? `${field.label} created` : `${field.label} saved`)
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title={`Delete ${removing?.label ?? 'field'}?`}
        confirmLabel="Delete field"
        loading={remove.isPending}
      >
        <p>
          The field stops appearing on contacts and in imports. Emails that use{' '}
          {removing ? mergeTag(removing.key) : 'its merge tag'} will leave that spot blank, and a
          segment that uses it matches nobody until you edit it.
        </p>
        {remove.isError && <Banner tone="danger">{errorMessage(remove.error)}</Banner>}
      </ConfirmDialog>
    </div>
  )
}

function FieldDialog({
  open,
  field,
  onClose,
  onSaved,
}: {
  open: boolean
  /** The field being edited, or null to make one. */
  field: CustomField | null
  onClose: () => void
  onSaved: (field: CustomField, created: boolean) => void
}) {
  const formId = useId()
  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')
  /** Once the key has been typed by hand it stops following the label. */
  const [keyTyped, setKeyTyped] = useState(false)
  const [type, setType] = useState<CustomFieldType>('text')
  const [options, setOptions] = useState('')
  const [noOptions, setNoOptions] = useState(false)

  const optionList = options
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const save = useMutation({
    mutationFn: () => {
      const body = { label, type, options: type === 'select' ? optionList : [] }
      return field
        ? api.patch<CustomField>(`/fields/${field.id}`, body)
        : api.post<CustomField>('/fields', { ...body, key })
    },
    onSuccess: (saved) => onSaved(saved, !field),
  })

  useEffect(() => {
    if (!open) return
    setLabel(field?.label ?? '')
    setKey(field?.key ?? '')
    setKeyTyped(false)
    setType(field?.type ?? 'text')
    setOptions(field?.options.join('\n') ?? '')
    setNoOptions(false)
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, field?.id])

  const errors = save.error instanceof ApiError ? save.error.fields : {}
  // "There is already a field with the key…" is about the key, so it is said at the key.
  const taken =
    save.error instanceof ApiError && save.error.status === 409 ? save.error.message : undefined
  const general =
    save.isError && !taken && Object.keys(errors).length === 0 ? errorMessage(save.error) : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (type === 'select' && optionList.length === 0) {
      setNoOptions(true)
      return
    }
    save.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={field ? `Edit ${field.label}` : 'New custom field'}
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {field ? 'Save field' : 'Create field'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {general && <Banner tone="danger">{general}</Banner>}
        <Field
          label="Label"
          hint="What the field is called on a contact and in the import."
          error={errors.label}
        >
          <TextInput
            value={label}
            onChange={(event) => {
              setLabel(event.target.value)
              if (!field && !keyTyped) setKey(suggestKey(event.target.value))
              if (save.isError) save.reset()
            }}
            placeholder="Renewal date"
          />
        </Field>
        <Field
          label="Key"
          hint={
            field ? (
              <>
                Used in emails as <code className="font-mono text-code">{mergeTag(field.key)}</code>
                . The key cannot change once the field exists.
              </>
            ) : (
              <>
                Used in emails as{' '}
                <code className="font-mono text-code">{mergeTag(key || 'key')}</code>. It cannot be
                changed later.
              </>
            )
          }
          error={errors.key ?? taken}
        >
          <TextInput
            value={key}
            onChange={(event) => {
              setKey(event.target.value)
              setKeyTyped(true)
              // The answer was about the last key tried, not this one.
              if (save.isError) save.reset()
            }}
            readOnly={Boolean(field)}
            spellCheck={false}
            autoCapitalize="none"
            className="font-mono"
          />
        </Field>
        <Field
          label="Type"
          htmlFor={`${formId}-type`}
          hint={
            field && type !== field.type
              ? 'What is already saved for each contact stays as it was typed.'
              : undefined
          }
          error={errors.type}
        >
          <Select
            id={`${formId}-type`}
            value={type}
            onChange={(event) => setType(event.target.value as CustomFieldType)}
            options={TYPE_OPTIONS}
          />
        </Field>
        {type === 'select' && (
          <Field
            label="Options"
            hint="One per line."
            error={
              noOptions && optionList.length === 0
                ? 'Add at least one option to choose from.'
                : errors.options
            }
          >
            <Textarea
              rows={4}
              value={options}
              onChange={(event) => setOptions(event.target.value)}
              placeholder={'Free\nPro\nTeam'}
            />
          </Field>
        )}
      </form>
    </Dialog>
  )
}
