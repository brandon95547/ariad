import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { MailX } from 'lucide-react'
import type { PublicPreferences } from '@ariad/shared'
import { api, errorMessage } from '@/lib/api'
import { Button } from '@/ui/Button'
import { Banner } from '@/ui/Feedback'
import { Checkbox } from '@/ui/Inputs'
import {
  PublicFrame,
  PublicHeading,
  PublicLoading,
  ResultMark,
  publicLinkClass,
  useDocumentTitle,
} from './PublicFrame'
import { LinkProblem, PREVIEW_TOKEN, PreviewNote, preferencesKey } from './UnsubscribePage'

const subscribedTo = (prefs: PublicPreferences) =>
  prefs.lists.filter((list) => list.subscribed).map((list) => list.id)

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

/**
 * Where "Email preferences" in an email leads: which of the public lists this
 * person is on, for them to change. Leaving every list is not unsubscribing,
 * so the way to stop everything is on the page as its own link.
 */
export function PreferencesPage() {
  const { token = '' } = useParams()
  const client = useQueryClient()
  const isPreview = token === PREVIEW_TOKEN
  const path = encodeURIComponent(token)

  const prefs = useQuery({
    queryKey: preferencesKey(token),
    queryFn: () => api.get<PublicPreferences>(`/public/preferences/${path}`),
    enabled: !isPreview,
    refetchOnWindowFocus: false,
  })
  const [chosen, setChosen] = useState<string[] | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (prefs.data && chosen === null) setChosen(subscribedTo(prefs.data))
  }, [prefs.data, chosen])

  const store = (next: PublicPreferences) => {
    client.setQueryData(preferencesKey(token), next)
    setChosen(subscribedTo(next))
  }

  const save = useMutation({
    mutationFn: () =>
      api.post<PublicPreferences>(`/public/preferences/${path}`, { listIds: chosen ?? [] }),
    onSuccess: (next) => {
      store(next)
      setSaved(true)
    },
  })
  const resubscribe = useMutation({
    mutationFn: () => api.post<PublicPreferences>(`/public/resubscribe/${path}`),
    onSuccess: store,
  })

  const organization = prefs.data?.organization ?? ''
  const sender = organization || 'this sender'
  useDocumentTitle(organization ? `Email preferences · ${organization}` : 'Email preferences')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSaved(false)
    save.mutate()
  }

  let body
  if (isPreview) {
    body = <PreviewNote what="choose which of your emails they get" />
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
  } else if (prefs.data.status !== 'subscribed') {
    const { status, email } = prefs.data
    body = (
      <div className="flex flex-col gap-5">
        <ResultMark tone="neutral">
          <MailX size={22} />
        </ResultMark>
        <PublicHeading title="You are not subscribed">
          <p>
            <strong className="font-medium text-[var(--ds-fg)]">{email}</strong> is not getting
            email from {sender}
            {status === 'pending' ? ' yet.' : ', so there is nothing to change here.'}
          </p>
          {status === 'pending' && (
            <p>
              To finish subscribing, open the confirmation email you were sent and press the button
              in it.
            </p>
          )}
        </PublicHeading>
        {status === 'unsubscribed' && (
          <>
            {resubscribe.isError && (
              <Banner tone="danger">{errorMessage(resubscribe.error)}</Banner>
            )}
            <Button
              size="lg"
              fullWidth
              onClick={() => resubscribe.mutate()}
              loading={resubscribe.isPending}
            >
              Subscribe again
            </Button>
          </>
        )}
      </div>
    )
  } else {
    const current = subscribedTo(prefs.data)
    const picked = chosen ?? current
    const dirty = !sameSet(picked, current)
    body = (
      <form onSubmit={submit} className="flex flex-col gap-6">
        <PublicHeading title="Email preferences">
          <p>
            What {sender} sends to{' '}
            <strong className="font-medium text-[var(--ds-fg)]">{prefs.data.email}</strong>.
          </p>
        </PublicHeading>

        {prefs.data.lists.length === 0 ? (
          <p className="text-body text-[var(--ds-fg-secondary)]">
            {sender.slice(0, 1).toUpperCase() + sender.slice(1)} sends one kind of email, so there
            is nothing to choose between. You are subscribed to it.
          </p>
        ) : (
          <>
            <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
              <legend className="sr-only-ds">Emails you get</legend>
              {prefs.data.lists.map((list) => (
                <Checkbox
                  key={list.id}
                  label={<span className="text-body">{list.name}</span>}
                  description={list.description ?? undefined}
                  checked={picked.includes(list.id)}
                  onChange={(on) => {
                    setSaved(false)
                    setChosen(on ? [...picked, list.id] : picked.filter((id) => id !== list.id))
                  }}
                />
              ))}
            </fieldset>

            {picked.length === 0 && (
              <p className="text-body-sm text-[var(--ds-fg-muted)]">
                With nothing ticked you leave these lists, but {sender} can still send you other
                email. To stop all of it, unsubscribe.
              </p>
            )}
            {save.isError && <Banner tone="danger">{errorMessage(save.error)}</Banner>}
            {saved && !dirty && (
              <Banner tone="success">Saved. Your choices take effect now.</Banner>
            )}

            <Button type="submit" size="lg" fullWidth loading={save.isPending} disabled={!dirty}>
              Save preferences
            </Button>
          </>
        )}

        <Link to={`/unsubscribe/${path}`} className={`${publicLinkClass} self-start`}>
          Unsubscribe from everything
        </Link>
      </form>
    )
  }

  return <PublicFrame organization={organization}>{body}</PublicFrame>
}
