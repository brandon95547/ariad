import { useEffect, useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role, type User } from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ApiError, api, errorMessage } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import { useAuthState } from '@/lib/queries'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Controls'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { Banner } from '@/ui/Feedback'
import { RadioGroup, TextInput } from '@/ui/Inputs'
import { ActionMenu } from '@/ui/Menu'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'

const ROLE_TONE: Record<Role, 'neutral' | 'info' | 'accent' | 'warning'> = { viewer: 'neutral', editor: 'info', admin: 'accent', owner: 'warning' }

/** Readable, and long enough: for a first password someone is about to be told. */
function makePassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  return Array.from(bytes, (byte, index) => (index > 0 && index % 5 === 0 ? '-' : '') + letters[byte % letters.length]).join('')
}

/**
 * Settings › Team. Who can sign in, and what each of them may do.
 *
 * The rules the server enforces are said here before the click, not after it:
 * only an owner manages owners, the last owner stays an owner, and nobody
 * removes or disables themselves.
 */
export function TeamPage() {
  const client = useQueryClient()
  const me = useAuthState().data?.user
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') })
  const [editing, setEditing] = useState<User | 'new' | null>(null)
  const [removing, setRemoving] = useState<User | null>(null)
  const refresh = () => client.invalidateQueries({ queryKey: ['users'] })

  const list = users.data ?? []
  const owners = list.filter((user) => user.role === 'owner' && user.status === 'active').length
  const iAmOwner = me?.role === 'owner'

  /** Why this person cannot be changed by the one looking, or null if they can. */
  const locked = (user: User): string | null => (user.role === 'owner' && !iAmOwner ? 'Only an owner can change an owner.' : null)
  const lastOwner = (user: User) => user.role === 'owner' && user.status === 'active' && owners <= 1

  const setStatus = useMutation({
    mutationFn: (user: User) => api.patch<User>(`/users/${user.id}`, { status: user.status === 'active' ? 'disabled' : 'active' }),
    onSuccess: (updated) => {
      void refresh()
      toast.success(updated.status === 'active' ? `${updated.name} can sign in again` : `${updated.name} can no longer sign in`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (user: User) => api.delete(`/users/${user.id}`),
    onSuccess: (_result, user) => {
      setRemoving(null)
      void refresh()
      toast.success(`${user.name} removed`)
    },
  })

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'Person',
      cell: (row) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-label text-[var(--ds-fg)]">
            {row.name}
            {row.id === me?.id && <span className="text-[var(--ds-fg-muted)]"> (you)</span>}
          </span>
          <span className="truncate text-caption text-[var(--ds-fg-muted)]">{row.email}</span>
        </div>
      ),
    },
    { key: 'role', header: 'Role', width: '7rem', cell: (row) => <Badge tone={ROLE_TONE[row.role]}>{ROLE_LABELS[row.role]}</Badge> },
    {
      key: 'status',
      header: 'Status',
      width: '7rem',
      hideBelow: 'sm',
      cell: (row) => (row.status === 'active' ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Disabled</Badge>),
    },
    {
      key: 'seen',
      header: 'Last signed in',
      width: '10rem',
      hideBelow: 'md',
      cell: (row) => <span className="text-[var(--ds-fg-muted)]">{row.lastLoginAt ? formatRelative(row.lastLoginAt) : 'Never'}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only-ds">Actions</span>,
      width: '3rem',
      align: 'right',
      cell: (row) => {
        const why = locked(row)
        const self = row.id === me?.id
        return (
          <ActionMenu
            label={`Actions for ${row.name}`}
            icon={<MoreHorizontal size={16} />}
            actions={[
              { id: 'edit', label: 'Edit', icon: <Pencil size={14} />, onSelect: () => setEditing(row), disabled: Boolean(why), title: why ?? undefined },
              {
                id: 'status',
                label: row.status === 'active' ? 'Disable sign-in' : 'Enable sign-in',
                icon: <Power size={14} />,
                separated: true,
                onSelect: () => setStatus.mutate(row),
                disabled: Boolean(why) || self || (row.status === 'active' && lastOwner(row)),
                title: why ?? (self ? 'You cannot disable your own account.' : lastOwner(row) ? 'This is the only owner.' : undefined),
              },
              {
                id: 'remove',
                label: 'Remove',
                icon: <Trash2 size={14} />,
                danger: true,
                onSelect: () => {
                  remove.reset()
                  setRemoving(row)
                },
                disabled: Boolean(why) || self || lastOwner(row),
                title: why ?? (self ? 'You cannot remove your own account.' : lastOwner(row) ? 'This is the only owner. Make someone else an owner first.' : undefined),
              },
            ]}
          />
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-[40rem] flex-col gap-1">
          <h2 className="text-h3 text-[var(--ds-fg)]">Team</h2>
          <p className="text-body-sm text-[var(--ds-fg-muted)]">Everyone who can sign in to Ariad, and what their role lets them do.</p>
        </div>
        <Button startIcon={<Plus />} onClick={() => setEditing('new')}>
          Add person
        </Button>
      </div>

      {users.isError && <Banner tone="danger">{errorMessage(users.error)}</Banner>}

      <Card padding="none" className="overflow-hidden">
        <DataTable aria-label="Team" columns={columns} rows={list} rowKey={(row) => row.id} loading={users.isPending} skeletonRows={3} />
      </Card>

      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {ROLES.map((role) => (
          <div key={role} className="flex flex-col gap-1.5">
            <dt className="text-label text-[var(--ds-fg)]">{ROLE_LABELS[role]}</dt>
            <dd className="text-body-sm text-[var(--ds-fg-muted)]">{ROLE_DESCRIPTIONS[role]}</dd>
          </div>
        ))}
      </dl>

      <PersonDialog
        target={editing}
        iAmOwner={iAmOwner}
        isLastOwner={editing !== null && editing !== 'new' && lastOwner(editing)}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void refresh()
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title={`Remove ${removing?.name ?? 'this person'}?`}
        confirmLabel="Remove person"
        loading={remove.isPending}
      >
        <p>They are signed out everywhere and can no longer sign in. What they made — campaigns, contacts, templates — stays.</p>
        {remove.isError && <Banner tone="danger">{errorMessage(remove.error)}</Banner>}
      </ConfirmDialog>
    </div>
  )
}

function PersonDialog({
  target,
  iAmOwner,
  isLastOwner,
  onClose,
  onSaved,
}: {
  target: User | 'new' | null
  iAmOwner: boolean
  isLastOwner: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const formId = useId()
  const isNew = target === 'new'
  const user = target !== null && target !== 'new' ? target : null
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (target === null) return
    setName(user?.name ?? '')
    setEmail(user?.email ?? '')
    setRole(user?.role ?? 'editor')
    // A new person gets a password made for them; an existing one keeps theirs unless one is typed.
    setPassword(user ? '' : makePassword())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const save = useMutation({
    mutationFn: () =>
      user
        ? api.patch<User>(`/users/${user.id}`, { name, role, password: password || undefined })
        : api.post<User>('/users', { name, email, role, password }),
    onSuccess: (saved) => {
      toast.success(
        user ? `${saved.name} updated` : `${saved.name} added`,
        user ? undefined : { description: 'Pass the password on to them yourself. Ariad does not email it.' },
      )
      onSaved()
    },
  })
  const fields = save.error instanceof ApiError ? save.error.fields : {}
  const general = save.isError && Object.keys(fields).length === 0 ? errorMessage(save.error) : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }

  // Owner is offered only to owners, and the last owner's role cannot be changed.
  const options = ROLES.filter((entry) => entry !== 'owner' || iAmOwner || user?.role === 'owner').map((entry) => ({
    value: entry,
    label: ROLE_LABELS[entry],
    description: ROLE_DESCRIPTIONS[entry],
  }))

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={isNew ? 'Add a person' : `Edit ${user?.name ?? ''}`}
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {isNew ? 'Add person' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {general && <Banner tone="danger">{general}</Banner>}
        <Field label="Name" error={fields.name}>
          <TextInput value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" required />
        </Field>
        <Field label="Email" hint={user ? 'Their sign-in. It cannot be changed here.' : 'What they sign in with.'} error={fields.email}>
          <TextInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" disabled={Boolean(user)} required />
        </Field>
        {isLastOwner ? (
          <Banner tone="info" title="This is the only owner">
            Their role cannot be changed until someone else is made an owner.
          </Banner>
        ) : (
          <RadioGroup label="Role" value={role} onChange={setRole} options={options} />
        )}
        <Field
          label={user ? 'New password' : 'First password'}
          optional={Boolean(user)}
          hint={
            user
              ? 'Leave blank to keep their password. Setting one signs them out everywhere.'
              : 'Copy it and pass it on yourself; Ariad does not email it. They can change it under Your profile.'
          }
          error={fields.password}
        >
          <TextInput value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
        </Field>
      </form>
    </Dialog>
  )
}
