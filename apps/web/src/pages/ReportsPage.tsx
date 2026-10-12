import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BarChart3 } from 'lucide-react'
import { ratesFrom, type CampaignSummary, type ReportsData } from '@ariad/shared'
import { api, errorMessage } from '@/lib/api'
import { formatCompact, formatDate, formatDay, formatNumber, formatRate, rate } from '@/lib/format'
import { Button } from '@/ui/Button'
import { LineChart } from '@/ui/Chart'
import { SegmentedControl } from '@/ui/Controls'
import { DataTable, type Column, type SortState } from '@/ui/DataTable'
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback'
import { Page, PageHeader } from '@/ui/Shell'
import { StatTile } from '@/ui/Stat'
import { Card } from '@/ui/Surface'
import { CampaignStatusBadge, sentTotal } from './campaignDisplay'
import { Panel } from './Panel'

const RANGES = [
  { value: '7', label: '7 days', words: 'the last 7 days' },
  { value: '30', label: '30 days', words: 'the last 30 days' },
  { value: '90', label: '90 days', words: 'the last 90 days' },
  { value: '365', label: '1 year', words: 'the last year' },
] as const
type RangeValue = (typeof RANGES)[number]['value']

/** What each sortable column is ordered by. Null is a rate with nothing under it, and goes last either way. */
const SORT_VALUE: Record<string, (campaign: CampaignSummary) => number | string | null> = {
  name: (campaign) => campaign.name.toLowerCase(),
  sent: (campaign) => campaign.startedAt ?? '',
  recipients: (campaign) => campaign.stats.recipients,
  delivered: (campaign) => campaign.stats.delivered,
  open: (campaign) => ratesFrom(campaign.stats).openRate,
  click: (campaign) => ratesFrom(campaign.stats).clickRate,
  bounce: (campaign) => ratesFrom(campaign.stats).bounceRate,
  unsubscribe: (campaign) => ratesFrom(campaign.stats).unsubscribeRate,
}

function sortCampaigns(campaigns: CampaignSummary[], sort: SortState): CampaignSummary[] {
  const read = SORT_VALUE[sort.key]
  if (!read) return campaigns
  const flip = sort.dir === 'asc' ? 1 : -1
  return [...campaigns].sort((a, b) => {
    const left = read(a)
    const right = read(b)
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1
    return (left < right ? -1 : left > right ? 1 : 0) * flip
  })
}

/**
 * How the email did over a period: the totals, the shape of the period day by
 * day, and each campaign that went out in it, to compare one with another.
 * The period is in the address, so a report can be bookmarked or sent to someone.
 */
