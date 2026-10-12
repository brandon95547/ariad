import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Check, Eye, Link2Off } from 'lucide-react'
import { UNSUBSCRIBE_REASONS, type PublicPreferences } from '@ariad/shared'
import { ApiError, api, errorMessage, qs } from '@/lib/api'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Controls'
import { Banner } from '@/ui/Feedback'
import { RadioGroup, Textarea } from '@/ui/Inputs'
import {
  PublicFrame,
  PublicHeading,
  PublicLoading,
  ResultMark,
  publicLinkClass,
  useDocumentTitle,
} from './PublicFrame'

export const preferencesKey = (token: string) => ['public', 'preferences', token] as const

/** Test emails carry this in place of a contact's token: there is nobody to unsubscribe. */
export const PREVIEW_TOKEN = 'preview'

const Strong = ({ children }: { children: string }) => (
  <strong className="font-medium text-[var(--ds-fg)]">{children}</strong>
)

/** What the link in a test email leads to. */
export function PreviewNote({ what }: { what: string }) {
  return (
    <div className="flex flex-col gap-5">
      <ResultMark tone="info">
        <Eye size={22} />
      </ResultMark>
      <PublicHeading title="This is a preview link">
        <p>
          It came from a test email, so it does nothing. In a real email, this is where the person
          who got it would {what}.
        </p>
      </PublicHeading>
    </div>
  )
}

/** A link that leads nowhere, or a server that did not answer: which one decides whether trying again can help. */
export function LinkProblem({
  error,
  onRetry,
  retrying,
}: {
  error: unknown
  onRetry: () => void
  retrying: boolean
}) {
  const badLink = error instanceof ApiError && error.status >= 400 && error.status < 500
  return (
    <div className="flex flex-col gap-5">
      <ResultMark tone="neutral">
        <Link2Off size={22} />
      </ResultMark>
      {badLink ? (
        <PublicHeading title="This link does not work">
          <p>
            It may have been cut short when it was copied, or it belongs to an address that has
            since been removed.
          </p>
          <p>Try the link at the bottom of the most recent email you got.</p>
        </PublicHeading>
      ) : (
        <>
          <PublicHeading title="This page could not load">
            <p>{errorMessage(error)}</p>
          </PublicHeading>
          <Button variant="outlined" size="lg" fullWidth onClick={onRetry} loading={retrying}>
            Try again
          </Button>
        </>
      )}
    </div>
  )
}

/** Asked after the fact, and never required: leaving takes one tap, saying why is a favor. */
function ReasonForm({
  onSend,
  sending,
  error,
}: {
  onSend: (reason: string, comment: string) => void
  sending: boolean
  error: string | null
}) {
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (reason) onSend(reason, comment)
      }}
    >
      <RadioGroup
        label="Mind telling us why? You can skip this."
        value={reason}
        onChange={setReason}
        options={UNSUBSCRIBE_REASONS.map(({ key, label }) => ({ value: key, label }))}
      />
      {reason && (
        <>
          <Field label="Anything to add?" optional>
            <Textarea
              rows={2}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={1000}
            />
          </Field>
          {error && <Banner tone="danger">{error}</Banner>}
          <Button type="submit" variant="tonal" size="lg" fullWidth loading={sending}>
            Send
          </Button>
        </>
      )}
    </form>
  )
}

/**
 * Where the unsubscribe link in an email leads.
 *
 * Opening the page changes nothing: link scanners and mail previews open every
 * link in a message, so the unsubscribe is a button a person presses. One
 * press, no questions first; why they left is asked afterwards, and the way
 * back is on the same screen for whoever pressed it by mistake.
 */
