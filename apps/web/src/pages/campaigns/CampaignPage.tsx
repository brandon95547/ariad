import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import type { Campaign } from '@ariad/shared'
import { ApiError, api, errorMessage } from '@/lib/api'
import { Button } from '@/ui/Button'
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback'
import { Page, PageHeader } from '@/ui/Shell'
import { CampaignEditor } from './CampaignEditor'
import { CampaignReport } from './CampaignReport'

/**
 * One campaign. Until it is sent this is the editor; from the moment it starts
 * going out it is the report, because a message people already have is no
 * longer something to edit.
 */
export function CampaignPage() {
  const { id = '' } = useParams()
  const campaign = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api.get<Campaign>(`/campaigns/${id}`),
    // The report keeps itself current while mail is going out.
    refetchInterval: (query) => (query.state.data?.status === 'sending' ? 4000 : false),
  })

  if (campaign.isPending) {
    return (
      <Page>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-10 w-80 max-w-full" />
          <Skeleton className="h-64 rounded-[var(--radius-xl)]" />
        </div>
      </Page>
    )
  }

  if (campaign.isError) {
    const missing = campaign.error instanceof ApiError && campaign.error.status === 404
    return (
      <Page>
        <PageHeader title="Campaign" back={{ to: '/campaigns', label: 'Campaigns' }} />
        {missing ? (
          <EmptyState title="This campaign no longer exists" description="It may have been deleted." />
        ) : (
          <Banner
            tone="danger"
            actions={
              <Button size="sm" variant="outlined" onClick={() => campaign.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(campaign.error)}
          </Banner>
        )}
      </Page>
    )
  }

  const editable = campaign.data.status === 'draft' || campaign.data.status === 'scheduled'
  // Keyed by id so moving to a duplicate starts the editor from that campaign, not this one's state.
  return editable ? <CampaignEditor key={campaign.data.id} campaign={campaign.data} /> : <CampaignReport campaign={campaign.data} />
}