export function ReportsPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const range = RANGES.find((entry) => entry.value === search.get('days')) ?? RANGES[1]
  const [sort, setSort] = useState<SortState>({ key: 'sent', dir: 'desc' })

  const reports = useQuery({
    queryKey: ['reports', range.value],
    queryFn: () => api.get<ReportsData>(`/reports?days=${range.value}`),
    // The last period stays on screen while the next one loads: the page does not blink between two ranges.
    placeholderData: keepPreviousData,
  })
  const data = reports.data
  const setRange = (value: RangeValue) =>
    setSearch(value === '30' ? {} : { days: value }, { replace: true })

  const campaigns = useMemo(() => (data ? sortCampaigns(data.campaigns, sort) : []), [data, sort])
  const chart = useMemo(() => {
    const series = data?.series ?? []
    return [
      { name: 'Sent', points: series.map((point) => ({ x: formatDay(point.day), y: point.sent })) },
      {
        name: 'Opens',
        points: series.map((point) => ({ x: formatDay(point.day), y: point.opens })),
      },
      {
        name: 'Clicks',
        points: series.map((point) => ({ x: formatDay(point.day), y: point.clicks })),
      },
    ]
  }, [data])

  const sent = data ? sentTotal(data.totals) : 0
  const quiet =
    Boolean(data) &&
    sent === 0 &&
    data!.campaigns.length === 0 &&
    !data!.series.some((point) => point.opens + point.clicks > 0)
  const longer = RANGES[RANGES.indexOf(range) + 1]
  const ofDelivered = (value: number | null) =>
    value === null ? 'Nothing delivered' : `${formatRate(value)} of delivered`

  const columns: Column<CampaignSummary>[] = [
    {
      key: 'name',
      header: 'Campaign',
      sortable: true,
      className: 'w-full max-w-0 min-w-32',
      cell: (campaign) => (
        <div className="flex min-w-0 items-center gap-2">
          {/* Wraps where a phone leaves it little room: half a campaign's name tells one from another worse than two lines of it. */}
          <Link
            to={`/campaigns/${campaign.id}`}
            className="min-w-0 rounded-[var(--radius-xs)] text-label text-[var(--ds-fg)] [overflow-wrap:anywhere] hover:underline"
          >
            {campaign.name}
          </Link>
          {campaign.status !== 'sent' && <CampaignStatusBadge status={campaign.status} />}
        </div>
      ),
    },
    {
      key: 'sent',
      header: 'Sent',
      sortable: true,
      hideBelow: 'sm',
      className: 'whitespace-nowrap',
      cell: (campaign) => formatDate(campaign.startedAt),
    },
    {
      key: 'recipients',
      header: 'Recipients',
      sortable: true,
      align: 'right',
      hideBelow: 'md',
      cell: (campaign) => formatNumber(campaign.stats.recipients),
    },
    {
      key: 'delivered',
      header: 'Delivered',
      sortable: true,
      align: 'right',
      hideBelow: 'lg',
      cell: (campaign) => formatNumber(campaign.stats.delivered),
    },
    {
      key: 'open',
      header: 'Open rate',
      sortable: true,
      align: 'right',
      cell: (campaign) => formatRate(ratesFrom(campaign.stats).openRate),
    },
    {
      key: 'click',
      header: 'Click rate',
      sortable: true,
      align: 'right',
      cell: (campaign) => formatRate(ratesFrom(campaign.stats).clickRate),
    },
    {
      key: 'bounce',
      header: 'Bounce rate',
      sortable: true,
      align: 'right',
      hideBelow: 'lg',
      cell: (campaign) => formatRate(ratesFrom(campaign.stats).bounceRate),
    },
    {
      key: 'unsubscribe',
      header: 'Unsubscribe rate',
      sortable: true,
      align: 'right',
      hideBelow: 'lg',
      cell: (campaign) => formatRate(ratesFrom(campaign.stats).unsubscribeRate),
    },
  ]

  return (
    <Page>
      <PageHeader title="Reports" description={`How your email did over ${range.words}.`}>
        <SegmentedControl
          label="Period"
          value={range.value}
          onChange={setRange}
          options={RANGES}
          className="sm:max-w-[22rem]"
        />
      </PageHeader>

      {reports.isError && <Banner tone="danger">{errorMessage(reports.error)}</Banner>}

      {reports.isPending ? (
        <div className="flex flex-col gap-6" aria-busy="true">
          <div className="grid grid-cols-1 gap-3 min-[23rem]:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className="h-[6.5rem] rounded-[var(--radius-xl)]" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-[var(--radius-xl)]" />
        </div>
      ) : !data ? null : quiet ? (
        <Card padding="none">
          <EmptyState
            icon={<BarChart3 />}
            title={`Nothing was sent in ${range.words}`}
            description={
              longer
                ? 'Reports cover the campaigns and automated emails that went out in the period. Look further back, or send a campaign and come back.'
                : 'Reports cover the campaigns and automated emails that went out in the period. Once you send one, how it did shows here.'
            }
            action={
              longer ? (
                <Button variant="outlined" onClick={() => setRange(longer.value)}>
                  Show {longer.words}
                </Button>
              ) : (
                <Button variant="outlined" onClick={() => navigate('/campaigns')}>
                  Go to campaigns
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 min-[23rem]:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Sent" value={formatCompact(sent)} hint={`in ${range.words}`} />
              <StatTile
                label="Delivered"
                value={formatCompact(data.totals.delivered)}
                hint={
                  sent > 0
                    ? `${formatRate(rate(data.totals.delivered, sent))} of sent`
                    : 'Nothing sent'
                }
              />
              <StatTile
                label="Opened"
                value={formatCompact(data.totals.opened)}
                hint={ofDelivered(data.rates.openRate)}
              />
              <StatTile
                label="Clicked"
                value={formatCompact(data.totals.clicked)}
                hint={ofDelivered(data.rates.clickRate)}
              />
              <StatTile
                label="Bounced"
                value={formatCompact(data.totals.bounced)}
                hint={
                  data.rates.bounceRate === null
                    ? 'Nothing sent'
                    : `${formatRate(data.rates.bounceRate)} of sent`
                }
              />
              <StatTile
                label="Unsubscribed"
                value={formatCompact(data.totals.unsubscribed)}
                hint={ofDelivered(data.rates.unsubscribeRate)}
              />
              <StatTile
                label="Complaints"
                value={formatCompact(data.totals.complained)}
                hint={ofDelivered(data.rates.complaintRate)}
              />
            </div>
            <p className="max-w-[80ch] text-caption text-[var(--ds-fg-muted)]">
              Open rate is the people who opened at least once, divided by the emails delivered. It
              is an estimate, because some mail apps block the image an open is counted with and
              others load it before anyone has looked. Delivered means the receiving server accepted
              the email and it has not bounced since.
            </p>
          </div>

          <Panel title="Activity" description={`Sent, opens and clicks by day, ${range.words}`}>
            <LineChart
              series={chart}
              height={280}
              aria-label={`Email activity by day over ${range.words}: ${formatNumber(sent)} sent, ${formatNumber(data.totals.opens)} opens and ${formatNumber(data.totals.clicks)} clicks in all.`}
            />
          </Panel>

          <Panel
            title="Campaign performance"
            description={`Campaigns that started in ${range.words}`}
            flush
          >
            <DataTable
              aria-label="Campaign performance"
              gutter="md"
              columns={columns}
              rows={campaigns}
              rowKey={(campaign) => campaign.id}
              loading={reports.isPlaceholderData}
              sort={sort}
              onSortChange={setSort}
              onRowClick={(campaign) => navigate(`/campaigns/${campaign.id}`)}
              empty={
                <p className="px-5 py-10 text-center text-body-sm text-[var(--ds-fg-muted)]">
                  No campaign started in {range.words}. The totals above are from automated emails.
                </p>
              }
            />
          </Panel>
        </>
      )}
    </Page>
  )
}
