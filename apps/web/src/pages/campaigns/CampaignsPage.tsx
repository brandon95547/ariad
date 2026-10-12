import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Copy, Megaphone, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import {
  CAMPAIGN_STATUS_LABELS,
  defaultDesign,
  roleAtLeast,
  type Campaign,
  type CampaignStatus,
  type CampaignSummary,
  type Paged,
  type Template,
  type TemplateSummary,
} from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { api, errorMessage, qs } from '@/lib/api'
import { formatDate, formatDateTime, formatNumber, formatRate, rate } from '@/lib/format'
import { useDebounced } from '@/lib/hooks'
import { useAuthState } from '@/lib/queries'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Controls'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { Banner, EmptyState } from '@/ui/Feedback'
import { RadioGroup, SearchInput, TextInput } from '@/ui/Inputs'
import { ActionMenu } from '@/ui/Menu'
import { Pagination } from '@/ui/Pagination'
import { Page, PageHeader } from '@/ui/Shell'
import { Card } from '@/ui/Surface'
import { Tabs } from '@/ui/Tabs'
import { toast } from '@/ui/Toast'

export const CAMPAIGN_TONES: Record<
  CampaignStatus,
  'neutral' | 'info' | 'accent' | 'warning' | 'success'
> = {
  draft: 'neutral',
  scheduled: 'info',
  sending: 'accent',
  paused: 'warning',
  sent: 'success',
  canceled: 'neutral',
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge tone={CAMPAIGN_TONES[status]} dot={status === 'sending'}>
      {CAMPAIGN_STATUS_LABELS[status]}
    </Badge>
  )
}

/** The date that matters for where a campaign is in its life. */
export function campaignWhen(campaign: CampaignSummary): string {
  if (campaign.status === 'scheduled') return `Sends ${formatDateTime(campaign.scheduledAt)}`
  if (campaign.startedAt) return `Sent ${formatDate(campaign.startedAt)}`
  return `Edited ${formatDate(campaign.updatedAt)}`
}

type StatusTab = 'all' | 'draft' | 'scheduled' | 'sending' | 'sent'
const TABS: { value: StatusTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'sending', label: 'Sending' },
  { value: 'sent', label: 'Sent' },
]

