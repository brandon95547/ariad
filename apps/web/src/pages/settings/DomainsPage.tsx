import { useEffect, useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, KeyRound, MoreHorizontal, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { roleAtLeast, type DnsCheck, type SendingDomain } from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ApiError, api, errorMessage } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import { useMediaQuery } from '@/lib/hooks'
import { useAuthState } from '@/lib/queries'
import { Badge } from '@/ui/Badge'
import { Button, IconButton } from '@/ui/Button'
import { CodeSnippet } from '@/ui/CodeSnippet'
import { Field } from '@/ui/Controls'
import { Dialog } from '@/ui/Dialog'
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback'
import { TextInput } from '@/ui/Inputs'
import { ActionMenu } from '@/ui/Menu'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'

interface DomainsData {
  domains: SendingDomain[]
  /** Domains mail is sent from that have not been added here. */
  suggested: string[]
  /** Free-mail domains mail is sent from: their provider owns the records. */
  freeMail: string[]
}

const domainsKey = ['domains'] as const

const CHECKS = [
  { key: 'spf', name: 'SPF', what: 'Which servers may send as this domain' },
  { key: 'dkim', name: 'DKIM', what: 'A signature on every message' },
  { key: 'dmarc', name: 'DMARC', what: 'What receivers do when a check fails' },
  { key: 'mx', name: 'MX', what: 'Where mail sent to this domain goes' },
] as const

function checkBadge(check: DnsCheck) {
  if (check.status === 'pass') return <Badge tone="success">Passing</Badge>
  if (check.status === 'warn') return <Badge tone="warning">Needs attention</Badge>
  if (check.status === 'fail') return <Badge tone="danger">{check.record ? 'Failing' : 'Missing'}</Badge>
  return <Badge tone="neutral">Not checked</Badge>
}

function overallBadge(domain: SendingDomain) {
  const statuses = CHECKS.map(({ key }) => domain[key].status)
  if (statuses.every((status) => status === 'pass')) {
    return (
      <Badge tone="success" dot>
        All passing
      </Badge>
    )
  }
  if (statuses.includes('fail')) {
    return (
      <Badge tone="danger" dot>
        Needs fixing
      </Badge>
    )
  }
  if (statuses.includes('warn')) {
    return (
      <Badge tone="warning" dot>
        Needs attention
      </Badge>
    )
  }
  return <Badge tone="neutral">Not checked</Badge>
}

/**
 * The advice often ends in the exact thing to put in DNS. That part is pulled
 * out so it can be copied whole; a record retyped by hand is a record with a
 * typo in it.
 */
function splitAdvice(advice: string): { text: string; code: string | null } {
  const record = /^(Add a TXT record on \S+): (.+)$/.exec(advice)
  if (record) return { text: `${record[1]} with this value:`, code: record[2] ?? null }
  const part = /^Add (\S+) to it, (.+)$/.exec(advice)
  if (part) return { text: `Add this to the record, ${part[2]}`, code: part[1] ?? null }
  return { text: advice, code: null }
}

