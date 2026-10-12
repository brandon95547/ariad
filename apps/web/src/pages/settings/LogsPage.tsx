import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCw } from 'lucide-react'
import type { LogEntry, LogLevel, Paged, QueueStatus } from '@ariad/shared'
import { api, errorMessage, qs } from '@/lib/api'
import { formatDateTime, formatNumber, formatRelative, plural } from '@/lib/format'
import { useDebounced } from '@/lib/hooks'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { CodeSnippet } from '@/ui/CodeSnippet'
import { FilterChip, Select } from '@/ui/Controls'
import { DataTable, type Column } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { Banner, EmptyState } from '@/ui/Feedback'
import { SearchInput } from '@/ui/Inputs'
import { Pagination } from '@/ui/Pagination'
import { StatTile } from '@/ui/Stat'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'

const LEVELS: { value: LogLevel | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warnings' },
  { value: 'error', label: 'Errors' },
]

const LEVEL_BADGE: Record<LogLevel, { tone: 'neutral' | 'warning' | 'danger'; label: string }> = {
  info: { tone: 'neutral', label: 'Info' },
  warn: { tone: 'warning', label: 'Warning' },
  error: { tone: 'danger', label: 'Error' },
}

/** The sender is alive if it has made a pass in the last half minute. */
const STALE_MS = 30_000

/**
 * Settings › System logs. What the sender is doing right now, and the record
 * of what Ariad and the people using it have done.
 */
