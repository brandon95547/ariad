import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Copy, Eye, Pause, Play, XCircle } from 'lucide-react'
import {
  roleAtLeast,
  type Campaign,
  type CampaignRecipient,
  type CampaignReport as Report,
  type MessageStatus,
  type Paged,
} from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmailPreview } from '@/features/email/EmailPreview'
import { api, errorMessage, qs } from '@/lib/api'
import { formatDateTime, formatNumber, formatRate, formatRelative, plural, rate } from '@/lib/format'
import { useAuthState } from '@/lib/queries'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { BarList, LineChart } from '@/ui/Chart'
import { FilterChip } from '@/ui/Controls'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { Banner, EmptyState, ProgressBar, Skeleton } from '@/ui/Feedback'
import { Pagination } from '@/ui/Pagination'
import { Page, PageHeader } from '@/ui/Shell'
import { StatTile } from '@/ui/Stat'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'
import { CampaignStatusBadge } from './CampaignsPage'

type RecipientFilter = 'all' | 'opened' | 'clicked' | 'not_opened' | 'bounced' | 'failed' | 'unsubscribed' | 'queued'

const MESSAGE_BADGE: Record<MessageStatus, { tone: 'neutral' | 'success' | 'danger' | 'warning' | 'accent'; label: string }> = {
  queued: { tone: 'neutral', label: 'Waiting' },
  sending: { tone: 'accent', label: 'Sending' },
  sent: { tone: 'success', label: 'Delivered' },
  failed: { tone: 'danger', label: 'Failed' },
  bounced: { tone: 'danger', label: 'Bounced' },
  canceled: { tone: 'neutral', label: 'Not sent' },
}

const hourLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })

/**
 * A campaign after it has gone: how many got it, what they did with it, and
 * who. While it is still going out, the same page shows how far it has got and
 * can pause or stop it.
 */