/** Whatever was pasted — an address, a link — down to the bare domain the server expects. */
const bareDomain = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^.*@/, '')
    .replace(/[/?#].*$/, '')

/**
 * Settings › Domains. Looks up the DNS records that let receivers trust mail
 * from each domain you send as — SPF, DKIM, DMARC and MX — and says, record by
 * record, what is published and what to add. Ariad cannot change DNS; this page
 * is the list of what to change at whoever hosts it.
 */
export function DomainsPage() {
  const client = useQueryClient()
  const canEdit = roleAtLeast(useAuthState().data?.user?.role ?? 'viewer', 'admin')
  const domains = useQuery({ queryKey: domainsKey, queryFn: () => api.get<DomainsData>('/domains') })

  const [adding, setAdding] = useState<{ domain: string } | null>(null)
  const [selecting, setSelecting] = useState<SendingDomain | null>(null)
  const [removing, setRemoving] = useState<SendingDomain | null>(null)

  const put = (next: SendingDomain) =>
    client.setQueryData<DomainsData>(domainsKey, (current) =>
      current ? { ...current, domains: current.domains.map((domain) => (domain.id === next.id ? next : domain)) } : current,
    )
  const refresh = () => client.invalidateQueries({ queryKey: domainsKey })

  const check = useMutation({
    mutationFn: (id: string) => api.post<SendingDomain>(`/domains/${id}/check`),
    onSuccess: (domain) => {
      put(domain)
      toast.success(`${domain.domain} checked`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const quickAdd = useMutation({
    mutationFn: (domain: string) => api.post<SendingDomain>('/domains', { domain }),
    onSuccess: (domain) => {
      void refresh()
      toast.success(`${domain.domain} added and checked`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (domain: SendingDomain) => api.delete(`/domains/${domain.id}`),
    onSuccess: (_result, domain) => {
      setRemoving(null)
      void refresh()
      toast.success(`${domain.domain} removed`)
    },
  })

  const list = domains.data?.domains ?? []
  const suggested = domains.data?.suggested ?? []
  const freeMail = domains.data?.freeMail ?? []
  const firstSuggestion = suggested[0]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-[44rem] flex-col gap-1">
          <h2 className="text-h3 text-[var(--ds-fg)]">Domains</h2>
          <p className="text-body-sm text-[var(--ds-fg-muted)]">
            SPF, DKIM and DMARC are DNS records that prove an email really comes from your domain: SPF lists the servers allowed to send for it,
            DKIM signs each message, and DMARC tells receivers what to do when either check fails. Gmail and Yahoo require all three from
            anyone sending in bulk, and mail without them is turned away or lands in spam.
          </p>
        </div>
        {canEdit && list.length > 0 && (
          <Button startIcon={<Plus />} onClick={() => setAdding({ domain: '' })}>
            Add domain
          </Button>
        )}
      </div>

      {domains.isError && <Banner tone="danger">{errorMessage(domains.error)}</Banner>}

      {freeMail.length > 0 && (
        <Banner tone="info" title={`Nothing to set up for ${freeMail.join(' or ')}`}>
          You send from {freeMail.length === 1 ? 'a free address' : 'free addresses'}, and the provider publishes these records itself. Mail from a
          free address to a large list is more likely to be filtered, though, so a domain of your own is worth having for real campaigns.
        </Banner>
      )}

      {domains.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-64 rounded-[var(--radius-xl)]" />
        </div>
      ) : list.length === 0 && !domains.isError ? (
        <Card padding="none">
          <EmptyState
            icon={<Globe />}
            title="No domains checked yet"
            description={
              !canEdit
                ? 'An admin can add the domain you send from, and Ariad will look up its records and say what is missing.'
                : firstSuggestion
                  ? `You send from ${firstSuggestion}. Add it, and Ariad looks up its records and tells you what is missing.`
                  : 'Add the domain you send from, and Ariad looks up its records and tells you what is missing.'
            }
            action={
              canEdit ? (
                firstSuggestion ? (
                  <>
                    <Button startIcon={<Plus />} onClick={() => quickAdd.mutate(firstSuggestion)} loading={quickAdd.isPending}>
                      Add {firstSuggestion}
                    </Button>
                    <Button variant="text" onClick={() => setAdding({ domain: '' })} disabled={quickAdd.isPending}>
                      Add another domain
                    </Button>
                  </>
                ) : (
                  <Button startIcon={<Plus />} onClick={() => setAdding({ domain: '' })}>
                    Add domain
                  </Button>
                )
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          {canEdit &&
            suggested.map((domain) => (
              <Banner
                key={domain}
                tone="info"
                title={`You send from ${domain}, and it is not checked yet`}
                actions={
                  <Button
                    size="sm"
                    variant="outlined"
                    onClick={() => quickAdd.mutate(domain)}
                    loading={quickAdd.isPending && quickAdd.variables === domain}
                    disabled={quickAdd.isPending}
                  >
                    Add {domain}
                  </Button>
                }
              />
            ))}
          <ul className="flex flex-col gap-3">
            {list.map((domain) => (
              <li key={domain.id}>
                <DomainCard
                  domain={domain}
                  canEdit={canEdit}
                  checking={check.isPending && check.variables === domain.id}
                  onCheck={() => check.mutate(domain.id)}
                  onSelector={() => setSelecting(domain)}
                  onRemove={() => {
                    remove.reset()
                    setRemoving(domain)
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <AddDomainDialog
        open={adding !== null}
        onClose={() => setAdding(null)}
        onAdded={(domain) => {
          setAdding(null)
          void refresh()
          toast.success(`${domain.domain} added and checked`)
        }}
      />

      <SelectorDialog
        domain={selecting}
        onClose={() => setSelecting(null)}
        onSaved={(domain) => {
          setSelecting(null)
          put(domain)
          toast.success(`${domain.domain} checked again`, { description: domain.dkim.summary })
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title={`Remove ${removing?.domain ?? 'domain'}?`}
        confirmLabel="Remove domain"
        loading={remove.isPending}
      >
        <p>Ariad stops checking this domain. Nothing changes in its DNS, and mail from it keeps sending as before.</p>
        {remove.isError && <Banner tone="danger">{errorMessage(remove.error)}</Banner>}
      </ConfirmDialog>
    </div>
  )
}

function DomainCard({
  domain,
  canEdit,
  checking,
  onCheck,
  onSelector,
  onRemove,
}: {
  domain: SendingDomain
  canEdit: boolean
  checking: boolean
  onCheck: () => void
  onSelector: () => void
  onRemove: () => void
}) {
  const roomForLabel = useMediaQuery('(min-width: 40rem)')
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--ds-accent-subtle)] text-[var(--ds-accent-text)]" aria-hidden>
          <Globe size={17} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h3 className="min-w-0 text-h4 text-[var(--ds-fg)] [overflow-wrap:anywhere]">{domain.domain}</h3>
            {overallBadge(domain)}
          </div>
          <p className="text-caption text-[var(--ds-fg-muted)]">
            {domain.checkedAt ? `Checked ${formatRelative(domain.checkedAt)}` : 'Not checked yet'}
            {domain.dkimSelector ? ` · DKIM selector ${domain.dkimSelector}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 coarse:gap-3">
          {roomForLabel ? (
            <Button variant="outlined" size="sm" startIcon={<RefreshCw />} onClick={onCheck} loading={checking}>
              Check again
            </Button>
          ) : (
            <IconButton size="sm" variant="outlined" label={`Check ${domain.domain} again`} icon={<RefreshCw />} onClick={onCheck} loading={checking} />
          )}
          {canEdit && (
            <ActionMenu
              label={`Actions for ${domain.domain}`}
              icon={<MoreHorizontal size={16} />}
              actions={[
                { id: 'selector', label: 'Change DKIM selector', icon: <KeyRound size={14} />, onSelect: onSelector },
                { id: 'remove', label: 'Remove', icon: <Trash2 size={14} />, onSelect: onRemove, danger: true, separated: true },
              ]}
            />
          )}
        </div>
      </div>

      <ul className="flex flex-col divide-y divide-[var(--ds-border-subtle)] border-t border-[var(--ds-border-subtle)]">
        {CHECKS.map(({ key, name, what }) => {
          const result = domain[key]
          const advice = result.advice ? splitAdvice(result.advice) : null
          return (
            <li key={key} className="grid grid-cols-1 gap-x-6 gap-y-2.5 py-4 last:pb-0 sm:grid-cols-[13rem_minmax(0,1fr)]">
              <div className="flex flex-col gap-0.5">
                <h4 className="text-label text-[var(--ds-fg)]">{name}</h4>
                <p className="text-caption text-[var(--ds-fg-muted)]">{what}</p>
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  {checkBadge(result)}
                  <p className="min-w-0 text-body-sm text-[var(--ds-fg-secondary)] [overflow-wrap:anywhere]">{result.summary}</p>
                </div>
                {result.record && <CodeSnippet label="Published now" code={result.record} wrap />}
                {advice && (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-body-sm text-[var(--ds-fg-secondary)] [overflow-wrap:anywhere]">
                      <span className="font-medium text-[var(--ds-fg)]">What to do: </span>
                      {advice.text}
                    </p>
                    {advice.code && <CodeSnippet code={advice.code} wrap />}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** Adding a domain also checks it, so the dialog's wait is the DNS lookups. */
function AddDomainDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (domain: SendingDomain) => void }) {
  const formId = useId()
  const [domain, setDomain] = useState('')
  const [selector, setSelector] = useState('')

  const add = useMutation({
    mutationFn: () => api.post<SendingDomain>('/domains', { domain: bareDomain(domain), dkimSelector: selector.trim() || null }),
    onSuccess: onAdded,
  })

  useEffect(() => {
    if (!open) return
    setDomain('')
    setSelector('')
    add.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const fields = add.error instanceof ApiError ? add.error.fields : {}
  const general = add.isError && !fields.domain && !fields.dkimSelector ? errorMessage(add.error) : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    add.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a domain"
      description="The part after the @ in the address you send from. Ariad looks up its records as soon as it is added."
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={add.isPending}>
            Add and check
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {general && <Banner tone="danger">{general}</Banner>}
        <Field label="Domain" error={fields.domain}>
          <TextInput
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="example.com"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="url"
            required
          />
        </Field>
        <Field
          label="DKIM selector"
          optional
          hint="The name your mail provider gives its DKIM key. Google Workspace uses google. Leave it blank and Ariad tries the common ones."
          error={fields.dkimSelector ? 'Use letters, numbers, dots, dashes and underscores only.' : undefined}
        >
          <TextInput value={selector} onChange={(event) => setSelector(event.target.value)} placeholder="google" autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </Field>
      </form>
    </Dialog>
  )
}

function SelectorDialog({ domain, onClose, onSaved }: { domain: SendingDomain | null; onClose: () => void; onSaved: (domain: SendingDomain) => void }) {
  const formId = useId()
  const [selector, setSelector] = useState('')

  const save = useMutation({
    mutationFn: () => api.patch<SendingDomain>(`/domains/${domain!.id}`, { dkimSelector: selector.trim() || null }),
    onSuccess: onSaved,
  })

  useEffect(() => {
    if (!domain) return
    setSelector(domain.dkimSelector ?? '')
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain?.id])

  const fields = save.error instanceof ApiError ? save.error.fields : {}
  const general = save.isError && !fields.dkimSelector ? errorMessage(save.error) : null

  return (
    <Dialog
      open={domain !== null}
      onClose={onClose}
      title="DKIM selector"
      description={domain ? `Where to look for the DKIM key of ${domain.domain}.` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            Save and check
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
        className="flex flex-col gap-5"
        noValidate
      >
        {general && <Banner tone="danger">{general}</Banner>}
        <Field
          label="Selector"
          optional
          hint={
            domain
              ? `Ariad looks for the key at ${selector.trim() || 'selector'}._domainkey.${domain.domain}. Google Workspace uses google. Leave it blank to try the common ones.`
              : undefined
          }
          error={fields.dkimSelector ? 'Use letters, numbers, dots, dashes and underscores only.' : undefined}
        >
          <TextInput value={selector} onChange={(event) => setSelector(event.target.value)} placeholder="google" autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </Field>
      </form>
    </Dialog>
  )
}
