import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ClipboardList,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { roleAtLeast, type SignupForm } from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ApiError, api, errorMessage } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import { useAuthState, useLists, useSettings } from '@/lib/queries'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Controls'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback'
import { Checkbox, TextInput } from '@/ui/Inputs'
import { ActionMenu } from '@/ui/Menu'
import { Page, PageHeader } from '@/ui/Shell'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'
import { formKeys } from './formKeys'

/**
 * Signup forms. Each is a hosted page and an embed for another site, where
 * people add themselves to one or more lists. Making one takes a name and a
 * list; everything else is set in its editor.
 */
export function FormsPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const canEdit = roleAtLeast(useAuthState().data?.user?.role ?? 'viewer', 'editor')
  const forms = useQuery({ queryKey: formKeys.all, queryFn: () => api.get<SignupForm[]>('/forms') })
  const lists = useLists()
  const settings = useSettings()

  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<SignupForm | null>(null)

  const remove = useMutation({
    mutationFn: (form: SignupForm) => api.delete(`/forms/${form.id}`),
    onSuccess: (_result, form) => {
      setRemoving(null)
      void client.invalidateQueries({ queryKey: formKeys.all })
      toast.success(`${form.name} deleted`)
    },
  })

  const listNames = useMemo(
    () => new Map((lists.data ?? []).map((list) => [list.id, list.name])),
    [lists.data],
  )
  const rows = forms.data ?? []
  const publicUrl = settings.data?.effectivePublicUrl ?? window.location.origin

  const columns: Column<SignupForm>[] = [
    {
      key: 'name',
      header: 'Form',
      className: 'w-full max-w-0 min-w-32',
      cell: (form) => (
        <div className="flex min-w-0 flex-col">
          <Link
            to={`/forms/${form.id}`}
            className="truncate rounded-[var(--radius-xs)] text-label text-[var(--ds-fg)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]"
          >
            {form.name}
          </Link>
          <span className="truncate text-caption text-[var(--ds-fg-muted)]">{form.title}</span>
        </div>
      ),
    },
    {
      key: 'lists',
      header: 'Adds people to',
      hideBelow: 'md',
      cell: (form) => {
        const names = form.listIds
          .map((id) => listNames.get(id))
          .filter((name): name is string => Boolean(name))
        if (names.length === 0)
          return (
            <span className="text-[var(--ds-fg-muted)]">{lists.isPending ? '' : 'No list'}</span>
          )
        return (
          <span className="line-clamp-2">
            {names.slice(0, 2).join(', ')}
            {names.length > 2 ? ` and ${names.length - 2} more` : ''}
          </span>
        )
      },
    },
    {
      key: 'optin',
      header: 'Confirmation',
      hideBelow: 'lg',
      cell: (form) =>
        form.doubleOptIn ? (
          <Badge tone="accent">Double opt-in</Badge>
        ) : (
          <Badge tone="neutral">Single opt-in</Badge>
        ),
    },
    {
      key: 'enabled',
      header: 'Status',
      cell: (form) =>
        form.enabled ? (
          <Badge tone="success" dot>
            On
          </Badge>
        ) : (
          <Badge tone="neutral">Off</Badge>
        ),
    },
    {
      key: 'submissions',
      header: 'Signups',
      align: 'right',
      cell: (form) => formatNumber(form.submissions),
    },
    {
      key: 'created',
      header: 'Created',
      hideBelow: 'md',
      className: 'whitespace-nowrap',
      cell: (form) => formatDate(form.createdAt),
    },
    {
      key: 'actions',
      header: <span className="sr-only-ds">Actions</span>,
      align: 'right',
      width: '1%',
      cell: (form) => (
        <ActionMenu
          label={`Actions for ${form.name}`}
          icon={<MoreHorizontal size={16} />}
          actions={[
            {
              id: 'edit',
              label: canEdit ? 'Edit' : 'Open',
              icon: <Pencil size={14} />,
              onSelect: () => navigate(`/forms/${form.id}`),
            },
            {
              id: 'view',
              label: 'View hosted page',
              icon: <ExternalLink size={14} />,
              onSelect: () =>
                window.open(`${publicUrl}/subscribe/${form.id}`, '_blank', 'noopener'),
              disabled: !form.enabled,
              title: form.enabled ? undefined : 'The form is off, so its page says it is closed.',
            },
            ...(canEdit
              ? [
                  {
                    id: 'delete',
                    label: 'Delete',
                    icon: <Trash2 size={14} />,
                    onSelect: () => {
                      remove.reset()
                      setRemoving(form)
                    },
                    danger: true,
                    separated: true,
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ]

  const isEmpty = !forms.isPending && !forms.isError && rows.length === 0

  return (
    <Page>
      <PageHeader
        title="Signup forms"
        description="Pages and embeds where people add themselves to your lists."
        actions={
          canEdit && !isEmpty ? (
            <Button startIcon={<Plus />} onClick={() => setCreating(true)}>
              New form
            </Button>
          ) : undefined
        }
      />

      {forms.isError && <Banner tone="danger">{errorMessage(forms.error)}</Banner>}

      {isEmpty ? (
        <Card padding="none">
          <EmptyState
            icon={<ClipboardList />}
            title="No signup forms yet"
            description={
              canEdit
                ? 'A signup form is a page of its own, and a snippet for your website, where people add themselves to a list. Everyone who comes in through one has asked to hear from you, and Ariad keeps the record.'
                : 'A signup form is where people add themselves to a list. An editor or admin can make one.'
            }
            action={
              canEdit ? (
                <Button startIcon={<Plus />} onClick={() => setCreating(true)}>
                  New form
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        !forms.isError && (
          <Card padding="none" className="overflow-hidden">
            <DataTable
              aria-label="Signup forms"
              gutter="md"
              columns={columns}
              rows={rows}
              rowKey={(form) => form.id}
              loading={forms.isPending}
              skeletonRows={3}
              onRowClick={(form) => navigate(`/forms/${form.id}`)}
            />
          </Card>
        )
      )}

      <NewFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        doubleOptIn={settings.data?.compliance.doubleOptInDefault ?? true}
        onCreated={(form) => {
          void client.invalidateQueries({ queryKey: formKeys.all })
          client.setQueryData(formKeys.one(form.id), form)
          navigate(`/forms/${form.id}`)
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title={`Delete ${removing?.name ?? 'form'}?`}
        confirmLabel="Delete form"
        loading={remove.isPending}
      >
        <p>
          Its hosted page and anything embedded on your site stop taking signups straight away. The
          people who already signed up stay on their lists.
        </p>
        {remove.isError && <Banner tone="danger">{errorMessage(remove.error)}</Banner>}
      </ConfirmDialog>
    </Page>
  )
}

/** A name and where the signups go. Enough to make the form; the rest is its editor. */
function NewFormDialog({
  open,
  onClose,
  doubleOptIn,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  /** The account's default, so a new form starts the way the settings say. */
  doubleOptIn: boolean
  onCreated: (form: SignupForm) => void
}) {
  const formId = useId()
  const lists = useLists()
  const [name, setName] = useState('')
  const [listIds, setListIds] = useState<string[]>([])
  const [missing, setMissing] = useState<{ name?: string; listIds?: string }>({})

  const create = useMutation({
    mutationFn: () => api.post<SignupForm>('/forms', { name, listIds, doubleOptIn }),
    onSuccess: onCreated,
  })

  useEffect(() => {
    if (!open) return
    setName('')
    setListIds([])
    setMissing({})
    create.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const fields = create.error instanceof ApiError ? create.error.fields : {}
  const general =
    create.isError && !fields.name && !fields.listIds ? errorMessage(create.error) : null
  const noLists = lists.data?.length === 0
  const listError = missing.listIds ?? fields.listIds

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const problems = {
      name: name.trim() ? undefined : 'Give the form a name.',
      listIds: listIds.length > 0 ? undefined : 'Choose at least one list.',
    }
    setMissing(problems)
    if (problems.name || problems.listIds) return
    create.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New signup form"
      description="Name it and choose where its signups go. You set up the rest next."
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={create.isPending} disabled={noLists}>
            Create form
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {general && <Banner tone="danger">{general}</Banner>}
        {noLists && (
          <Banner tone="info" title="Make a list first">
            A form adds people to a list, and there are none yet.{' '}
            <Link
              to="/audience/lists"
              className="text-[var(--ds-accent-text)] underline underline-offset-2 hover:text-[var(--ds-fg)]"
            >
              Create a list
            </Link>
            , then come back.
          </Banner>
        )}
        <Field
          label="Name"
          hint="Only you see this. It tells your forms apart."
          error={missing.name ?? fields.name}
        >
          <TextInput
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setMissing((current) => ({ ...current, name: undefined }))
            }}
            placeholder="Website footer"
          />
        </Field>
        {/* Checkboxes, not a dropdown: a list that opens downward has nowhere to go at the foot of a dialog. */}
        {!noLists && (
          <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 p-0 text-label text-[var(--ds-fg-secondary)]">Lists</legend>
            {lists.isPending ? (
              <div className="flex flex-col gap-3 py-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-32" />
              </div>
            ) : (
              <div className="flex max-h-56 flex-col gap-2.5 overflow-y-auto">
                {(lists.data ?? []).map((list) => (
                  <Checkbox
                    key={list.id}
                    label={list.name}
                    description={list.description ?? undefined}
                    checked={listIds.includes(list.id)}
                    onChange={(on) => {
                      setListIds((current) =>
                        on ? [...current, list.id] : current.filter((id) => id !== list.id),
                      )
                      setMissing((current) => ({ ...current, listIds: undefined }))
                    }}
                  />
                ))}
              </div>
            )}
            <p className="text-caption text-[var(--ds-fg-muted)]">
              Everyone who signs up joins the ones you tick. You can change this later.
            </p>
            {listError && (
              <p
                role="alert"
                className="flex items-start gap-1.5 text-caption text-[var(--ds-danger-text)]"
              >
                <AlertCircle size={13} aria-hidden className="mt-0.5 shrink-0" />
                <span>{listError}</span>
              </p>
            )}
          </fieldset>
        )}
      </form>
    </Dialog>
  )
}