/** Campaigns: every email sent to a group at once, and the ones still being written. */
export function CampaignsPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const canEdit = roleAtLeast(useAuthState().data?.user?.role ?? 'viewer', 'editor')
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as StatusTab | null) ?? 'all'
  const page = Number(params.get('page') ?? 1)
  const [search, setSearch] = useState(params.get('q') ?? '')
  const q = useDebounced(search)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<CampaignSummary | null>(null)

  const setParam = (next: Record<string, string | null>) => {
    const copy = new URLSearchParams(params)
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') copy.delete(key)
      else copy.set(key, value)
    }
    setParams(copy, { replace: true })
  }

  const campaigns = useQuery({
    queryKey: ['campaigns', { status, q, page }],
    queryFn: () =>
      api.get<Paged<CampaignSummary>>(
        `/campaigns${qs({ status: status === 'all' ? null : status, q, page, pageSize: 20 })}`,
      ),
    placeholderData: (previous) => previous,
    // A campaign that is going out changes by the second.
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => item.status === 'sending') ? 5000 : false,
  })

  const duplicate = useMutation({
    mutationFn: (id: string) => api.post<Campaign>(`/campaigns/${id}/duplicate`),
    onSuccess: (copy) => {
      void client.invalidateQueries({ queryKey: ['campaigns'] })
      navigate(`/campaigns/${copy.id}`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (campaign: CampaignSummary) => api.delete(`/campaigns/${campaign.id}`),
    onSuccess: (_result, campaign) => {
      setRemoving(null)
      void client.invalidateQueries({ queryKey: ['campaigns'] })
      toast.success(`${campaign.name} deleted`)
    },
  })

  const columns: Column<CampaignSummary>[] = [
    {
      key: 'name',
      header: 'Campaign',
      cell: (row) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-label text-[var(--ds-fg)]">{row.name}</span>
          <span className="truncate text-caption text-[var(--ds-fg-muted)]">
            {row.subject || 'No subject yet'}
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '8rem',
      cell: (row) => <CampaignStatusBadge status={row.status} />,
    },
    {
      key: 'recipients',
      header: 'Recipients',
      align: 'right',
      width: '7rem',
      hideBelow: 'sm',
      cell: (row) => (row.stats.recipients ? formatNumber(row.stats.recipients) : '—'),
    },
    {
      key: 'opens',
      header: 'Opened',
      align: 'right',
      width: '6rem',
      hideBelow: 'md',
      cell: (row) => formatRate(rate(row.stats.opened, row.stats.delivered)),
    },
    {
      key: 'clicks',
      header: 'Clicked',
      align: 'right',
      width: '6rem',
      hideBelow: 'md',
      cell: (row) => formatRate(rate(row.stats.clicked, row.stats.delivered)),
    },
    {
      key: 'when',
      header: 'When',
      width: '11rem',
      hideBelow: 'lg',
      cell: (row) => <span className="text-[var(--ds-fg-muted)]">{campaignWhen(row)}</span>,
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: <span className="sr-only-ds">Actions</span>,
            width: '3rem',
            align: 'right' as const,
            cell: (row: CampaignSummary) => (
              <span data-row-ignore>
                <ActionMenu
                  label={`Actions for ${row.name}`}
                  icon={<MoreHorizontal size={16} />}
                  actions={[
                    {
                      id: 'duplicate',
                      label: 'Duplicate',
                      icon: <Copy size={14} />,
                      onSelect: () => duplicate.mutate(row.id),
                    },
                    {
                      id: 'delete',
                      label: 'Delete',
                      icon: <Trash2 size={14} />,
                      danger: true,
                      separated: true,
                      disabled: row.status === 'sending',
                      title: row.status === 'sending' ? 'Pause or cancel it first' : undefined,
                      onSelect: () => {
                        remove.reset()
                        setRemoving(row)
                      },
                    },
                  ]}
                />
              </span>
            ),
          },
        ]
      : []),
  ]

  const data = campaigns.data
  const nothingAtAll = data && data.total === 0 && status === 'all' && !q

  return (
    <Page>
      <PageHeader
        title="Campaigns"
        description="An email sent once, to a group you choose."
        actions={
          canEdit && !nothingAtAll ? (
            <Button startIcon={<Plus />} onClick={() => setCreating(true)}>
              New campaign
            </Button>
          ) : undefined
        }
      >
        {!nothingAtAll && (
          <div className="flex flex-col gap-4">
            <Tabs
              aria-label="Campaign status"
              tabs={TABS}
              value={status}
              onChange={(value) => setParam({ status: value === 'all' ? null : value, page: null })}
            />
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value)
                setParam({ q: value || null, page: null })
              }}
              placeholder="Search campaigns"
              className="max-w-[22rem]"
            />
          </div>
        )}
      </PageHeader>

      {campaigns.isError && <Banner tone="danger">{errorMessage(campaigns.error)}</Banner>}

      {nothingAtAll ? (
        <Card padding="none">
          <EmptyState
            icon={<Megaphone />}
            title="No campaigns yet"
            description="Write an email, choose who gets it, and send it now or schedule it for later."
            action={
              canEdit ? (
                <Button startIcon={<Plus />} onClick={() => setCreating(true)}>
                  New campaign
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <Card padding="none" className="overflow-hidden">
            <DataTable
              aria-label="Campaigns"
              columns={columns}
              rows={data?.items ?? []}
              rowKey={(row) => row.id}
              loading={campaigns.isPending}
              onRowClick={(row) => navigate(`/campaigns/${row.id}`)}
              empty={
                <EmptyState
                  compact
                  title="Nothing here"
                  description={
                    q
                      ? `No campaign matches "${q}".`
                      : `There are no ${TABS.find((tab) => tab.value === status)?.label.toLowerCase()} campaigns.`
                  }
                  action={
                    <Button
                      variant="outlined"
                      size="sm"
                      onClick={() => {
                        setSearch('')
                        setParams({}, { replace: true })
                      }}
                    >
                      Show all campaigns
                    </Button>
                  }
                />
              }
            />
          </Card>
          {data && data.total > data.pageSize && (
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={(next) => setParam({ page: String(next) })}
            />
          )}
        </>
      )}

      <NewCampaignDialog open={creating} onClose={() => setCreating(false)} />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title={`Delete ${removing?.name ?? 'campaign'}?`}
        confirmLabel="Delete campaign"
        loading={remove.isPending}
      >
        <p>
          {removing && removing.stats.recipients > 0
            ? 'Its report goes with it: who it was sent to, and who opened and clicked. Contacts keep their own history of everything else.'
            : 'This draft and its content will be gone.'}
        </p>
        {remove.isError && <Banner tone="danger">{errorMessage(remove.error)}</Banner>}
      </ConfirmDialog>
    </Page>
  )
}

/** Name it, choose what to start from, and go straight to the editor. */
function NewCampaignDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [name, setName] = useState('')
  const [start, setStart] = useState('blank')
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<TemplateSummary[]>('/templates'),
    enabled: open,
  })

  const create = useMutation({
    mutationFn: async () => {
      if (start === 'blank') {
        return api.post<Campaign>('/campaigns', { name, design: defaultDesign() })
      }
      const template = await api.get<Template>(`/templates/${start}`)
      return api.post<Campaign>('/campaigns', {
        name,
        subject: template.subject,
        preheader: template.preheader,
        design: template.design,
        html: template.html,
      })
    },
    onSuccess: (campaign) => {
      void client.invalidateQueries({ queryKey: ['campaigns'] })
      onClose()
      setName('')
      setStart('blank')
      navigate(`/campaigns/${campaign.id}`)
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
      title="New campaign"
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-campaign"
            loading={create.isPending}
            disabled={!name.trim()}
          >
            Create campaign
          </Button>
        </>
      }
    >
      <form id="new-campaign" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {create.isError && <Banner tone="danger">{errorMessage(create.error)}</Banner>}
        <Field label="Campaign name" hint="Only you see this. The subject line comes next.">
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="October newsletter"
            autoFocus
          />
        </Field>
        <RadioGroup
          label="Start from"
          value={start}
          onChange={setStart}
          options={[
            {
              value: 'blank',
              label: 'A blank email',
              description: 'A heading, a paragraph and a button to build on.',
            },
            ...(templates.data ?? []).map((template) => ({
              value: template.id,
              label: template.name,
              description: template.description ?? undefined,
            })),
          ]}
        />
        <p className="text-caption text-[var(--ds-fg-muted)]">
          Templates are managed on the{' '}
          <Link
            to="/templates"
            className="text-[var(--ds-accent-text)] underline underline-offset-2"
          >
            Templates
          </Link>{' '}
          page.
        </p>
      </form>
    </Dialog>
  )
}
