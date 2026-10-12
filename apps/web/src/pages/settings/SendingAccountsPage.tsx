import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Mail,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  Power,
  Send,
  Server,
  Star,
  Trash2,
} from 'lucide-react'
import type { SendingAccount, SendingAccountKind, VerifyResult } from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { api, errorMessage } from '@/lib/api'
import { formatNumber, formatRelative, plural } from '@/lib/format'
import { useMediaQuery } from '@/lib/hooks'
import { keys, useAccounts, useAuthState, useSettings } from '@/lib/queries'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Controls'
import { Dialog } from '@/ui/Dialog'
import { Banner, EmptyState, ProgressBar, Skeleton } from '@/ui/Feedback'
import { TextInput } from '@/ui/Inputs'
import { ActionMenu, type MenuAction } from '@/ui/Menu'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'
import { AccountDialog } from './AccountDialog'

type Editor = { kind: SendingAccountKind; account: SendingAccount | null } | null

function statusBadge(account: SendingAccount) {
  if (!account.enabled) return <Badge tone="neutral">Turned off</Badge>
  if (account.status === 'error')
    return (
      <Badge tone="danger" dot>
        Cannot sign in
      </Badge>
    )
  if (account.pausedUntil)
    return (
      <Badge tone="warning" dot>
        Paused {formatRelative(account.pausedUntil).replace(/^in /, 'for ')}
      </Badge>
    )
  if (account.status === 'ok')
    return (
      <Badge tone="success" dot>
        Connected
      </Badge>
    )
  return <Badge tone="neutral">Not checked</Badge>
}

/**
 * Settings › Sending accounts.
 *
 * The mailboxes Ariad sends through: Gmail accounts and SMTP servers, added
 * and removed here. One of them is the default, used by anything that does not
 * name an account of its own.
 */
