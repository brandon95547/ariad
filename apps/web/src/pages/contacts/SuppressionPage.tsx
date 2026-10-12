import { useEffect, useId, useState, type FormEvent } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { Ban, Plus, Search, Trash2 } from 'lucide-react'
import { isEmail, type Paged, type Suppression, type SuppressionReason } from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ApiError, api, errorMessage, qs } from '@/lib/api'
import { formatDate, plural } from '@/lib/format'
import { useInvalidate } from '@/lib/queries'
import { Badge } from '@/ui/Badge'
import { Button, IconButton } from '@/ui/Button'
import { Field, Select } from '@/ui/Controls'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import type { Tone } from '@/ui/Display'
import { Banner, EmptyState } from '@/ui/Feedback'
import { SearchInput, TextInput, Textarea } from '@/ui/Inputs'
import { Pagination } from '@/ui/Pagination'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'
import { TabHeader, contactKeys, useCan, useDebounced } from './parts'

const PAGE_SIZE = 25

const REASONS: Record<SuppressionReason, { label: string; tone: Tone }> = {
  manual: { label: 'Added by hand', tone: 'neutral' },
  unsubscribed: { label: 'Unsubscribed', tone: 'neutral' },
  bounced: { label: 'Bounced', tone: 'danger' },
  complained: { label: 'Spam complaint', tone: 'danger' },
}
const REASON_OPTIONS = (Object.keys(REASONS) as SuppressionReason[]).map((value) => ({
  value,
  label: REASONS[value].label,
}))

/**
 * Lists and segments › Suppression list. The addresses Ariad never emails,
 * whatever any list says. An unsubscribe, a hard bounce and a spam complaint
 * each put an address here; so can a person.
 */