export function LogsPage() {
  const client = useQueryClient()
  const [level, setLevel] = useState<LogLevel | 'all'>('all')
  const [scope, setScope] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<LogEntry | null>(null)
  const q = useDebounced(search)

  const queue = useQuery({
    queryKey: ['queue'],
    queryFn: () => api.get<QueueStatus>('/queue'),
    refetchInterval: 10_000,
  })
  const logs = useQuery({
    queryKey: ['logs', { level, scope, q, page }],
    queryFn: () =>
      api.get<Paged<LogEntry> & { scopes: string[] }>(
        `/logs${qs({ level: level === 'all' ? null : level, scope, q, page, pageSize: 30 })}`,
      ),
    placeholderData: (previous) => previous,
    refetchInterval: 30_000,
  })

  const retry = useMutation({
    mutationFn: () => api.post<{ retried: number }>('/queue/retry'),
    onSuccess: ({ retried }) => {
      void client.invalidateQueries({ queryKey: ['queue'] })
      toast.success(
        retried ? `Trying ${plural(retried, 'email')} again now` : 'Nothing was waiting on a retry',
        {
          description: 'Any account that had been told to slow down is also released.',
        },
      )
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const status = queue.data
  const stalled = status
    ? !status.lastTickAt || Date.now() - new Date(status.lastTickAt).getTime() > STALE_MS
    : false
  const waiting = status ? status.queued + status.retrying : 0

  const columns: Column<LogEntry>[] = [
    {
      key: 'time',
      header: 'When',
      width: '11rem',
      cell: (row) => (
        <span className="whitespace-nowrap text-[var(--ds-fg-muted)]" title={row.createdAt}>
          {formatDateTime(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'level',
      header: 'Level',
      width: '6.5rem',
      hideBelow: 'sm',
      cell: (row) => (
        <Badge tone={LEVEL_BADGE[row.level].tone}>{LEVEL_BADGE[row.level].label}</Badge>
      ),
    },
    {
      key: 'scope',
      header: 'Area',
      width: '8rem',
      hideBelow: 'md',
      cell: (row) => <span className="text-[var(--ds-fg-muted)]">{row.scope}</span>,
    },
    {
      key: 'message',
      header: 'What happened',
      cell: (row) => <span className="line-clamp-2 text-[var(--ds-fg)]">{row.message}</span>,
    },
    {
      key: 'who',
      header: 'By',
      width: '9rem',
      hideBelow: 'lg',
      cell: (row) => <span className="text-[var(--ds-fg-muted)]">{row.userName ?? 'Ariad'}</span>,
    },
  ]

  const setFilter = (apply: () => void) => {
    apply()
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex max-w-[40rem] flex-col gap-1">
            <h2 className="text-h3 text-[var(--ds-fg)]">Sending queue</h2>
            <p className="text-body-sm text-[var(--ds-fg-muted)]">
              Mail waiting to go out, and how the last day went. Mail waits when an account is at
              its limit, and is tried again when a server says "not now".
            </p>
          </div>
          <Button
            variant="outlined"
            startIcon={<RotateCw />}
            onClick={() => retry.mutate()}
            loading={retry.isPending}
          >
            Retry now
          </Button>
        </div>

        {queue.isError && <Banner tone="danger">{errorMessage(queue.error)}</Banner>}
        {status && stalled && (
          <Banner tone="warning" title="The background sender is not running">
            {status.lastTickAt
              ? `Its last pass was ${formatRelative(status.lastTickAt)}. `
              : 'It has not made a pass since the server started. '}
            {waiting > 0 ? `${plural(waiting, 'email is', 'emails are')} waiting. ` : ''}
            Restart Ariad, and check it was not started with WORKER=0.
          </Banner>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile label="Waiting" value={status ? formatNumber(status.queued) : '—'} />
          <StatTile label="Sending now" value={status ? formatNumber(status.sending) : '—'} />
          <StatTile label="Waiting to retry" value={status ? formatNumber(status.retrying) : '—'} />
          <StatTile
            label="Sent, last 24 hours"
            value={status ? formatNumber(status.sentLast24h) : '—'}
          />
          <StatTile
            label="Failed, last 24 hours"
            value={status ? formatNumber(status.failedLast24h) : '—'}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex max-w-[40rem] flex-col gap-1">
          <h2 className="text-h3 text-[var(--ds-fg)]">System log</h2>
          <p className="text-body-sm text-[var(--ds-fg-muted)]">
            What Ariad did and who changed what, kept for 90 days.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            className="scrollbar-none flex gap-2 overflow-x-auto py-1"
            role="group"
            aria-label="Level"
          >
            {LEVELS.map((entry) => (
              <FilterChip
                key={entry.value}
                selected={level === entry.value}
                onClick={() => setFilter(() => setLevel(entry.value))}
              >
                {entry.label}
              </FilterChip>
            ))}
          </div>
          <Select
            aria-label="Area"
            size="sm"
            value={scope}
            onChange={(event) => setFilter(() => setScope(event.target.value))}
            options={[
              { value: '', label: 'Every area' },
              ...(logs.data?.scopes ?? []).map((entry) => ({ value: entry, label: entry })),
            ]}
            className="w-40"
          />
          <SearchInput
            value={search}
            onChange={(value) => setFilter(() => setSearch(value))}
            placeholder="Search the log"
            size="sm"
            className="w-full sm:w-64"
          />
        </div>

        {logs.isError && <Banner tone="danger">{errorMessage(logs.error)}</Banner>}

        <Card padding="none" className="overflow-hidden">
          <DataTable
            aria-label="System log"
            columns={columns}
            rows={logs.data?.items ?? []}
            rowKey={(row) => row.id}
            rowLabel={(row) => row.message}
            loading={logs.isPending}
            onRowClick={setOpen}
            dense
            empty={
              <EmptyState
                compact
                title="Nothing logged"
                description={
                  level !== 'all' || scope || q
                    ? 'No entry matches these filters.'
                    : 'Entries appear here as Ariad is used.'
                }
              />
            }
          />
        </Card>
        {logs.data && logs.data.total > logs.data.pageSize && (
          <Pagination
            page={logs.data.page}
            pageSize={logs.data.pageSize}
            total={logs.data.total}
            onPageChange={setPage}
          />
        )}
      </section>

      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        title="Log entry"
        description={open ? formatDateTime(open.createdAt) : undefined}
      >
        {open && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={LEVEL_BADGE[open.level].tone}>{LEVEL_BADGE[open.level].label}</Badge>
              <span className="text-caption text-[var(--ds-fg-muted)]">
                {open.scope} · {open.userName ?? 'Ariad'}
              </span>
            </div>
            <p className="text-body-sm text-[var(--ds-fg)]">{open.message}</p>
            {open.detail && (
              <CodeSnippet label="Details" code={JSON.stringify(open.detail, null, 2)} wrap />
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}
