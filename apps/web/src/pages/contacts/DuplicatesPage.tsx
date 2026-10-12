import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CopyCheck, Merge } from 'lucide-react'
import { CONTACT_STATUS_LABELS, type Contact, type DuplicateGroup } from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { api, errorMessage } from '@/lib/api'
import { contactName, formatDate, plural } from '@/lib/format'
import { keys, useInvalidate } from '@/lib/queries'
import { Button } from '@/ui/Button'
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback'
import { RadioGroup } from '@/ui/Inputs'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'
import { TabHeader, contactKeys, useCan } from './parts'

type Member = DuplicateGroup['contacts'][number]

/** How many groups are drawn at a time: an old list can have hundreds. */
const STEP = 20

const groupId = (group: DuplicateGroup) => `${group.reason}:${group.key}`
const mailable = (member: Member) => member.status === 'subscribed' || member.status === 'pending'
const isGmail = (member: Member) => /@(gmail|googlemail)\.com$/i.test(member.email)

/** Why these were put together, in words. Plus-addresses are one inbox anywhere; dots only at Gmail. */
function reasonOf(group: DuplicateGroup): { title: string; why: string } {
  if (group.reason === 'same_name_and_phone') {
    return { title: 'Same name and phone', why: 'These contacts share a name and a phone number.' }
  }
  if (group.reason === 'same_name_and_company') {
    return { title: 'Same name and company', why: 'These contacts share a name and a company.' }
  }
  return group.contacts.every(isGmail)
    ? {
        title: 'Same Gmail inbox',
        why: 'Gmail ignores dots and anything after a plus sign, so these addresses all arrive in one inbox.',
      }
    : {
        title: 'Same inbox',
        why: 'Anything after a plus sign in an address is ignored, so these all arrive in one inbox.',
      }
}

/** The one to keep unless told otherwise: someone who can still be emailed, and of those the oldest record. */
const suggested = (group: DuplicateGroup) =>
  (group.contacts.find(mailable) ?? group.contacts[0])?.id ?? ''

/**
 * Lists and segments › Duplicates. Contacts that look like one person entered
 * more than once. Merging keeps one and folds the others into it.
 */
