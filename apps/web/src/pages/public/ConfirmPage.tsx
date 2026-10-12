import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import type { ConfirmationResult } from '@ariad/shared'
import { api } from '@/lib/api'
import { PublicFrame, PublicHeading, PublicLoading, ResultMark, useDocumentTitle } from './PublicFrame'
import { LinkProblem } from './UnsubscribePage'

/**
 * Where "Yes, subscribe me" in a confirmation email leads. Arriving is the
 * confirmation: the click on the link was the decision, and it was made in
 * their own inbox.
 *
 * It is asked through the query cache so it is asked once: an effect runs
 * twice under React's StrictMode, and a second request would be a second
 * confirmation. The cache holds the first answer for as long as the page is open.
 */
export function ConfirmPage() {
  const { token = '' } = useParams()
  const confirmation = useQuery({
    queryKey: ['public', 'confirm', token],
    queryFn: () => api.post<ConfirmationResult>(`/public/confirm/${encodeURIComponent(token)}`),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })

  const organization = confirmation.data?.organization ?? ''
  useDocumentTitle(organization ? `Subscription confirmed · ${organization}` : 'Confirm your subscription')

  // The form they signed up on may have a page of its own to finish at. Replaced,
  // not pushed: Back from there should not land on a confirmation that is already done.
  const redirectUrl = confirmation.data?.redirectUrl
  useEffect(() => {
    if (redirectUrl) window.location.replace(redirectUrl)
  }, [redirectUrl])

  return (
    <PublicFrame organization={organization}>
      {confirmation.isPending ? (
        <PublicLoading />
      ) : confirmation.isError ? (
        <LinkProblem error={confirmation.error} onRetry={() => void confirmation.refetch()} retrying={confirmation.isFetching} />
      ) : (
        <div className="flex flex-col gap-5" role="status">
          <ResultMark tone="success">
            <Check size={22} />
          </ResultMark>
          <PublicHeading title="You are subscribed" focusOnMount>
            {confirmation.data.message && <p className="whitespace-pre-line">{confirmation.data.message}</p>}
            <p>
              <strong className="font-medium text-[var(--ds-fg)]">{confirmation.data.email}</strong> is confirmed
              {organization ? `, and ${organization} can now send you email` : ''}. There is nothing else to do.
            </p>
            <p>You can unsubscribe at any time from the link at the bottom of every email.</p>
          </PublicHeading>
        </div>
      )}
    </PublicFrame>
  )
}
