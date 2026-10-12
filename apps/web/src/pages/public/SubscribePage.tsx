import { useQuery } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router-dom'
import { CircleSlash } from 'lucide-react'
import type { FormSubmissionResult, PublicForm } from '@ariad/shared'
import { ApiError, api, errorMessage } from '@/lib/api'
import { Button } from '@/ui/Button'
import {
  PublicFrame,
  PublicHeading,
  PublicLoading,
  ResultMark,
  useDocumentTitle,
} from './PublicFrame'
import { SignupFormBody, resultFor } from './SignupFormBody'

const STATUSES: readonly FormSubmissionResult['status'][] = [
  'subscribed',
  'confirmation_sent',
  'already_subscribed',
]

/**
 * A signup form's hosted page, which is also what the iframe embed shows.
 *
 * `?done=` and `?error=` are how the plain-HTML embed reports back: that form
 * posts from another site and the server sends the browser here with the
 * outcome in the address.
 */
export function SubscribePage({ embedded }: { embedded: boolean }) {
  const { id = '' } = useParams()
  const [search] = useSearchParams()
  const path = encodeURIComponent(id)

  const form = useQuery({
    queryKey: ['public', 'form', id],
    queryFn: () => api.get<PublicForm>(`/public/forms/${path}`),
    refetchOnWindowFocus: false,
  })
  useDocumentTitle(
    form.data ? [form.data.title, form.data.organization].filter(Boolean).join(' · ') : 'Subscribe',
  )

  const done = STATUSES.find((status) => status === search.get('done'))
  const closed = form.error instanceof ApiError && form.error.status === 404

  return (
    <PublicFrame organization={form.data?.organization} mode={embedded ? 'embedded' : 'page'}>
      {form.isPending ? (
        <PublicLoading />
      ) : form.isError ? (
        <div className="flex flex-col gap-5">
          <ResultMark tone="neutral">
            <CircleSlash size={22} />
          </ResultMark>
          {closed ? (
            <PublicHeading title="This form is closed">
              <p>
                It is not taking signups any more. If you expected it to, tell whoever gave you the
                link.
              </p>
            </PublicHeading>
          ) : (
            <>
              <PublicHeading title="This form could not load">
                <p>{errorMessage(form.error)}</p>
              </PublicHeading>
              <Button
                variant="outlined"
                size="lg"
                fullWidth
                onClick={() => void form.refetch()}
                loading={form.isFetching}
              >
                Try again
              </Button>
            </>
          )}
        </div>
      ) : (
        <SignupFormBody
          form={form.data}
          submit={(input) =>
            api.post<FormSubmissionResult>(`/public/forms/${path}/subscribe`, input)
          }
          initialResult={done ? resultFor(form.data, done) : null}
          initialError={search.get('error')}
        />
      )}
    </PublicFrame>
  )
}