export function DuplicatesPage() {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const canEdit = useCan('editor')
  const [keep, setKeep] = useState<Record<string, string>>({})
  const [merging, setMerging] = useState<DuplicateGroup | null>(null)
  const [shown, setShown] = useState(STEP)

  const duplicates = useQuery({
    queryKey: contactKeys.duplicates,
    queryFn: () => api.get<DuplicateGroup[]>('/contacts-duplicates'),
  })
  const groups = duplicates.data ?? []

  const keepOf = (group: DuplicateGroup) => {
    const chosen = keep[groupId(group)]
    return group.contacts.some((member) => member.id === chosen) ? chosen! : suggested(group)
  }

  const merge = useMutation({
    mutationFn: (group: DuplicateGroup) => {
      const keepId = keepOf(group)
      return api.post<Contact>('/contacts-merge', {
        keepId,
        mergeIds: group.contacts
          .filter((member) => member.id !== keepId)
          .map((member) => member.id),
      })
    },
    onSuccess: (kept, group) => {
      setMerging(null)
      void invalidate(contactKeys.all, keys.lists, keys.tags, keys.segments)
      toast.success(
        `${plural(group.contacts.length, 'contact')} merged into ${contactName(kept)}`,
        {
          action: { label: 'View', onClick: () => navigate(`/contacts/${kept.id}`) },
        },
      )
    },
  })

  const kept = merging
    ? merging.contacts.find((member) => member.id === keepOf(merging))
    : undefined
  const others = merging ? merging.contacts.filter((member) => member.id !== kept?.id) : []

  return (
    <div className="flex flex-col gap-6">
      <TabHeader
        title="Duplicates"
        description="Contacts that look like one person entered more than once. Merging keeps one and moves the tags, lists and history of the others onto it."
      />

      {duplicates.isError && (
        <Banner
          tone="danger"
          actions={
            <Button
              size="sm"
              variant="outlined"
              onClick={() => duplicates.refetch()}
              loading={duplicates.isFetching}
            >
              Try again
            </Button>
          }
        >
          {errorMessage(duplicates.error)}
        </Banner>
      )}

      {duplicates.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-40 rounded-[var(--radius-xl)]" />
          <Skeleton className="h-40 rounded-[var(--radius-xl)]" />
        </div>
      ) : groups.length === 0 && !duplicates.isError ? (
        <Card padding="none">
          <EmptyState
            icon={<CopyCheck />}
            title="No duplicates found"
            description="Ariad looks for addresses that arrive in one inbox, and for the same name with the same phone or company. Nothing matches right now."
            action={
              <Button variant="outlined" onClick={() => navigate('/contacts')}>
                View contacts
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.slice(0, shown).map((group) => {
            const reason = reasonOf(group)
            const mixed =
              group.contacts.some(mailable) && group.contacts.some((member) => !mailable(member))
            return (
              <li key={groupId(group)}>
                <Card className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-h4 text-[var(--ds-fg)]">{reason.title}</h3>
                    <p className="text-body-sm text-[var(--ds-fg-muted)]">{reason.why}</p>
                  </div>
                  {mixed && (
                    <Banner tone="warning" title="One of these has opted out or cannot be reached">
                      If they are the same person, keep that one. The contact you keep decides
                      whether they are emailed, and the others' status is discarded.
                    </Banner>
                  )}
                  <RadioGroup
                    label="Contact to keep"
                    value={keepOf(group)}
                    onChange={(id) => setKeep((current) => ({ ...current, [groupId(group)]: id }))}
                    disabled={!canEdit}
                    options={group.contacts.map((member) => ({
                      value: member.id,
                      label: contactName(member),
                      description: [
                        contactName(member) === member.email ? null : member.email,
                        member.company,
                        CONTACT_STATUS_LABELS[member.status],
                        `Added ${formatDate(member.createdAt)}`,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    }))}
                  />
                  {canEdit && (
                    <div>
                      <Button
                        variant="outlined"
                        startIcon={<Merge />}
                        onClick={() => {
                          merge.reset()
                          setMerging(group)
                        }}
                      >
                        Merge {plural(group.contacts.length, 'contact')}
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            )
          })}
          {groups.length > shown && (
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Button variant="outlined" onClick={() => setShown((count) => count + STEP)}>
                Show more
              </Button>
              <span className="text-caption text-[var(--ds-fg-muted)]">
                {plural(shown, 'group')} of {plural(groups.length, 'group')} shown
              </span>
            </li>
          )}
        </ul>
      )}

      <ConfirmDialog
        open={merging !== null}
        onClose={() => setMerging(null)}
        onConfirm={() => merging && merge.mutate(merging)}
        title={`Merge into ${kept ? contactName(kept) : 'one contact'}?`}
        confirmLabel="Merge contacts"
        loading={merge.isPending}
      >
        <p>
          <span className="text-[var(--ds-fg)] [overflow-wrap:anywhere]">{kept?.email}</span> is
          kept
          {kept ? `, and stays ${CONTACT_STATUS_LABELS[kept.status].toLowerCase()}` : ''}. Tags,
          lists and email history from{' '}
          <span className="[overflow-wrap:anywhere]">
            {others.map((member) => member.email).join(', ')}
          </span>{' '}
          move onto it, and details it is missing are filled in from them.
        </p>
        <p>
          {others.length === 1
            ? 'The other contact is deleted.'
            : `The other ${others.length} contacts are deleted.`}{' '}
          This cannot be undone.
        </p>
        {merge.isError && <Banner tone="danger">{errorMessage(merge.error)}</Banner>}
      </ConfirmDialog>
    </div>
  )
}