export function SuppressionPage() {
  const invalidate = useInvalidate()
  const canEdit = useCan('editor')
  const canRemove = useCan('admin')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Suppression | null>(null)
  const q = useDebounced(search.trim(), 300)

  useEffect(() => setPage(1), [q])

  const suppressions = useQuery({
    queryKey: [...contactKeys.suppressions, { q, page }],
    queryFn: ({ signal }) =>
      api.get<Paged<Suppression>>(`/suppressions${qs({ q, page, pageSize: PAGE_SIZE })}`, {
        signal,
      }),
    placeholderData: keepPreviousData,
  })
  const rows = suppressions.data?.items ?? []
  const total = suppressions.data?.total ?? 0
  const noneAtAll =
    suppressions.isSuccess && !suppressions.isPlaceholderData && total === 0 && q === ''

  const remove = useMutation({
    mutationFn: (entry: Suppression) =>
      api.delete(`/suppressions/${encodeURIComponent(entry.email)}`),
    onSuccess: (_result, entry) => {
      setRemoving(null)
      void invalidate(contactKeys.suppressions)
      toast.success(`${entry.email} removed from the suppression list`)
    },
  })

  const columns: Column<Suppression>[] = [
    {
      key: 'email',
      header: 'Email address',
      cell: (entry) => (
        <span className="text-label text-[var(--ds-fg)] [overflow-wrap:anywhere]">
          {entry.email}
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (entry) => (
        <Badge tone={REASONS[entry.reason].tone}>{REASONS[entry.reason].label}</Badge>
      ),
    },
    { key: 'note', header: 'Note', hideBelow: 'md', cell: (entry) => entry.note },
    {
      key: 'added',
      header: 'Added',
      hideBelow: 'sm',
      className: 'whitespace-nowrap',
      cell: (entry) => formatDate(entry.createdAt),
    },
    ...(canRemove
      ? [
          {
            key: 'actions',
            header: <span className="sr-only-ds">Actions</span>,
            align: 'right' as const,
            width: '1%',
            cell: (entry: Suppression) => (
              <IconButton
                size="sm"
                label={`Remove ${entry.email} from the suppression list`}
                icon={<Trash2 />}
                onClick={() => {
                  remove.reset()
                  setRemoving(entry)
                }}
              />
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <TabHeader
        title="Suppression list"
        description="Addresses that are never emailed, whatever any list says. Unsubscribes, bounces and spam complaints land here by themselves."
        action={
          canEdit && !noneAtAll ? (
            <Button startIcon={<Plus />} onClick={() => setAdding(true)}>
              Add addresses
            </Button>
          ) : undefined
        }
      />

      {noneAtAll ? (
        <Card padding="none">
          <EmptyState
            icon={<Ban />}
            title="No suppressed addresses"
            description={
              canEdit
                ? 'Nobody has unsubscribed, bounced or complained yet. If you have an opt-out list from another tool, add it here before you send.'
                : 'Nobody has unsubscribed, bounced or complained yet.'
            }
            action={
              canEdit ? (
                <Button startIcon={<Plus />} onClick={() => setAdding(true)}>
                  Add addresses
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search addresses…"
            className="sm:max-w-[22rem]"
          />

          {suppressions.isError && (
            <Banner
              tone="danger"
              actions={
                <Button
                  size="sm"
                  variant="outlined"
                  onClick={() => suppressions.refetch()}
                  loading={suppressions.isFetching}
                >
                  Try again
                </Button>
              }
            >
              {errorMessage(suppressions.error)}
            </Banner>
          )}

          {!(suppressions.isError && rows.length === 0) && (
            <>
              <Card padding="none" className="overflow-hidden">
                <DataTable
                  aria-label="Suppressed addresses"
                  gutter="md"
                  columns={columns}
                  rows={rows}
                  rowKey={(entry) => entry.email}
                  loading={suppressions.isPending || suppressions.isPlaceholderData}
                  empty={
                    <EmptyState
                      compact
                      icon={<Search size={18} />}
                      title="No addresses match"
                      description={`Nothing on the list contains “${q}”.`}
                      action={
                        <Button size="sm" variant="outlined" onClick={() => setSearch('')}>
                          Clear search
                        </Button>
                      }
                    />
                  }
                />
              </Card>
              {total > 0 && (
                <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
              )}
            </>
          )}
        </div>
      )}

      <AddDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(added, done) => {
          void invalidate(contactKeys.suppressions, contactKeys.all)
          if (done) {
            setAdding(false)
            toast.success(`${plural(added, 'address', 'addresses')} added to the suppression list`)
          }
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title="Make this address mailable again?"
        confirmLabel="Remove from list"
        loading={remove.isPending}
      >
        <p>
          <span className="text-[var(--ds-fg)] [overflow-wrap:anywhere]">{removing?.email}</span>{' '}
          comes off the suppression list, so an import, a signup form or someone on your team can
          subscribe it again.
        </p>
        <p>
          {removing?.reason === 'bounced'
            ? 'It is here because mail to it bounced. Remove it only if you know the address works now.'
            : removing?.reason === 'complained'
              ? 'It is here because the person marked your email as spam. Remove it only if they have asked to hear from you again.'
              : 'Remove it only if the person has asked to hear from you again.'}
        </p>
        {remove.isError && <Banner tone="danger">{errorMessage(remove.error)}</Banner>}
      </ConfirmDialog>
    </div>
  )
}

/** Adds addresses by hand. What is not an address is left out, and named, so it can be put right. */
function AddDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean
  onClose: () => void
  onAdded: (added: number, done: boolean) => void
}) {
  const formId = useId()
  const [emails, setEmails] = useState('')
  const [reason, setReason] = useState<SuppressionReason>('manual')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<{
    added: number
    invalid: number
    rejected: string[]
  } | null>(null)

  const add = useMutation({
    mutationFn: () =>
      api.post<{ added: number; invalid: number }>('/suppressions', { emails, reason, note }),
    onSuccess: (outcome) => {
      // The server counts what it refused; the same split and the same test say which they were.
      const rejected = emails.split(/[\s,;]+/).filter((entry) => entry && !isEmail(entry))
      if (outcome.invalid > 0) {
        setResult({ ...outcome, rejected })
        // What went in is done with. What is left to put right is all that stays in the box.
        setEmails(rejected.join('\n'))
      }
      onAdded(outcome.added, outcome.invalid === 0)
    },
  })

  useEffect(() => {
    if (!open) return
    setEmails('')
    setReason('manual')
    setNote('')
    setResult(null)
    add.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const fields = add.error instanceof ApiError ? add.error.fields : {}
  const general = add.isError && Object.keys(fields).length === 0 ? errorMessage(add.error) : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setResult(null)
    add.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add addresses"
      description="They are never emailed from now on. A contact at one of these addresses is unsubscribed too."
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={add.isPending}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          <Button type="submit" form={formId} loading={add.isPending}>
            Add to suppression list
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {general && <Banner tone="danger">{general}</Banner>}
        {result && (
          <Banner
            tone="warning"
            title={
              result.added > 0
                ? `${plural(result.added, 'address', 'addresses')} added`
                : 'Nothing was added'
            }
          >
            {plural(result.invalid, 'entry', 'entries')}{' '}
            {result.invalid === 1
              ? 'is not an email address and was'
              : 'are not email addresses and were'}{' '}
            left out{result.rejected.length > 0 ? ': ' : '.'}
            {result.rejected.length > 0 && (
              <span className="[overflow-wrap:anywhere]">
                {result.rejected.slice(0, 10).join(', ')}
                {result.rejected.length > 10 ? `, and ${result.rejected.length - 10} more` : ''}.
              </span>
            )}{' '}
            {result.invalid === 1 ? 'Fix it' : 'Fix them'} below and add again.
          </Banner>
        )}
        <Field
          label="Email addresses"
          hint="One per line, or separated by commas."
          error={fields.emails ? 'Enter at least one email address.' : undefined}
        >
          <Textarea
            rows={6}
            value={emails}
            onChange={(event) => setEmails(event.target.value)}
            spellCheck={false}
            autoCapitalize="none"
          />
        </Field>
        <Field label="Reason" htmlFor={`${formId}-reason`}>
          <Select
            id={`${formId}-reason`}
            value={reason}
            onChange={(event) => setReason(event.target.value as SuppressionReason)}
            options={REASON_OPTIONS}
          />
        </Field>
        <Field
          label="Note"
          optional
          hint="For whoever looks at this list later: where the addresses came from."
          error={fields.note}
        >
          <TextInput
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={300}
          />
        </Field>
      </form>
    </Dialog>
  )
}
