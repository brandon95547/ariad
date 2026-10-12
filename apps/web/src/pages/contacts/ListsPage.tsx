import { useEffect, useId, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { List as ListIcon, MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react'
import type { ContactList } from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ApiError, api, errorMessage } from '@/lib/api'
import { formatNumber, plural } from '@/lib/format'
import { keys, useInvalidate, useLists, useSettings } from '@/lib/queries'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Field, Switch } from '@/ui/Controls'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { Banner, EmptyState } from '@/ui/Feedback'
import { TextInput, Textarea } from '@/ui/Inputs'
import { ActionMenu } from '@/ui/Menu'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'
import { TabHeader, contactKeys, rowLink, useCan } from './parts'

type Editor = { list: ContactList | null } | null

/**
 * Lists and segments › Lists. The groups people subscribe to. A campaign goes
 * to lists, and a person can leave one list without leaving the rest.
 */
export function ListsPage() {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const canEdit = useCan('editor')
  const lists = useLists()
  const [editor, setEditor] = useState<Editor>(null)
  const [removing, setRemoving] = useState<ContactList | null>(null)

  const remove = useMutation({
    mutationFn: (list: ContactList) => api.delete(`/lists/${list.id}`),
    onSuccess: (_result, list) => {
      setRemoving(null)
      void invalidate(keys.lists, keys.segments, contactKeys.all)
      toast.success(`${list.name} deleted`)
    },
  })

  const rows = lists.data ?? []
  const count = (value: number) => <span data-tabular>{formatNumber(value)}</span>

  const columns: Column<ContactList>[] = [
    {
      key: 'name',
      header: 'List',
      cell: (list) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link to={`/contacts?listId=${list.id}`} className={`${rowLink} self-start`}>
            {list.name}
          </Link>
          {list.description && (
            <span className="text-caption text-[var(--ds-fg-muted)]">{list.description}</span>
          )}
        </div>
      ),
    },
    {
      key: 'subscribed',
      header: 'Subscribed',
      align: 'right',
      cell: (list) => count(list.subscribedCount),
    },
    {
      key: 'pending',
      header: 'Pending',
      align: 'right',
      hideBelow: 'sm',
      cell: (list) => count(list.pendingCount),
    },
    {
      key: 'unsubscribed',
      header: 'Unsubscribed',
      align: 'right',
      hideBelow: 'md',
      cell: (list) => count(list.unsubscribedCount),
    },
    {
      key: 'signup',
      header: 'Signing up',
      hideBelow: 'lg',
      cell: (list) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {list.doubleOptIn && <Badge tone="accent">Double opt-in</Badge>}
          {list.isPublic && <Badge>On preferences page</Badge>}
        </div>
      ),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: <span className="sr-only-ds">Actions</span>,
            align: 'right' as const,
            width: '1%',
            cell: (list: ContactList) => (
              <ActionMenu
                label={`Actions for ${list.name}`}
                icon={<MoreHorizontal size={16} />}
                actions={[
                  {
                    id: 'edit',
                    label: 'Edit',
                    icon: <Pencil size={14} />,
                    onSelect: () => setEditor({ list }),
                  },
                  {
                    id: 'contacts',
                    label: 'View contacts',
                    icon: <Users size={14} />,
                    onSelect: () => navigate(`/contacts?listId=${list.id}`),
                  },
                  {
                    id: 'delete',
                    label: 'Delete',
                    icon: <Trash2 size={14} />,
                    onSelect: () => {
                      remove.reset()
                      setRemoving(list)
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
        title="Lists"
        description="The groups people subscribe to. Campaigns are sent to lists, and someone can leave one list and stay on the others."
        action={
          canEdit && rows.length > 0 ? (
            <Button startIcon={<Plus />} onClick={() => setEditor({ list: null })}>
              New list
            </Button>
          ) : undefined
        }
      />

      {lists.isError && <Banner tone="danger">{errorMessage(lists.error)}</Banner>}

      {lists.isSuccess && rows.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={<ListIcon />}
            title="No lists yet"
            description={
              canEdit
                ? 'A list is who a campaign goes to. Most people start with one, such as Newsletter.'
                : 'An editor needs to make a list before a campaign can be sent to one.'
            }
            action={
              canEdit ? (
                <Button startIcon={<Plus />} onClick={() => setEditor({ list: null })}>
                  New list
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        !lists.isError && (
          <Card padding="none" className="overflow-hidden">
            <DataTable
              aria-label="Lists"
              gutter="md"
              columns={columns}
              rows={rows}
              rowKey={(list) => list.id}
              loading={lists.isPending}
              skeletonRows={3}
            />
          </Card>
        )
      )}

      <ListDialog
        open={editor !== null}
        list={editor?.list ?? null}
        onClose={() => setEditor(null)}
        onSaved={(list, created) => {
          setEditor(null)
          void invalidate(keys.lists)
          toast.success(created ? `${list.name} created` : `${list.name} saved`)
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title={`Delete ${removing?.name ?? 'list'}?`}
        confirmLabel="Delete list"
        loading={remove.isPending}
      >
        <p>
          {removing && removing.subscribedCount + removing.pendingCount > 0
            ? `The ${plural(removing.subscribedCount + removing.pendingCount, 'person', 'people')} on it stay in your contacts and on their other lists. Only this grouping goes.`
            : 'Nobody is on this list. Your contacts are not affected.'}{' '}
          Campaigns already sent to it keep their history. Check any signup form, segment or
          automation that uses it afterward.
        </p>
        {remove.isError && <Banner tone="danger">{errorMessage(remove.error)}</Banner>}
      </ConfirmDialog>
    </div>
  )
}

function ListDialog({
  open,
  list,
  onClose,
  onSaved,
}: {
  open: boolean
  /** The list being edited, or null to make one. */
  list: ContactList | null
  onClose: () => void
  onSaved: (list: ContactList, created: boolean) => void
}) {
  const formId = useId()
  const settings = useSettings()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [doubleOptIn, setDoubleOptIn] = useState(false)
  const [isPublic, setIsPublic] = useState(true)

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, doubleOptIn, isPublic }
      return list
        ? api.patch<ContactList>(`/lists/${list.id}`, body)
        : api.post<ContactList>('/lists', body)
    },
    onSuccess: (saved) => onSaved(saved, !list),
  })

  useEffect(() => {
    if (!open) return
    setName(list?.name ?? '')
    setDescription(list?.description ?? '')
    setDoubleOptIn(
      list ? list.doubleOptIn : (settings.data?.compliance.doubleOptInDefault ?? false),
    )
    setIsPublic(list ? list.isPublic : true)
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, list?.id])

  const fields = save.error instanceof ApiError ? save.error.fields : {}
  const general = save.isError && Object.keys(fields).length === 0 ? errorMessage(save.error) : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={list ? `Edit ${list.name}` : 'New list'}
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {list ? 'Save list' : 'Create list'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {general && <Banner tone="danger">{general}</Banner>}
        <Field
          label="Name"
          hint="Subscribers see this on the preferences page."
          error={fields.name}
        >
          <TextInput
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (save.isError) save.reset()
            }}
            placeholder="Newsletter"
          />
        </Field>
        <Field
          label="Description"
          optional
          hint="What people on this list get, in a sentence."
          error={fields.description}
        >
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Switch
          label="Double opt-in"
          description="New subscribers get an email asking them to confirm, and join only when they do. It keeps typos and bots off the list."
          checked={doubleOptIn}
          onChange={setDoubleOptIn}
        />
        <Switch
          label="Show on the preferences page"
          description="People can join or leave this list themselves, from the link at the bottom of your emails."
          checked={isPublic}
          onChange={setIsPublic}
        />
      </form>
    </Dialog>
  )
}
