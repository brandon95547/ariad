import { useEffect, useId, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Check, MoreHorizontal, Pencil, Plus, Tag as TagIcon, Trash2, Users } from 'lucide-react'
import { TAG_COLORS, type Tag } from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ApiError, api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatNumber, plural } from '@/lib/format'
import { keys, useInvalidate, useTags } from '@/lib/queries'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Controls'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { Banner, EmptyState } from '@/ui/Feedback'
import { TextInput } from '@/ui/Inputs'
import { ActionMenu } from '@/ui/Menu'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'
import { TabHeader, TagDot, contactKeys, rowLink, useCan } from './parts'

/** What each of TAG_COLORS is called, in the same order, so a swatch has a name and not only a hue. */
const COLOR_NAMES = ['Purple', 'Mint', 'Red', 'Gold', 'Green', 'Orange', 'Blue', 'Amber']

type Editor = { tag: Tag | null } | null

/**
 * Lists and segments › Tags. Labels you put on contacts yourself: a kind of
 * customer, where they came from. Unlike a list, nobody subscribes to a tag.
 */
export function TagsPage() {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const canEdit = useCan('editor')
  const tags = useTags()
  const [editor, setEditor] = useState<Editor>(null)
  const [removing, setRemoving] = useState<Tag | null>(null)

  const remove = useMutation({
    mutationFn: (tag: Tag) => api.delete(`/tags/${tag.id}`),
    onSuccess: (_result, tag) => {
      setRemoving(null)
      void invalidate(keys.tags, keys.segments, contactKeys.all)
      toast.success(`${tag.name} deleted`)
    },
  })

  const rows = tags.data ?? []

  const columns: Column<Tag>[] = [
    {
      key: 'name',
      header: 'Tag',
      cell: (tag) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <TagDot color={tag.color} className="h-2.5 w-2.5" />
          <Link to={`/contacts?tagId=${tag.id}`} className={cn(rowLink, 'truncate')}>
            {tag.name}
          </Link>
        </span>
      ),
    },
    { key: 'contacts', header: 'Contacts', align: 'right', cell: (tag) => <span data-tabular>{formatNumber(tag.contactCount)}</span> },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: <span className="sr-only-ds">Actions</span>,
            align: 'right' as const,
            width: '1%',
            cell: (tag: Tag) => (
              <ActionMenu
                label={`Actions for ${tag.name}`}
                icon={<MoreHorizontal size={16} />}
                actions={[
                  { id: 'edit', label: 'Rename or recolor', icon: <Pencil size={14} />, onSelect: () => setEditor({ tag }) },
                  { id: 'contacts', label: 'View contacts', icon: <Users size={14} />, onSelect: () => navigate(`/contacts?tagId=${tag.id}`) },
                  {
                    id: 'delete',
                    label: 'Delete',
                    icon: <Trash2 size={14} />,
                    onSelect: () => {
                      remove.reset()
                      setRemoving(tag)
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
        title="Tags"
        description="Labels you put on contacts yourself, such as what kind of customer they are. Nobody subscribes to a tag, and they never see it."
        action={
          canEdit && rows.length > 0 ? (
            <Button startIcon={<Plus />} onClick={() => setEditor({ tag: null })}>
              New tag
            </Button>
          ) : undefined
        }
      />

      {tags.isError && <Banner tone="danger">{errorMessage(tags.error)}</Banner>}

      {tags.isSuccess && rows.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={<TagIcon />}
            title="No tags yet"
            description={
              canEdit
                ? 'Tag contacts to tell them apart, then send to a tag or build a segment from one.'
                : 'An editor can make tags to tell contacts apart.'
            }
            action={
              canEdit ? (
                <Button startIcon={<Plus />} onClick={() => setEditor({ tag: null })}>
                  New tag
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        !tags.isError && (
          <Card padding="none" className="overflow-hidden">
            <DataTable aria-label="Tags" gutter="md" columns={columns} rows={rows} rowKey={(tag) => tag.id} loading={tags.isPending} skeletonRows={4} />
          </Card>
        )
      )}

      <TagDialog
        open={editor !== null}
        tag={editor?.tag ?? null}
        onClose={() => setEditor(null)}
        onSaved={(tag, created) => {
          setEditor(null)
          void invalidate(keys.tags, contactKeys.all)
          toast.success(created ? `${tag.name} created` : `${tag.name} saved`)
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title={`Delete ${removing?.name ?? 'tag'}?`}
        confirmLabel="Delete tag"
        loading={remove.isPending}
      >
        <p>
          {removing && removing.contactCount > 0
            ? `The tag comes off ${plural(removing.contactCount, 'contact')}. The contacts themselves are not deleted.`
            : 'No contact has this tag, so nobody is affected.'}{' '}
          Check any segment or automation that uses it afterward.
        </p>
        {remove.isError && <Banner tone="danger">{errorMessage(remove.error)}</Banner>}
      </ConfirmDialog>
    </div>
  )
}

function TagDialog({
  open,
  tag,
  onClose,
  onSaved,
}: {
  open: boolean
  /** The tag being edited, or null to make one. */
  tag: Tag | null
  onClose: () => void
  onSaved: (tag: Tag, created: boolean) => void
}) {
  const formId = useId()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(TAG_COLORS[0])

  const save = useMutation({
    mutationFn: () => (tag ? api.patch<Tag>(`/tags/${tag.id}`, { name, color }) : api.post<Tag>('/tags', { name, color })),
    onSuccess: (saved) => onSaved(saved, !tag),
  })

  useEffect(() => {
    if (!open) return
    setName(tag?.name ?? '')
    setColor(tag?.color ?? TAG_COLORS[0])
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tag?.id])

  const fields = save.error instanceof ApiError ? save.error.fields : {}
  // "There is already a tag called…" is about the name, so it is said at the name.
  const taken = save.error instanceof ApiError && save.error.status === 409 ? save.error.message : undefined
  const general = save.isError && !taken && Object.keys(fields).length === 0 ? errorMessage(save.error) : null

  // A color from before the palette, kept as a choice so that renaming a tag does not also recolor it.
  const known = TAG_COLORS.some((swatch) => swatch.toLowerCase() === color.toLowerCase())
  const swatches = [
    ...TAG_COLORS.map((swatch, index) => ({ value: swatch as string, name: COLOR_NAMES[index] ?? `Color ${index + 1}` })),
    ...(known ? [] : [{ value: color, name: 'Current color' }]),
  ]

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tag ? `Edit ${tag.name}` : 'New tag'}
      size="sm"
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {tag ? 'Save tag' : 'Create tag'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {general && <Banner tone="danger">{general}</Banner>}
        <Field label="Name" error={fields.name ?? taken}>
          <TextInput
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              // The answer was about the last name tried, not this one.
              if (save.isError) save.reset()
            }}
            placeholder="customer"
            maxLength={60}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span id={`${formId}-color`} className="text-label text-[var(--ds-fg-secondary)]">
            Color
          </span>
          <div role="radiogroup" aria-labelledby={`${formId}-color`} className="flex flex-wrap gap-2 coarse:gap-3">
            {swatches.map((swatch) => {
              const chosen = swatch.value.toLowerCase() === color.toLowerCase()
              return (
                <button
                  key={swatch.value}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  aria-label={swatch.name}
                  title={swatch.name}
                  onClick={() => setColor(swatch.value)}
                  style={{ backgroundColor: swatch.value }}
                  className={cn(
                    'touch-target touch-target--icon grid h-7 w-7 place-items-center rounded-full text-[var(--ds-fg-inverse)]',
                    'transition-shadow duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
                    // The tick is the state; the ring is so it can be found in a row of eight.
                    chosen && 'shadow-[0_0_0_2px_var(--ds-surface-overlay),0_0_0_4px_var(--ds-fg)]',
                  )}
                >
                  {chosen && <Check size={14} strokeWidth={3} aria-hidden />}
                </button>
              )
            })}
          </div>
        </div>
      </form>
    </Dialog>
  )
}
