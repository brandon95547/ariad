import { useEffect, useId, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { Contact } from '@ariad/shared'
import { ApiError, api, errorMessage } from '@/lib/api'
import { useFields, useLists, useTags } from '@/lib/queries'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'
import { Banner } from '@/ui/Feedback'
import { EMPTY_DRAFT, MembershipFields, ProfileFields, draftBody, inlineLink, type ContactDraft } from './parts'

/**
 * Adds one contact by hand. They are subscribed straight away, and Ariad
 * records who added them as the consent source. An address that is already a
 * contact is not an error to explain away: the dialog offers the way to them.
 */
export function AddContactDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (contact: Contact) => void
}) {
  const formId = useId()
  const lists = useLists()
  const tags = useTags()
  const fields = useFields()
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_DRAFT)

  const create = useMutation({
    mutationFn: () => api.post<Contact>('/contacts', draftBody(draft)),
    onSuccess: onCreated,
  })

  useEffect(() => {
    if (!open) return
    setDraft(EMPTY_DRAFT)
    create.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const error = create.error
  const fieldErrors = error instanceof ApiError ? error.fields : {}
  const existingId =
    error instanceof ApiError && error.code === 'duplicate_contact' ? (error.details as { id?: string } | null)?.id : undefined
  const general = create.isError && Object.keys(fieldErrors).length === 0 ? errorMessage(error) : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a contact"
      description="For one person who has agreed to hear from you. To add many at once, import a file."
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={create.isPending}>
            Add contact
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {general && (
          <Banner tone={existingId ? 'warning' : 'danger'}>
            {general}{' '}
            {existingId && (
              <Link to={`/contacts/${existingId}`} className={inlineLink}>
                Open that contact
              </Link>
            )}
          </Banner>
        )}
        <ProfileFields draft={draft} onChange={setDraft} fields={fields.data ?? []} errors={fieldErrors} />
        <div className="flex flex-col gap-4 border-t border-[var(--ds-border-subtle)] pt-5">
          <h3 className="text-overline text-[var(--ds-fg-muted)] uppercase">Lists and tags</h3>
          <MembershipFields
            draft={draft}
            onChange={setDraft}
            lists={lists.data ?? []}
            tags={tags.data ?? []}
            listHint="They are subscribed to these right away, and any automation that runs when someone joins the list starts."
          />
        </div>
      </form>
    </Dialog>
  )
}