export function SendingAccountsPage() {
  const client = useQueryClient()
  const accounts = useAccounts({ refetchInterval: 20_000 })
  const settings = useSettings()
  const auth = useAuthState()
  const canEdit = auth.data?.user?.role === 'admin' || auth.data?.user?.role === 'owner'

  const [editor, setEditor] = useState<Editor>(null)
  const [testing, setTesting] = useState<SendingAccount | null>(null)
  const [removing, setRemoving] = useState<SendingAccount | null>(null)

  const refresh = () => client.invalidateQueries({ queryKey: keys.accounts })

  const verify = useMutation({
    mutationFn: (id: string) =>
      api.post<{ account: SendingAccount; verify: VerifyResult }>(`/sending-accounts/${id}/verify`),
    onSuccess: ({ account, verify: result }) => {
      void refresh()
      if (result.ok) toast.success(`${account.label} is connected`)
      else toast.error(`${account.label} could not sign in`, { description: result.message })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const makeDefault = useMutation({
    mutationFn: (id: string) => api.post<SendingAccount>(`/sending-accounts/${id}/default`),
    onSuccess: (account) => {
      void refresh()
      void client.invalidateQueries({ queryKey: keys.settings })
      toast.success(`${account.label} is now the default`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const toggle = useMutation({
    mutationFn: (account: SendingAccount) =>
      api.patch(`/sending-accounts/${account.id}`, { enabled: !account.enabled }),
    onSuccess: (_result, account) => {
      void refresh()
      toast.success(account.enabled ? `${account.label} turned off` : `${account.label} turned on`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (account: SendingAccount) => api.delete(`/sending-accounts/${account.id}`),
    onSuccess: (_result, account) => {
      setRemoving(null)
      void refresh()
      toast.success(`${account.label} removed`)
    },
  })

  const list = accounts.data ?? []
  const add = (kind: SendingAccountKind) => setEditor({ kind, account: null })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-[40rem] flex-col gap-1">
          <h2 className="text-h3 text-[var(--ds-fg)]">Sending accounts</h2>
          <p className="text-body-sm text-[var(--ds-fg-muted)]">
            The mailboxes Ariad sends through. Add a Gmail account, or any mail server or sending
            service that speaks SMTP.
          </p>
        </div>
        {canEdit && list.length > 0 && (
          <div className="flex items-center gap-2 coarse:gap-3">
            <Button variant="outlined" startIcon={<Server />} onClick={() => add('smtp')}>
              Add SMTP
            </Button>
            <Button startIcon={<Plus />} onClick={() => add('gmail')}>
              Add Gmail
            </Button>
          </div>
        )}
      </div>

      {accounts.isError && <Banner tone="danger">{errorMessage(accounts.error)}</Banner>}

      {accounts.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[7.5rem] rounded-[var(--radius-xl)]" />
          <Skeleton className="h-[7.5rem] rounded-[var(--radius-xl)]" />
        </div>
      ) : list.length === 0 && !accounts.isError ? (
        <Card padding="none">
          <EmptyState
            icon={<Mail />}
            title="No sending accounts yet"
            description={
              canEdit
                ? 'Nothing can be sent until Ariad has a mailbox to send through. A Gmail account is the quickest to connect.'
                : 'An admin needs to connect a Gmail or SMTP account before anything can be sent.'
            }
            action={
              canEdit ? (
                <>
                  <Button startIcon={<Plus />} onClick={() => add('gmail')}>
                    Add Gmail account
                  </Button>
                  <Button variant="text" onClick={() => add('smtp')}>
                    Add SMTP account
                  </Button>
                </>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((account) => (
            <li key={account.id}>
              <AccountCard
                account={account}
                canEdit={canEdit}
                busy={verify.isPending && verify.variables === account.id}
                onTest={() => setTesting(account)}
                onEdit={() => setEditor({ kind: account.kind, account })}
                onVerify={() => verify.mutate(account.id)}
                onDefault={() => makeDefault.mutate(account.id)}
                onToggle={() => toggle.mutate(account)}
                onRemove={() => {
                  remove.reset()
                  setRemoving(account)
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <AccountDialog
        open={editor !== null}
        kind={editor?.kind ?? 'gmail'}
        account={editor?.account ?? null}
        organization={settings.data?.organization.name ?? ''}
        onClose={() => setEditor(null)}
        onSaved={({ account }, done) => {
          void refresh()
          void client.invalidateQueries({ queryKey: keys.settings })
          if (done) {
            setEditor(null)
            toast.success(`${account.label} is connected`, {
              description: `Sending as ${account.fromName} <${account.fromEmail}>`,
            })
          }
        }}
      />

      <TestDialog
        account={testing}
        defaultTo={auth.data?.user?.email ?? ''}
        onClose={() => setTesting(null)}
        onDone={refresh}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title={`Remove ${removing?.label ?? 'account'}?`}
        confirmLabel="Remove account"
        loading={remove.isPending}
      >
        <p>
          Ariad will forget this account and its password. Campaigns already sent through it keep
          their history; anything set to use it falls back to the default account.
        </p>
        {remove.isError && <Banner tone="danger">{errorMessage(remove.error)}</Banner>}
      </ConfirmDialog>
    </div>
  )
}

function AccountCard({
  account,
  canEdit,
  busy,
  onTest,
  onEdit,
  onVerify,
  onDefault,
  onToggle,
  onRemove,
}: {
  account: SendingAccount
  canEdit: boolean
  busy: boolean
  onTest: () => void
  onEdit: () => void
  onVerify: () => void
  onDefault: () => void
  onToggle: () => void
  onRemove: () => void
}) {
  const actions: MenuAction[] = [
    { id: 'edit', label: 'Edit', icon: <Pencil size={14} />, onSelect: onEdit },
    { id: 'verify', label: 'Check connection', icon: <Plug size={14} />, onSelect: onVerify },
    {
      id: 'default',
      label: 'Make default',
      icon: <Star size={14} />,
      onSelect: onDefault,
      disabled: account.isDefault || !account.enabled,
    },
    {
      id: 'toggle',
      label: account.enabled ? 'Turn off' : 'Turn on',
      icon: <Power size={14} />,
      onSelect: onToggle,
      separated: true,
    },
    { id: 'remove', label: 'Remove', icon: <Trash2 size={14} />, onSelect: onRemove, danger: true },
  ]
  const Icon = account.kind === 'gmail' ? Mail : Server
  const roomForTest = useMediaQuery('(min-width: 40rem)')
  const nearLimit = account.sentLast24h >= account.dailyLimit

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3.5">
        <span
          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--ds-accent-subtle)] text-[var(--ds-accent-text)]"
          aria-hidden
        >
          <Icon size={17} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h3 className="min-w-0 truncate text-h4 text-[var(--ds-fg)]">{account.label}</h3>
            {statusBadge(account)}
            {account.isDefault && <Badge tone="accent">Default</Badge>}
          </div>
          <p className="truncate text-body-sm text-[var(--ds-fg-secondary)]">
            {account.fromName} &lt;{account.fromEmail}&gt;
          </p>
          <p className="truncate text-caption text-[var(--ds-fg-muted)]">
            {account.kind === 'gmail' ? 'Gmail' : `${account.host}:${account.port}`}
            {account.lastVerifiedAt ? ` · checked ${formatRelative(account.lastVerifiedAt)}` : ''}
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1.5 coarse:gap-3">
            {roomForTest && (
              <Button
                variant="outlined"
                size="sm"
                startIcon={<Send />}
                onClick={onTest}
                disabled={!account.enabled}
              >
                Send test
              </Button>
            )}
            <ActionMenu
              label={`Actions for ${account.label}`}
              icon={<MoreHorizontal size={16} />}
              actions={
                // On a phone the test button lives in the menu instead.
                roomForTest
                  ? actions
                  : [
                      {
                        id: 'test',
                        label: 'Send test',
                        icon: <Send size={14} />,
                        onSelect: onTest,
                        disabled: !account.enabled,
                      },
                      ...actions,
                    ]
              }
            />
          </div>
        )}
      </div>

      {account.status === 'error' && account.lastError && (
        <Banner
          tone="danger"
          title="This account cannot send"
          actions={
            canEdit ? (
              <>
                <Button size="sm" variant="outlined" onClick={onEdit}>
                  Edit account
                </Button>
                <Button size="sm" variant="text" onClick={onVerify} loading={busy}>
                  Try again
                </Button>
              </>
            ) : undefined
          }
        >
          {account.lastError}
        </Banner>
      )}
      {account.status !== 'error' && account.pausedUntil && (
        <Banner tone="warning" title="The provider asked Ariad to slow down">
          Sending resumes {formatRelative(account.pausedUntil)}. {account.lastError}
        </Banner>
      )}

      <div className="flex flex-col gap-1.5">
        <ProgressBar
          value={account.sentLast24h}
          max={account.dailyLimit}
          tone={nearLimit ? 'warning' : 'accent'}
          label={`${formatNumber(account.sentLast24h)} of ${formatNumber(account.dailyLimit)} sent in the last 24 hours`}
        />
        <p className="text-caption text-[var(--ds-fg-muted)]">
          Up to {formatNumber(account.perMinute)} a minute
          {account.queued > 0 ? ` · ${plural(account.queued, 'email')} waiting to send` : ''}
          {nearLimit ? ' · daily limit reached, the rest goes out as it clears' : ''}
        </p>
      </div>
    </Card>
  )
}

/** Sends one real email through the account, and shows what the server said. */
function TestDialog({
  account,
  defaultTo,
  onClose,
  onDone,
}: {
  account: SendingAccount | null
  defaultTo: string
  onClose: () => void
  onDone: () => void
}) {
  const [to, setTo] = useState('')
  const [result, setResult] = useState<VerifyResult | null>(null)

  // A fresh dialog for each account: the last result belongs to the last one.
  useEffect(() => {
    if (!account) return
    setTo(defaultTo)
    setResult(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id])

  const send = useMutation({
    mutationFn: () => api.post<VerifyResult>(`/sending-accounts/${account!.id}/test`, { to }),
    onSuccess: (outcome) => {
      setResult(outcome)
      onDone()
    },
    onError: (error) => setResult({ ok: false, message: errorMessage(error) }),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setResult(null)
    send.mutate()
  }

  return (
    <Dialog
      open={account !== null}
      onClose={onClose}
      title="Send a test email"
      description={
        account
          ? `Through ${account.label}, as ${account.fromName} <${account.fromEmail}>.`
          : undefined
      }
      size="sm"
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            {result?.ok ? 'Done' : 'Cancel'}
          </Button>
          <Button type="submit" form="test-send-form" loading={send.isPending} startIcon={<Send />}>
            {result ? 'Send again' : 'Send test'}
          </Button>
        </>
      }
    >
      <form id="test-send-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Send to">
          <TextInput
            type="email"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            autoComplete="email"
            required
          />
        </Field>
        {result && (
          <Banner
            tone={result.ok ? 'success' : 'danger'}
            title={result.ok ? 'Sent' : 'It did not send'}
          >
            {result.message}
          </Banner>
        )}
      </form>
    </Dialog>
  )
}
