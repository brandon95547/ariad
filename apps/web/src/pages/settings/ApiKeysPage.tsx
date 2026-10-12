import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus } from 'lucide-react'
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type ApiKey } from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { api, errorMessage } from '@/lib/api'
import { formatDate, formatRelative } from '@/lib/format'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { CodeSnippet } from '@/ui/CodeSnippet'
import { Field } from '@/ui/Controls'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { Banner, EmptyState } from '@/ui/Feedback'
import { RadioGroup, TextInput } from '@/ui/Inputs'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'

type KeyRole = 'viewer' | 'editor' | 'admin'

/**
 * Settings › API keys. A key lets a script do what a person with that role
 * could do, without a password.
 *
 * A new key is shown once, on the page itself and not in a dialog: a dialog
 * closes on a stray click, and there is no second chance to read a key that
 * is only stored as a hash.
 */
export function ApiKeysPage() {
  const client = useQueryClient()
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get<ApiKey[]>('/api-keys') })
  const [creating, setCreating] = useState(false)
  const [fresh, setFresh] = useState<{ key: ApiKey; secret: string } | null>(null)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const refresh = () => client.invalidateQueries({ queryKey: ['api-keys'] })

  const revoke = useMutation({
    mutationFn: (key: ApiKey) => api.delete(`/api-keys/${key.id}`),
    onSuccess: (_result, key) => {
      setRevoking(null)
      void refresh()
      toast.success(`${key.name} revoked`)
    },
  })

  const list = keys.data ?? []
  const example = `curl -H "Authorization: Bearer ${fresh?.secret ?? '<your key>'}" \\\n  ${window.location.origin}/api/v1/contacts`

  const columns: Column<ApiKey>[] = [
    {
      key: 'name',
      header: 'Key',
      cell: (row) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-label text-[var(--ds-fg)]">{row.name}</span>
          <span className="truncate font-mono text-caption text-[var(--ds-fg-muted)]">{row.prefix}…</span>
        </div>
      ),
    },
    { key: 'role', header: 'Can act as', width: '8rem', cell: (row) => ROLE_LABELS[row.role] },
    {
      key: 'used',
      header: 'Last used',
      width: '9rem',
      hideBelow: 'sm',
      cell: (row) => <span className="text-[var(--ds-fg-muted)]">{row.lastUsedAt ? formatRelative(row.lastUsedAt) : 'Never'}</span>,
    },
    { key: 'created', header: 'Created', width: '8rem', hideBelow: 'md', cell: (row) => <span className="text-[var(--ds-fg-muted)]">{formatDate(row.createdAt)}</span> },
    {
      key: 'state',
      header: <span className="sr-only-ds">Status</span>,
      width: '7rem',
      align: 'right',
      cell: (row) =>
        row.revokedAt ? (
          <Badge tone="neutral">Revoked</Badge>
        ) : (
          <Button
            size="xs"
            variant="danger-outline"
            onClick={() => {
              revoke.reset()
              setRevoking(row)
            }}
          >
            Revoke
          </Button>
        ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-[40rem] flex-col gap-1">
          <h2 className="text-h3 text-[var(--ds-fg)]">API keys</h2>
          <p className="text-body-sm text-[var(--ds-fg-muted)]">
            For scripts and other software that add contacts or read reports. A key can do whatever its role allows, so give each one the
            least it needs.
          </p>
        </div>
        {list.length > 0 && (
          <Button startIcon={<Plus />} onClick={() => setCreating(true)}>
            New key
          </Button>
        )}
      </div>

      {fresh && (
        <Banner
          tone="warning"
          title={`Copy the key for "${fresh.key.name}" now`}
          actions={
            <Button size="sm" variant="outlined" onClick={() => setFresh(null)}>
              I have copied it
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            <p>This is the only time it is shown. Ariad keeps a fingerprint of it, not the key, so it cannot be shown again.</p>
            <CodeSnippet code={fresh.secret} wrap />
          </div>
        </Banner>
      )}

      {keys.isError && <Banner tone="danger">{errorMessage(keys.error)}</Banner>}

      {!keys.isPending && list.length === 0 && !keys.isError ? (
        <Card padding="none">
          <EmptyState
            icon={<KeyRound />}
            title="No API keys"
            description="Create one when a script or another system needs to work with your contacts or campaigns."
            action={
              <Button startIcon={<Plus />} onClick={() => setCreating(true)}>
                New key
              </Button>
            }
          />
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <DataTable aria-label="API keys" columns={columns} rows={list} rowKey={(row) => row.id} loading={keys.isPending} skeletonRows={2} />
        </Card>
      )}

      <CodeSnippet label="Using a key" code={example} />

      <NewKeyDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false)
          setFresh(created)
          void refresh()
        }}
      />

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && revoke.mutate(revoking)}
        title={`Revoke ${revoking?.name ?? 'this key'}?`}
        confirmLabel="Revoke key"
        loading={revoke.isPending}
      >
        <p>Anything using it stops working straight away. A revoked key cannot be brought back; you would create a new one.</p>
        {revoke.isError && <Banner tone="danger">{errorMessage(revoke.error)}</Banner>}
      </ConfirmDialog>
    </div>
  )
}

function NewKeyDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (created: { key: ApiKey; secret: string }) => void }) {
  const formId = useId()
  const [name, setName] = useState('')
  const [role, setRole] = useState<KeyRole>('editor')

  const create = useMutation({
    mutationFn: () => api.post<{ key: ApiKey; secret: string }>('/api-keys', { name, role }),
    onSuccess: (created) => {
      setName('')
      setRole('editor')
      onCreated(created)
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New API key"
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={create.isPending} disabled={!name.trim()}>
            Create key
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {create.isError && <Banner tone="danger">{errorMessage(create.error)}</Banner>}
        <Field label="Name" hint="What will use it, so you know what breaks if it is revoked.">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Website signup sync" autoFocus />
        </Field>
        <RadioGroup
          label="Can act as"
          value={role}
          onChange={setRole}
          options={(['viewer', 'editor', 'admin'] as const).map((entry) => ({ value: entry, label: ROLE_LABELS[entry], description: ROLE_DESCRIPTIONS[entry] }))}
        />
      </form>
    </Dialog>
  )
}