export function CampaignReport({ campaign }: { campaign: Campaign }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const canEdit = roleAtLeast(useAuthState().data?.user?.role ?? 'viewer', 'editor')
  const [filter, setFilter] = useState<RecipientFilter>('all')
  const [page, setPage] = useState(1)
  const [viewing, setViewing] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const live = campaign.status === 'sending'
  const { stats } = campaign

  const report = useQuery({
    queryKey: ['campaign-report', campaign.id],
    queryFn: () => api.get<Report>(`/campaigns/${campaign.id}/report`),
    refetchInterval: live ? 8000 : false,
  })

  const recipients = useQuery({
    queryKey: ['campaign-recipients', campaign.id, filter, page],
    queryFn: () => api.get<Paged<CampaignRecipient>>(`/campaigns/${campaign.id}/recipients${qs({ filter, page, pageSize: 25 })}`),
    placeholderData: (previous) => previous,
    refetchInterval: live ? 8000 : false,
  })

  const act = useMutation({
    mutationFn: (action: 'pause' | 'resume' | 'cancel') => api.post<Campaign>(`/campaigns/${campaign.id}/${action}`),
    onSuccess: (updated, action) => {
      setCanceling(false)
      client.setQueryData(['campaign', campaign.id], updated)
      void client.invalidateQueries({ queryKey: ['campaigns'] })
      toast.success(action === 'pause' ? 'Paused' : action === 'resume' ? 'Sending again' : 'Canceled', {
        description:
          action === 'pause'
            ? 'Nothing more goes out until you resume it.'
            : action === 'cancel'
              ? 'What was already sent stays sent. The rest will not go out.'
              : undefined,
      })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const duplicate = useMutation({
    mutationFn: () => api.post<Campaign>(`/campaigns/${campaign.id}/duplicate`),
    onSuccess: (copy) => {
      void client.invalidateQueries({ queryKey: ['campaigns'] })
      navigate(`/campaigns/${copy.id}`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const done = stats.recipients - stats.queued
  const attempted = stats.sent + stats.bounced

  const columns: Column<CampaignRecipient>[] = [
    {
      key: 'email',
      header: 'Recipient',
      cell: (row) =>
        row.contactId ? (
          <Link to={`/contacts/${row.contactId}`} className="text-[var(--ds-fg)] underline-offset-2 hover:underline">
            {row.email}
          </Link>
        ) : (
          row.email
        ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '8rem',
      cell: (row) => (
        <span title={row.error ?? undefined}>
          <Badge tone={row.unsubscribedAt ? 'warning' : MESSAGE_BADGE[row.status].tone}>
            {row.unsubscribedAt ? 'Unsubscribed' : MESSAGE_BADGE[row.status].label}
          </Badge>
        </span>
      ),
    },
    { key: 'opens', header: 'Opens', align: 'right', width: '5rem', cell: (row) => (row.openCount ? formatNumber(row.openCount) : '—') },
    { key: 'clicks', header: 'Clicks', align: 'right', width: '5rem', hideBelow: 'sm', cell: (row) => (row.clickCount ? formatNumber(row.clickCount) : '—') },
    {
      key: 'when',
      header: 'Sent',
      width: '13rem',
      hideBelow: 'md',
      cell: (row) => <span className="whitespace-nowrap text-[var(--ds-fg-muted)]">{row.sentAt ? formatDateTime(row.sentAt) : (row.error ?? '—')}</span>,
    },
  ]

  const filters: { value: RecipientFilter; label: string; count?: number }[] = [
    { value: 'all', label: 'Everyone', count: stats.recipients },
    { value: 'opened', label: 'Opened', count: stats.opened },
    { value: 'clicked', label: 'Clicked', count: stats.clicked },
    { value: 'not_opened', label: 'Did not open', count: Math.max(0, stats.delivered - stats.opened) },
    { value: 'bounced', label: 'Bounced', count: stats.bounced },
    { value: 'failed', label: 'Failed', count: stats.failed },
    { value: 'unsubscribed', label: 'Unsubscribed', count: stats.unsubscribed },
    ...(stats.queued > 0 ? [{ value: 'queued' as const, label: 'Waiting', count: stats.queued }] : []),
  ]

  const timeline = report.data?.timeline ?? []

  return (
    <Page>
      <PageHeader
        title={campaign.name}
        back={{ to: '/campaigns', label: 'Campaigns' }}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <CampaignStatusBadge status={campaign.status} />
            <span>
              {campaign.subject}
              {campaign.startedAt ? ` · started ${formatDateTime(campaign.startedAt)}` : ''}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="outlined" startIcon={<Eye />} onClick={() => setViewing(true)}>
              View email
            </Button>
            {canEdit && (
              <Button variant="outlined" startIcon={<Copy />} onClick={() => duplicate.mutate()} loading={duplicate.isPending}>
                Duplicate
              </Button>
            )}
          </>
        }
      />

      {(live || campaign.status === 'paused') && (
        <Card className="flex flex-col gap-4">
          <ProgressBar
            value={done}
            max={Math.max(1, stats.recipients)}
            tone={campaign.status === 'paused' ? 'warning' : 'accent'}
            label={
              campaign.status === 'paused'
                ? `Paused with ${formatNumber(done)} of ${formatNumber(stats.recipients)} sent`
                : `${formatNumber(done)} of ${formatNumber(stats.recipients)} sent`
            }
            showValue
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body-sm text-[var(--ds-fg-muted)]">
              {campaign.status === 'paused'
                ? 'Nothing more goes out until it is resumed.'
                : `${plural(stats.queued, 'email')} still waiting. Mail goes out at the pace the sending account allows.`}
            </p>
            {canEdit && (
              <div className="flex items-center gap-2 coarse:gap-3">
                {live ? (
                  <Button size="sm" variant="outlined" startIcon={<Pause />} onClick={() => act.mutate('pause')} loading={act.isPending && act.variables === 'pause'}>
                    Pause
                  </Button>
                ) : (
                  <Button size="sm" variant="outlined" startIcon={<Play />} onClick={() => act.mutate('resume')} loading={act.isPending && act.variables === 'resume'}>
                    Resume
                  </Button>
                )}
                <Button size="sm" variant="danger-outline" startIcon={<XCircle />} onClick={() => setCanceling(true)}>
                  Cancel the rest
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {campaign.status === 'canceled' && (
        <Banner tone="warning" title="This campaign was canceled before it finished">
          {formatNumber(stats.sent)} of {formatNumber(stats.recipients)} were sent. The rest were not, and will not be.
        </Banner>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Recipients" value={formatNumber(stats.recipients)} hint={stats.failed ? `${formatNumber(stats.failed)} failed` : undefined} />
        <StatTile label="Delivered" value={formatNumber(stats.delivered)} hint={formatRate(rate(stats.delivered, attempted))} />
        <StatTile label="Opened" value={formatRate(rate(stats.opened, stats.delivered))} hint={`${plural(stats.opened, 'person', 'people')}, ${plural(stats.opens, 'open')}`} />
        <StatTile label="Clicked" value={formatRate(rate(stats.clicked, stats.delivered))} hint={`${plural(stats.clicked, 'person', 'people')}, ${plural(stats.clicks, 'click')}`} />
        <StatTile label="Bounced" value={formatRate(rate(stats.bounced, attempted))} hint={plural(stats.bounced, 'address', 'addresses')} />
        <StatTile label="Unsubscribed" value={formatRate(rate(stats.unsubscribed, stats.delivered))} hint={plural(stats.unsubscribed, 'person', 'people')} />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="flex flex-col gap-4">
          <h2 className="text-h4 text-[var(--ds-fg)]">Opens and clicks over time</h2>
          {report.isPending ? (
            <Skeleton className="h-60" />
          ) : report.isError ? (
            <Banner tone="danger">{errorMessage(report.error)}</Banner>
          ) : timeline.length < 2 ? (
            <EmptyState
              compact
              title={campaign.trackOpens || campaign.trackClicks ? 'Nothing to chart yet' : 'Tracking was off for this campaign'}
              description={
                campaign.trackOpens || campaign.trackClicks
                  ? 'Opens and clicks appear here as they come in, usually within the first few hours.'
                  : 'Opens and clicks were not counted, so there is nothing to show.'
              }
            />
          ) : (
            <LineChart
              aria-label="Opens and clicks per hour"
              series={[
                { name: 'Opens', points: timeline.map((point) => ({ x: hourLabel.format(new Date(point.at)), y: point.opens })) },
                { name: 'Clicks', points: timeline.map((point) => ({ x: hourLabel.format(new Date(point.at)), y: point.clicks })) },
              ]}
            />
          )}
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="text-h4 text-[var(--ds-fg)]">Links clicked</h2>
          {report.isPending ? (
            <Skeleton className="h-40" />
          ) : (report.data?.links.length ?? 0) === 0 ? (
            <EmptyState compact title="No clicks yet" description="Each link in the email is listed here once someone clicks it." />
          ) : (
            <BarList
              items={report.data!.links.map((link) => ({
                label: link.url.replace(/^https?:\/\//, ''),
                value: link.clicks,
                hint: plural(link.people, 'person', 'people'),
              }))}
              valueFormat={(value) => plural(value, 'click')}
            />
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-h3 text-[var(--ds-fg)]">Recipients</h2>
        <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
          {filters.map((entry) => (
            <FilterChip
              key={entry.value}
              selected={filter === entry.value}
              count={entry.count}
              onClick={() => {
                setFilter(entry.value)
                setPage(1)
              }}
            >
              {entry.label}
            </FilterChip>
          ))}
        </div>
        {recipients.isError && <Banner tone="danger">{errorMessage(recipients.error)}</Banner>}
        <Card padding="none" className="overflow-hidden">
          <DataTable
            aria-label="Recipients"
            columns={columns}
            rows={recipients.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={recipients.isPending}
            empty={<EmptyState compact title="Nobody here" description="No recipient matches this filter." />}
          />
        </Card>
        {recipients.data && recipients.data.total > recipients.data.pageSize && (
          <Pagination page={recipients.data.page} pageSize={recipients.data.pageSize} total={recipients.data.total} onPageChange={setPage} />
        )}
        {campaign.finishedAt && (
          <p className="text-caption text-[var(--ds-fg-muted)]">
            Finished {formatRelative(campaign.finishedAt)}. Open rate is people who opened ÷ delivered; it is an estimate, because mail apps
            block or pre-load images.
          </p>
        )}
      </div>

      <Dialog open={viewing} onClose={() => setViewing(false)} title={campaign.subject || campaign.name} description="As it was sent, with sample details in place of each person's own." size="lg">
        <ViewEmail id={campaign.id} />
      </Dialog>

      <ConfirmDialog
        open={canceling}
        onClose={() => setCanceling(false)}
        onConfirm={() => act.mutate('cancel')}
        title="Cancel the rest of this campaign?"
        confirmLabel="Cancel campaign"
        loading={act.isPending && act.variables === 'cancel'}
      >
        <p>
          {plural(stats.queued, 'person', 'people')} who have not been sent it yet will not get it. The {formatNumber(done)} already sent cannot
          be taken back. A canceled campaign cannot be resumed.
        </p>
      </ConfirmDialog>
    </Page>
  )
}

function ViewEmail({ id }: { id: string }) {
  const preview = useQuery({
    queryKey: ['campaign-preview', id],
    queryFn: () => api.get<{ subject: string; html: string }>(`/campaigns/${id}/preview`),
  })
  if (preview.isPending) return <Skeleton className="h-96" />
  if (preview.isError) return <Banner tone="danger">{errorMessage(preview.error)}</Banner>
  return <EmailPreview html={preview.data.html} merged />
}
