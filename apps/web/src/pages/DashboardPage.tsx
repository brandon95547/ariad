import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { BarChart3, Check, Megaphone, Plus } from 'lucide-react'
import {
  ratesFrom,
  roleAtLeast,
  type CampaignSummary,
  type DashboardData,
  type Role,
  type SetupStep,
} from '@ariad/shared'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import {
  formatCompact,
  formatDate,
  formatDay,
  formatNumber,
  formatRate,
  formatRelative,
  plural,
} from '@/lib/format'
import { useAuthState } from '@/lib/queries'
import { Button } from '@/ui/Button'
import { LineChart } from '@/ui/Chart'
import { DataTable, type Column } from '@/ui/DataTable'
import { StatusDot } from '@/ui/Display'
import { Banner, EmptyState, ProgressBar, Skeleton } from '@/ui/Feedback'
import { Page, PageHeader } from '@/ui/Shell'
import { StatTile } from '@/ui/Stat'
import { Card } from '@/ui/Surface'
import { CampaignStatusBadge, senderStopped, sentTotal } from './campaignDisplay'
import { Panel } from './Panel'

/** What the button on each setup step says, and who is allowed to press it. */
const STEP_ACTIONS: Record<SetupStep['key'], { label: string; role: Role }> = {
  account: { label: 'Connect an account', role: 'admin' },
  organization: { label: 'Add your address', role: 'admin' },
  public_url: { label: 'Set the public URL', role: 'admin' },
  contacts: { label: 'Add contacts', role: 'editor' },
  campaign: { label: 'Create a campaign', role: 'editor' },
}

const linkClass =
  'rounded-[var(--radius-xs)] text-[var(--ds-accent-text)] underline underline-offset-2 hover:text-[var(--ds-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]'

/**
 * The first screen: is everything all right, and what is there to do next.
 *
 * Until Ariad can actually send — an account, an address, a public URL,
 * contacts, a first campaign — the next thing to do is the setup list, and its
 * first open step is the page's one filled button. After that the page is the
 * last 30 days: who you can reach, what went out, and how it was received.
 */
export function DashboardPage() {
  const navigate = useNavigate()
  const role = useAuthState().data?.user?.role ?? 'viewer'
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
    refetchInterval: 60_000,
  })
  const data = dashboard.data

  const settingUp = data ? data.setup.some((step) => !step.done) : false
  const canSend = roleAtLeast(role, 'editor')

  return (
    <Page>
      <PageHeader
        title="Dashboard"
        description={
          data
            ? `The last 30 days. Updated ${formatRelative(new Date(dashboard.dataUpdatedAt).toISOString())}.`
            : 'The last 30 days.'
        }
        actions={
          data && !settingUp && canSend ? (
            <Button startIcon={<Plus />} onClick={() => navigate('/campaigns')}>
              New campaign
            </Button>
          ) : undefined
        }
      />

      {dashboard.isError && <Banner tone="danger">{errorMessage(dashboard.error)}</Banner>}

      {dashboard.isPending ? (
        <DashboardSkeleton />
      ) : data ? (
        <DashboardBody data={data} role={role} readAt={dashboard.dataUpdatedAt} />
      ) : null}
    </Page>
  )
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="grid grid-cols-1 gap-3 min-[23rem]:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-[6.5rem] rounded-[var(--radius-xl)]" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-[var(--radius-xl)]" />
    </div>
  )
}