export function UnsubscribePage() {
  const { token = '' } = useParams()
  const [search] = useSearchParams()
  const message = search.get('m')
  const client = useQueryClient()
  const isPreview = token === PREVIEW_TOKEN
  const path = encodeURIComponent(token)

  const prefs = useQuery({
    queryKey: preferencesKey(token),
    queryFn: () => api.get<PublicPreferences>(`/public/preferences/${path}`),
    enabled: !isPreview,
    refetchOnWindowFocus: false,
  })
  // What was done on this visit, which is not the same as how things stand:
  // "you are unsubscribed" and "you were already" are different pages.
  const [outcome, setOutcome] = useState<'unsubscribed' | 'resubscribed' | null>(null)
  const [reasonSent, setReasonSent] = useState(false)

  const store = (next: PublicPreferences) => client.setQueryData(preferencesKey(token), next)

  const unsubscribe = useMutation({
    mutationFn: () =>
      api.post<PublicPreferences>(`/public/unsubscribe/${path}${qs({ m: message })}`),
    onSuccess: (next) => {
      store(next)
      setOutcome('unsubscribed')
    },
  })
  const giveReason = useMutation({
    mutationFn: (input: { reason: string; comment: string }) =>
      api.post<PublicPreferences>(`/public/unsubscribe/${path}${qs({ m: message })}`, input),
    onSuccess: () => setReasonSent(true),
  })
  const resubscribe = useMutation({
    mutationFn: () => api.post<PublicPreferences>(`/public/resubscribe/${path}`),
    onSuccess: (next) => {
      store(next)
      setOutcome('resubscribed')
    },
  })

  const organization = prefs.data?.organization ?? ''
  const sender = organization || 'this sender'
  useDocumentTitle(organization ? `Unsubscribe · ${organization}` : 'Unsubscribe')

  let body
  if (isPreview) {
    body = <PreviewNote what="unsubscribe with one tap" />
  } else if (prefs.isPending) {
    body = <PublicLoading />
  } else if (prefs.isError) {
    body = (
      <LinkProblem
        error={prefs.error}
        onRetry={() => void prefs.refetch()}
        retrying={prefs.isFetching}
      />
    )
  } else if (prefs.data.status === 'unsubscribed') {
    const justNow = outcome === 'unsubscribed'
    body = (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-5" role="status">
          <ResultMark tone="success">
            <Check size={22} />
          </ResultMark>
          <PublicHeading
            title={justNow ? 'You are unsubscribed' : 'You are already unsubscribed'}
            focusOnMount={justNow}
          >
            <p>
              <Strong>{prefs.data.email}</Strong> will not get any more email from {sender}.
              {justNow ? ' This takes effect now.' : ''}
            </p>
          </PublicHeading>
        </div>

        {justNow &&
          (reasonSent ? (
            <p className="text-body text-[var(--ds-fg-secondary)]" role="status">
              Thanks for telling us.
            </p>
          ) : (
            <ReasonForm
              onSend={(reason, comment) => giveReason.mutate({ reason, comment })}
              sending={giveReason.isPending}
              error={giveReason.isError ? errorMessage(giveReason.error) : null}
            />
          ))}

        <div className="flex flex-col gap-4 border-t border-[var(--ds-border-subtle)] pt-6">
          {resubscribe.isError && <Banner tone="danger">{errorMessage(resubscribe.error)}</Banner>}
          <div className="flex flex-col gap-1.5">
            <p className="text-label text-[var(--ds-fg-secondary)]">Was this a mistake?</p>
            <Button
              variant="outlined"
              size="lg"
              fullWidth
              onClick={() => resubscribe.mutate()}
              loading={resubscribe.isPending}
            >
              Re-subscribe
            </Button>
          </div>
          <Link to={`/preferences/${path}`} className={`${publicLinkClass} self-start`}>
            Email preferences
          </Link>
        </div>
      </div>
    )
  } else if (outcome === 'resubscribed') {
    body = (
      <div className="flex flex-col gap-5" role="status">
        <ResultMark tone="success">
          <Check size={22} />
        </ResultMark>
        <PublicHeading title="You are subscribed again" focusOnMount>
          <p>
            <Strong>{prefs.data.email}</Strong> will keep getting email from {sender}, the same as
            before.
          </p>
        </PublicHeading>
        {prefs.data.lists.length > 0 && (
          <Link to={`/preferences/${path}`} className={`${publicLinkClass} self-start`}>
            Choose which emails you get
          </Link>
        )}
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-6">
        <PublicHeading title={organization ? `Unsubscribe from ${organization}?` : 'Unsubscribe?'}>
          <p>
            <Strong>{prefs.data.email}</Strong> will stop getting email from {sender}.
          </p>
        </PublicHeading>
        {unsubscribe.isError && <Banner tone="danger">{errorMessage(unsubscribe.error)}</Banner>}
        <Button
          size="lg"
          fullWidth
          onClick={() => unsubscribe.mutate()}
          loading={unsubscribe.isPending}
        >
          Unsubscribe
        </Button>
        {prefs.data.status === 'subscribed' && prefs.data.lists.length > 0 && (
          <Link to={`/preferences/${path}`} className={`${publicLinkClass} self-start`}>
            Choose which emails you get instead
          </Link>
        )}
      </div>
    )
  }

  return <PublicFrame organization={organization}>{body}</PublicFrame>
}