function DashboardBody({
  data,
  role,
  readAt,
}: {
  data: DashboardData
  role: Role
  readAt: number
}) {
  const navigate = useNavigate()
  const { contacts, totals, rates, series, queue } = data
  const settingUp = data.setup.some((step) => !step.done)
  const sent = sentTotal(totals)
  const anyActivity =
    sent > 0 || series.some((point) => point.sent + point.opens + point.clicks > 0)
  const anyNewContacts = series.some((point) => point.newContacts > 0)
  // A new install: nothing to count yet, so the page is the setup list and one line about what will be here.
  const blank = contacts.total === 0 && !anyActivity && data.recentCampaigns.length === 0

  const activity = useMemo(
    () => [
      { name: 'Sent', points: series.map((point) => ({ x: formatDay(point.day), y: point.sent })) },
      {
        name: 'Opens',
        points: series.map((point) => ({ x: formatDay(point.day), y: point.opens })),
      },
      {
        name: 'Clicks',
        points: series.map((point) => ({ x: formatDay(point.day), y: point.clicks })),
      },
    ],
    [series],
  )
  const growth = useMemo(
    () => [
      {
        name: 'New contacts',
        points: series.map((point) => ({ x: formatDay(point.day), y: point.newContacts })),
      },
    ],
    [series],
  )
  const opens = series.reduce((sum, point) => sum + point.opens, 0)
  const clicks = series.reduce((sum, point) => sum + point.clicks, 0)
  const stopped = senderStopped(queue, readAt)

  const campaignColumns: Column<CampaignSummary>[] = [
    {
      key: 'name',
      header: 'Campaign',
      className: 'w-full max-w-0',
      cell: (campaign) => (
        <div className="flex min-w-0 flex-col">
          <Link
            to={`/campaigns/${campaign.id}`}
            className="truncate rounded-[var(--radius-xs)] text-label text-[var(--ds-fg)] hover:underline"
          >
            {campaign.name}
          </Link>
          <span className="truncate text-caption text-[var(--ds-fg-muted)]">
            {campaign.startedAt
              ? `Sent ${formatDate(campaign.startedAt)}`
              : campaign.scheduledAt
                ? `Scheduled for ${formatDate(campaign.scheduledAt)}`
                : `Edited ${formatRelative(campaign.updatedAt)}`}
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (campaign) => <CampaignStatusBadge status={campaign.status} />,
    },
    {
      key: 'open',
      header: 'Open rate',
      align: 'right',
      hideBelow: 'sm',
      cell: (campaign) => formatRate(ratesFrom(campaign.stats).openRate),
    },
    {
      key: 'click',
      header: 'Click rate',
      align: 'right',
      hideBelow: 'sm',
      cell: (campaign) => formatRate(ratesFrom(campaign.stats).clickRate),
    },
  ]

  return (
    <>
      {settingUp && <SetupChecklist steps={data.setup} role={role} />}

      {stopped && (
        <Banner tone="warning" title="The background sender is not running">
          {queue.lastTickAt
            ? `It last ran ${formatRelative(queue.lastTickAt)}.`
            : 'It has not run since Ariad started.'}{' '}
          Nothing in the queue goes out until it is back. Restarting Ariad starts it again
          {roleAtLeast(role, 'admin') ? (
            <>
              ; the{' '}
              <Link to="/settings/logs" className={linkClass}>
                system logs
              </Link>{' '}
              say why it stopped.
            </>
          ) : (
            '.'
          )}
        </Banner>
      )}

      {blank ? (
        <Card padding="none">
          <EmptyState
            icon={<BarChart3 />}
            title="Nothing to report yet"
            description="Once you have contacts and a campaign has gone out, this is where you see who opened it, who clicked, and how your audience is growing."
          />
        </Card>
      ) : (
        <>
          <div
            className={cn(
              'grid grid-cols-1 gap-3 min-[23rem]:grid-cols-2',
              anyActivity && 'lg:grid-cols-3',
            )}
          >
            <StatTile
              label="Subscribed contacts"
              value={formatCompact(contacts.subscribed)}
              hint={
                contacts.newLast30Days > 0
                  ? `${formatNumber(contacts.newLast30Days)} new in the last 30 days`
                  : 'None new in the last 30 days'
              }
            />
            <StatTile
              label="Emails sent"
              value={formatCompact(sent)}
              hint={
                sent > 0
                  ? `${formatNumber(totals.delivered)} delivered`
                  : 'None in the last 30 days'
              }
            />
            {/* Rates of nothing are not zero, they are not there: the four tiles wait for a first send. */}
            {anyActivity && (
              <>
                <StatTile
                  label="Open rate"
                  value={formatRate(rates.openRate)}
                  hint={`${plural(totals.opened, 'person', 'people')} opened`}
                />
                <StatTile
                  label="Click rate"
                  value={formatRate(rates.clickRate)}
                  hint={`${plural(totals.clicked, 'person', 'people')} clicked`}
                />
                <StatTile
                  label="Unsubscribe rate"
                  value={formatRate(rates.unsubscribeRate)}
                  hint={`${formatNumber(totals.unsubscribed)} unsubscribed`}
                />
                <StatTile
                  label="Bounce rate"
                  value={formatRate(rates.bounceRate)}
                  hint={`${formatNumber(totals.bounced)} bounced`}
                />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Panel
              title="Email activity"
              description="Sent, opens and clicks by day"
              className="lg:col-span-2"
            >
              {anyActivity ? (
                <LineChart
                  series={activity}
                  height={240}
                  aria-label={`Email activity by day over the last 30 days: ${formatNumber(sent)} sent, ${formatNumber(opens)} opens and ${formatNumber(clicks)} clicks in all.`}
                />
              ) : (
                <EmptyState
                  compact
                  icon={<Megaphone />}
                  title="No email in the last 30 days"
                  description="When a campaign goes out, what was sent, opened and clicked shows here day by day."
                />
              )}
            </Panel>

            <Panel title="Audience growth" description="New contacts by day">
              {anyNewContacts ? (
                <LineChart
                  series={growth}
                  height={240}
                  aria-label={`New contacts by day over the last 30 days: ${formatNumber(contacts.newLast30Days)} in all.`}
                />
              ) : (
                <p className="grid h-full min-h-24 place-items-center text-center text-body-sm text-[var(--ds-fg-muted)]">
                  Nobody new in the last 30 days.
                </p>
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Panel
              title="Recent campaigns"
              flush
              className="lg:col-span-2"
              actions={
                data.recentCampaigns.length > 0 ? (
                  <Button variant="text" size="sm" onClick={() => navigate('/campaigns')}>
                    All campaigns
                  </Button>
                ) : undefined
              }
            >
              <DataTable
                aria-label="Recent campaigns"
                gutter="md"
                columns={campaignColumns}
                rows={data.recentCampaigns}
                rowKey={(campaign) => campaign.id}
                onRowClick={(campaign) => navigate(`/campaigns/${campaign.id}`)}
                empty={
                  <EmptyState
                    compact
                    icon={<Megaphone />}
                    title="No campaigns yet"
                    description="The campaigns you write and send show here, with how each one did."
                    action={
                      <Button variant="outlined" size="sm" onClick={() => navigate('/campaigns')}>
                        Go to campaigns
                      </Button>
                    }
                  />
                }
              />
            </Panel>

            <Panel
              title="Sending queue"
              description="Mail waiting to go out, and the last 24 hours"
            >
              <div className="flex flex-col gap-4">
                <p className="flex items-center gap-2 text-body-sm text-[var(--ds-fg)]">
                  <StatusDot
                    tone={stopped ? 'warning' : 'success'}
                    pulse={!stopped && queue.sending > 0}
                  />
                  {stopped
                    ? 'The sender is not running'
                    : queue.sending > 0
                      ? 'Sending now'
                      : queue.queued > 0
                        ? 'Waiting on sending limits'
                        : 'Up to date'}
                </p>
                <dl className="flex flex-col divide-y divide-[var(--ds-border-subtle)] border-t border-[var(--ds-border-subtle)]">
                  {[
                    { label: 'Queued', value: queue.queued },
                    { label: 'Sending now', value: queue.sending },
                    { label: 'Waiting to retry', value: queue.retrying },
                    { label: 'Sent in 24 hours', value: queue.sentLast24h },
                    {
                      label: 'Failed in 24 hours',
                      value: queue.failedLast24h,
                      bad: queue.failedLast24h > 0,
                    },
                  ].map((row) => (
                    <div key={row.label} className="flex items-baseline justify-between gap-4 py-2">
                      <dt className="text-body-sm text-[var(--ds-fg-secondary)]">{row.label}</dt>
                      <dd
                        data-tabular
                        className={cn(
                          'text-label',
                          row.bad ? 'text-[var(--ds-danger-text)]' : 'text-[var(--ds-fg)]',
                        )}
                      >
                        {formatNumber(row.value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  )
}

/**
 * What stands between a new install and a first campaign, in the order to do
 * it. The first open step carries the page's filled button; the rest are there
 * to be read and can be opened out of order.
 */
function SetupChecklist({ steps, role }: { steps: SetupStep[]; role: Role }) {
  const navigate = useNavigate()
  const done = steps.filter((step) => step.done).length
  const next = steps.find((step) => !step.done)
  const blocked = next ? !roleAtLeast(role, STEP_ACTIONS[next.key].role) : false

  return (
    <Card as="section" className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 text-[var(--ds-fg)]">Get set up</h2>
          <p className="text-body-sm text-[var(--ds-fg-muted)]">
            {done === 0
              ? 'Five steps to your first campaign.'
              : `${done} of ${steps.length} done. ${steps.length - done === 1 ? 'One to go.' : `${steps.length - done} to go.`}`}
            {blocked ? ' The next one needs an admin.' : ''}
          </p>
        </div>
        <ProgressBar
          value={done}
          max={steps.length}
          tone={done === steps.length ? 'success' : 'accent'}
        />
      </div>

      <ol className="flex flex-col divide-y divide-[var(--ds-border-subtle)] border-t border-[var(--ds-border-subtle)]">
        {steps.map((step, index) => {
          const action = STEP_ACTIONS[step.key]
          const allowed = roleAtLeast(role, action.role)
          const isNext = step.key === next?.key
          return (
            <li
              key={step.key}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3.5 last:pb-0"
            >
              <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
                <span
                  className={cn(
                    'mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full text-label-sm',
                    step.done
                      ? 'bg-[var(--ds-success-subtle)] text-[var(--ds-success-text)]'
                      : isNext
                        ? 'bg-[var(--ds-accent-subtle)] text-[var(--ds-accent-text)]'
                        : 'bg-[var(--ds-layer-active)] text-[var(--ds-fg-secondary)]',
                  )}
                  aria-hidden
                >
                  {step.done ? <Check size={14} strokeWidth={2.5} /> : index + 1}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p
                    className={cn(
                      'text-label',
                      step.done ? 'text-[var(--ds-fg-secondary)]' : 'text-[var(--ds-fg)]',
                    )}
                  >
                    {step.title}
                    <span className="sr-only-ds">{step.done ? ' (done)' : ' (to do)'}</span>
                  </p>
                  <p className="text-caption text-[var(--ds-fg-muted)]">{step.description}</p>
                </div>
              </div>
              {!step.done && allowed && (
                <Button
                  variant={isNext ? 'filled' : 'outlined'}
                  size={isNext ? 'md' : 'sm'}
                  className="ml-9 sm:ml-0"
                  onClick={() => navigate(step.to)}
                >
                  {action.label}
                </Button>
              )}
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
