import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  ListMinus,
  ListPlus,
  type LucideIcon,
  MailCheck,
  MailOpen,
  MailX,
  Merge,
  MoreHorizontal,
  MousePointerClick,
  Pencil,
  Send,
  ShieldAlert,
  Tag as TagIcon,
  Trash2,
  Upload,
  UserCheck,
  UserMinus,
  UserPlus,
  Workflow,
} from 'lucide-react'
import type { Automation, Contact, ContactEvent, ContactEventType, ContactStatus } from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ApiError, api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { contactName, formatDateTime } from '@/lib/format'
import { keys, useFields, useInvalidate, useLists, useTags } from '@/lib/queries'
import { Button } from '@/ui/Button'
import { Field, Select } from '@/ui/Controls'
import { Dialog } from '@/ui/Dialog'
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback'
import { ActionMenu } from '@/ui/Menu'
import { Page, PageHeader } from '@/ui/Shell'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'
import {
  MembershipFields,
  ProfileFields,
  StatusBadge,
  contactKeys,
  draftBody,
  draftOf,
  inlineLink,
  sameDraft,
  useCan,
  type ContactDraft,
} from './parts'

const BACK = { to: '/contacts', label: 'Contacts' }

/** What each status means for sending, said the way the consent record should read. */
const STATUS_MEANING: Record<ContactStatus, string> = {
  subscribed: 'They can be emailed.',
  pending: 'They have not confirmed yet, so they are not emailed.',
  unsubscribed: 'They asked to stop, so they are not emailed.',
  bounced: 'Mail to this address was rejected, so they are not emailed.',
  complained: 'They marked an email as spam, so they are not emailed.',
}

type MarkerTone = 'neutral' | 'success' | 'danger' | 'accent'

const MARKER_TONE: Record<MarkerTone, string> = {
  neutral: 'border-[var(--ds-border)] bg-[var(--ds-surface)] text-[var(--ds-fg-muted)]',
  success: 'border-[var(--ds-success-border)] bg-[var(--ds-success-subtle)] text-[var(--ds-success-text)]',
  danger: 'border-[var(--ds-danger-border)] bg-[var(--ds-danger-subtle)] text-[var(--ds-danger-text)]',
  accent: 'border-[var(--ds-accent-border)] bg-[var(--ds-accent-subtle)] text-[var(--ds-accent-text)]',
}

const EVENT_MARK: Record<ContactEventType, { icon: LucideIcon; tone: MarkerTone }> = {
  created: { icon: UserPlus, tone: 'neutral' },
  imported: { icon: Upload, tone: 'neutral' },
  updated: { icon: Pencil, tone: 'neutral' },
  subscribed: { icon: UserCheck, tone: 'success' },
  confirmed: { icon: MailCheck, tone: 'success' },
  unsubscribed: { icon: UserMinus, tone: 'neutral' },
  resubscribed: { icon: UserCheck, tone: 'success' },
  list_added: { icon: ListPlus, tone: 'neutral' },
  list_removed: { icon: ListMinus, tone: 'neutral' },
  tag_added: { icon: TagIcon, tone: 'neutral' },
  tag_removed: { icon: TagIcon, tone: 'neutral' },
  form_submitted: { icon: ClipboardList, tone: 'neutral' },
  sent: { icon: Send, tone: 'neutral' },
  opened: { icon: MailOpen, tone: 'accent' },
  clicked: { icon: MousePointerClick, tone: 'accent' },
  bounced: { icon: MailX, tone: 'danger' },
  complained: { icon: ShieldAlert, tone: 'danger' },
  failed: { icon: AlertCircle, tone: 'danger' },
  automation_started: { icon: Workflow, tone: 'neutral' },
  automation_completed: { icon: CheckCircle2, tone: 'success' },
  merged: { icon: Merge, tone: 'neutral' },
}

const TIMELINE_STEP = 50

const detailText = (event: ContactEvent, key: string): string | null => {
  const value = event.detail?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * The contact record says that they unsubscribed and when, but not how. The
 * activity does: an unsubscribe from the link in an email, or from the mailbox
 * provider's own button, is the person's own decision.
 */
function leftThemselves(events: readonly ContactEvent[] | undefined): boolean | null {
  const last = events?.find((event) => event.type === 'unsubscribed')
  if (!last) return null
  return /unsubscribe link|one-click/i.test(last.summary)
}

/**
 * One contact: who they are, what they agreed to, and everything that has
 * happened between them and you.
 */
export function ContactDetailPage() {
  const { id = '' } = useParams()
  // Keyed, so going from one contact to another starts from that contact and not from the last one's unsaved edits.
  return <ContactDetail key={id} id={id} />
}

function ContactDetail({ id }: { id: string }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const invalidate = useInvalidate()
  const canEdit = useCan('editor')
  const lists = useLists()
  const tags = useTags()
  const fields = useFields()

  const contact = useQuery({ queryKey: contactKeys.detail(id), queryFn: () => api.get<Contact>(`/contacts/${id}`) })
  const activity = useQuery({ queryKey: contactKeys.activity(id), queryFn: () => api.get<ContactEvent[]>(`/contacts/${id}/activity`) })

  const [draft, setDraft] = useState<ContactDraft | null>(null)
  const [confirming, setConfirming] = useState<'unsubscribe' | 'resubscribe' | 'delete' | null>(null)
  const [enrolling, setEnrolling] = useState(false)
  const [shown, setShown] = useState(TIMELINE_STEP)

  useEffect(() => {
    if (contact.data && !draft) setDraft(draftOf(contact.data))
  }, [contact.data, draft])

  const landed = (saved: Contact) => {
    client.setQueryData(contactKeys.detail(id), saved)
    void invalidate(contactKeys.all, keys.lists, keys.tags, keys.segments)
  }

  const save = useMutation({
    mutationFn: () => api.patch<Contact>(`/contacts/${id}`, draftBody(draft!)),
    onSuccess: (saved) => {
      landed(saved)
      setDraft(draftOf(saved))
      toast.success('Changes saved')
    },
  })

  const setStatus = useMutation({
    mutationFn: (status: 'subscribed' | 'unsubscribed') => api.patch<Contact>(`/contacts/${id}`, { status }),
    onSuccess: (saved, status) => {
      landed(saved)
      // Unsubscribing takes them off every list, so the lists being edited are no longer the lists they are on.
      const fresh = draftOf(saved)
      setDraft((current) => (current ? { ...current, listIds: fresh.listIds, tagIds: fresh.tagIds } : fresh))
      setConfirming(null)
      toast.success(status === 'unsubscribed' ? `${contactName(saved)} was unsubscribed` : `${contactName(saved)} can be emailed again`)
    },
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/contacts/${id}`),
    onSuccess: () => {
      const name = contact.data ? contactName(contact.data) : 'Contact'
      client.removeQueries({ queryKey: contactKeys.detail(id) })
      void invalidate(contactKeys.all, keys.lists, keys.tags, keys.segments)
      toast.success(`${name} deleted`)
      navigate('/contacts')
    },
  })

  if (contact.isError) {
    return (
      <Page>
        <PageHeader title="Contact" back={BACK} />
        <Banner
          tone="danger"
          actions={
            <Button size="sm" variant="outlined" onClick={() => navigate('/contacts')}>
              Back to contacts
            </Button>
          }
        >
          {contact.error instanceof ApiError && contact.error.status === 404
            ? 'This contact does not exist. They may have been deleted, or merged into another contact.'
            : errorMessage(contact.error)}
        </Banner>
      </Page>
    )
  }

  if (!contact.data || !draft) {
    return (
      <Page>
        <PageHeader title="Contact" back={BACK} />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <Skeleton className="h-[28rem] rounded-[var(--radius-xl)]" />
          <Skeleton className="h-64 rounded-[var(--radius-xl)]" />
        </div>
      </Page>
    )
  }

  const person = contact.data
  const name = contactName(person)
  const named = name !== person.email
  const dirty = !sameDraft(draft, draftOf(person))
  const mailable = person.status === 'subscribed' || person.status === 'pending'
  const fieldErrors = save.error instanceof ApiError ? save.error.fields : {}
  const clashId =
    save.error instanceof ApiError && save.error.code === 'duplicate_contact' ? (save.error.details as { id?: string } | null)?.id : undefined
  const saveError = save.isError && Object.keys(fieldErrors).length === 0 ? errorMessage(save.error) : null

  const pendingOn = person.lists.filter((membership) => membership.status === 'pending').map((membership) => membership.name)
  const leftLists = person.lists.filter((membership) => membership.status === 'unsubscribed').map((membership) => membership.name)
  const self = leftThemselves(activity.data)
  const events = activity.data ?? []

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }

  const ask = (what: 'unsubscribe' | 'resubscribe' | 'delete') => {
    setStatus.reset()
    remove.reset()
    setConfirming(what)
  }

  return (
    <Page>
      <PageHeader
        title={name}
        back={BACK}
        description={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <StatusBadge status={person.status} />
            {named && <span className="[overflow-wrap:anywhere]">{person.email}</span>}
          </span>
        }
        actions={
          canEdit ? (
            <>
              <Button variant="outlined" onClick={() => ask(mailable ? 'unsubscribe' : 'resubscribe')}>
                {mailable ? 'Unsubscribe' : 'Re-subscribe'}
              </Button>
              <ActionMenu
                label={`More actions for ${name}`}
                icon={<MoreHorizontal size={16} />}
                actions={[
                  { id: 'automation', label: 'Start an automation', icon: <Workflow size={14} />, onSelect: () => setEnrolling(true) },
                  { id: 'delete', label: 'Delete contact', icon: <Trash2 size={14} />, onSelect: () => ask('delete'), danger: true, separated: true },
                ]}
              />
            </>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            <div className="flex flex-col gap-4">
              <h2 className="text-h4 text-[var(--ds-fg)]">Profile</h2>
              {saveError && (
                <Banner tone={clashId ? 'warning' : 'danger'}>
                  {saveError}{' '}
                  {clashId && (
                    <Link to={`/contacts/${clashId}`} className={inlineLink}>
                      Open that contact
                    </Link>
                  )}
                </Banner>
              )}
              <div className="flex flex-col gap-5">
                <ProfileFields draft={draft} onChange={setDraft} fields={fields.data ?? []} errors={fieldErrors} readOnly={!canEdit} />
              </div>
            </div>

            <div className="flex flex-col gap-4 border-t border-[var(--ds-border-subtle)] pt-5">
              <h3 className="text-overline text-[var(--ds-fg-muted)] uppercase">Lists and tags</h3>
              <MembershipFields
                draft={draft}
                onChange={setDraft}
                lists={lists.data ?? []}
                tags={tags.data ?? []}
                readOnly={!canEdit}
                listHint={
                  <>
                    {canEdit && 'Adding a list subscribes them to it right away, and starts any automation that runs when someone joins it.'}
                    {pendingOn.length > 0 && <span className="block">Waiting for them to confirm: {pendingOn.join(', ')}.</span>}
                    {leftLists.length > 0 && <span className="block">Unsubscribed from: {leftLists.join(', ')}.</span>}
                  </>
                }
              />
            </div>

            {canEdit && (
              <div className="flex items-center gap-3 border-t border-[var(--ds-border-subtle)] pt-5">
                <Button type="submit" loading={save.isPending} disabled={!dirty}>
                  Save changes
                </Button>
                {dirty && (
                  <Button
                    variant="text"
                    onClick={() => {
                      save.reset()
                      setDraft(draftOf(person))
                    }}
                    disabled={save.isPending}
                  >
                    Discard
                  </Button>
                )}
              </div>
            )}
            </form>
          </Card>

          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-h4 text-[var(--ds-fg)]">Consent</h2>
              <p className="text-body-sm text-[var(--ds-fg-muted)]">The record of what this person agreed to. It cannot be edited.</p>
            </div>
            <dl className="flex flex-col gap-4 sm:gap-3">
              <ConsentRow term="Status">
                <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <StatusBadge status={person.status} />
                  <span>{STATUS_MEANING[person.status]}</span>
                </span>
              </ConsentRow>
              <ConsentRow term="Agreed on" missing="No date on record">
                {person.consentAt && formatDateTime(person.consentAt)}
              </ConsentRow>
              <ConsentRow term="How they agreed">{person.consentSource}</ConsentRow>
              <ConsentRow term="What they agreed to">{person.consentText}</ConsentRow>
              <ConsentRow term="IP address">{person.consentIp}</ConsentRow>
              <ConsentRow term="Confirmed" missing="Not confirmed">
                {person.confirmedAt && formatDateTime(person.confirmedAt)}
              </ConsentRow>
              <ConsentRow term="Added">
                {formatDateTime(person.createdAt)}
                {person.source ? ` · ${person.source}` : ''}
              </ConsentRow>
              {person.unsubscribedAt && (
                <>
                  <ConsentRow term="Unsubscribed on">{formatDateTime(person.unsubscribedAt)}</ConsentRow>
                  <ConsentRow term="Reason given" missing="None given">
                    {person.unsubscribeReason}
                  </ConsentRow>
                </>
              )}
            </dl>
          </Card>
        </div>

        <Card className="flex min-w-0 flex-col gap-4">
          <h2 className="text-h4 text-[var(--ds-fg)]">Activity</h2>
          {activity.isError ? (
            <Banner tone="danger">{errorMessage(activity.error)}</Banner>
          ) : activity.isPending ? (
            <div className="flex flex-col gap-5">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="flex gap-3">
                  <Skeleton className="h-[23px] w-[23px] shrink-0 rounded-full" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : events.length === 0 ? (
            <EmptyState compact title="Nothing has happened yet" description="Emails sent to them, and what they do with them, appear here." />
          ) : (
            <>
              <ol className="w-full">
                {events.slice(0, shown).map((event, index, visible) => (
                  <TimelineEvent key={event.id} event={event} last={index === visible.length - 1} />
                ))}
              </ol>
              {events.length > shown && (
                <Button variant="text" size="sm" className="self-start" onClick={() => setShown((count) => count + TIMELINE_STEP)}>
                  Show earlier activity
                </Button>
              )}
            </>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirming === 'unsubscribe'}
        onClose={() => setConfirming(null)}
        onConfirm={() => setStatus.mutate('unsubscribed')}
        title={`Unsubscribe ${name}?`}
        confirmLabel="Unsubscribe"
        loading={setStatus.isPending}
      >
        <p>
          They stop getting all email from you. Anything waiting to send to them is canceled, any automation they are in ends, and their address
          goes on the suppression list so an import cannot add them back by mistake.
        </p>
        {setStatus.isError && <Banner tone="danger">{errorMessage(setStatus.error)}</Banner>}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming === 'resubscribe'}
        onClose={() => setConfirming(null)}
        onConfirm={() => setStatus.mutate('subscribed')}
        title={`Re-subscribe ${name}?`}
        confirmLabel="Re-subscribe"
        danger={false}
        loading={setStatus.isPending}
      >
        {person.status === 'bounced' ? (
          <p>Mail to this address bounced. Re-subscribe them only if you know the address works again: repeated bounces hurt your sending reputation.</p>
        ) : person.status === 'complained' ? (
          <p>They marked one of your emails as spam. Re-subscribe them only if they have asked you to, in writing if you can get it.</p>
        ) : self ? (
          <p>
            {name} unsubscribed themselves{person.unsubscribedAt ? ` on ${formatDateTime(person.unsubscribedAt)}` : ''}, using the link in one of your
            emails. Re-subscribe them only if they have since asked you to. Emailing someone who opted out can break anti-spam law.
          </p>
        ) : self === false ? (
          <p>They were unsubscribed by someone on your team, not by their own choice. Re-subscribe them if that was a mistake.</p>
        ) : (
          <p>If they unsubscribed themselves, re-subscribe them only because they have since asked you to. Emailing someone who opted out can break anti-spam law.</p>
        )}
        <p>Their address comes off the suppression list and they can be emailed again. They are not put back on any list: add those under Lists.</p>
        {setStatus.isError && <Banner tone="danger">{errorMessage(setStatus.error)}</Banner>}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming === 'delete'}
        onClose={() => setConfirming(null)}
        onConfirm={() => remove.mutate()}
        title={`Delete ${name}?`}
        confirmLabel="Delete contact"
        loading={remove.isPending}
      >
        <p>
          This removes them, their tags and lists, and their history for good. If they had unsubscribed, their address stays on the suppression list,
          so they still will not be emailed.
        </p>
        {remove.isError && <Banner tone="danger">{errorMessage(remove.error)}</Banner>}
      </ConfirmDialog>

      <AutomationDialog
        open={enrolling}
        contactId={id}
        name={name}
        onClose={() => setEnrolling(false)}
        onStarted={(automation) => {
          setEnrolling(false)
          void invalidate(contactKeys.activity(id))
          toast.success(`${name} started ${automation.name}`)
        }}
      />
    </Page>
  )
}

/** A line of the consent record. What is not on record says so, in place of an empty space. */
function ConsentRow({ term, missing = 'Not recorded', children }: { term: string; missing?: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === false || children === ''
  return (
    <div className="flex flex-col gap-1.5 sm:grid sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-label text-[var(--ds-fg-muted)]">{term}</dt>
      <dd className={cn('text-body-sm [overflow-wrap:anywhere]', empty ? 'text-[var(--ds-fg-muted)]' : 'text-[var(--ds-fg)]')}>
        {empty ? missing : children}
      </dd>
    </div>
  )
}

function TimelineEvent({ event, last }: { event: ContactEvent; last: boolean }) {
  const mark = EVENT_MARK[event.type] ?? EVENT_MARK.updated
  const Icon = mark.icon
  const campaignId = detailText(event, 'campaignId')
  const note = detailText(event, 'url') ?? detailText(event, 'error') ?? detailText(event, 'reason') ?? detailText(event, 'detail')
  return (
    <li className="relative flex gap-3">
      {!last && <span aria-hidden className="absolute top-6 bottom-0 left-[11px] w-px bg-[var(--ds-border-subtle)]" />}
      <span aria-hidden className={cn('relative z-10 grid h-[23px] w-[23px] shrink-0 place-items-center rounded-full border', MARKER_TONE[mark.tone])}>
        <Icon size={13} />
      </span>
      <div className={cn('flex min-w-0 flex-1 flex-col gap-0.5', !last && 'pb-5')}>
        {campaignId ? (
          <Link to={`/campaigns/${campaignId}`} className={cn(inlineLink, 'self-start text-label text-[var(--ds-fg)] no-underline hover:underline')}>
            {event.summary}
          </Link>
        ) : (
          <span className="text-label text-[var(--ds-fg)]">{event.summary}</span>
        )}
        <time dateTime={event.createdAt} className="text-caption text-[var(--ds-fg-muted)]">
          {formatDateTime(event.createdAt)}
        </time>
        {note && (
          <span className="mt-1 rounded-[var(--radius-md)] border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-inset)] px-2.5 py-2 text-caption leading-relaxed text-[var(--ds-fg-secondary)] [overflow-wrap:anywhere]">
            {note}
          </span>
        )}
      </div>
    </li>
  )
}

/** Starts this one contact down an automation by hand. Only automations that are turned on can be started. */
function AutomationDialog({
  open,
  contactId,
  name,
  onClose,
  onStarted,
}: {
  open: boolean
  contactId: string
  name: string
  onClose: () => void
  onStarted: (automation: Automation) => void
}) {
  const selectId = useId()
  const [chosen, setChosen] = useState('')
  const [missing, setMissing] = useState(false)
  const automations = useQuery({ queryKey: ['automations'], queryFn: () => api.get<Automation[]>('/automations'), enabled: open })
  const active = (automations.data ?? []).filter((automation) => automation.status === 'active')

  const start = useMutation({
    mutationFn: (automation: Automation) => api.post<{ started: boolean }>(`/contacts/${contactId}/automations`, { automationId: automation.id }),
    onSuccess: (_result, automation) => onStarted(automation),
  })

  useEffect(() => {
    if (!open) return
    setChosen('')
    setMissing(false)
    start.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const picked = active.find((automation) => automation.id === chosen)
  const none = automations.isSuccess && active.length === 0

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Start an automation"
      description={`${name} goes in at the first step, whatever usually triggers it.`}
      size="sm"
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={start.isPending}>
            {none ? 'Close' : 'Cancel'}
          </Button>
          {!none && (
            <Button onClick={() => (picked ? start.mutate(picked) : setMissing(true))} loading={start.isPending}>
              Start automation
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {automations.isError ? (
          <Banner tone="danger">{errorMessage(automations.error)}</Banner>
        ) : none ? (
          <p className="text-body-sm text-[var(--ds-fg-secondary)]">
            No automation is turned on.{' '}
            <Link to="/automations" className={inlineLink}>
              Turn one on under Automations
            </Link>
            , then come back.
          </p>
        ) : (
          <Field label="Automation" htmlFor={selectId} error={missing && !picked ? 'Choose an automation.' : undefined}>
            <Select
              id={selectId}
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
              disabled={automations.isPending}
              options={[
                { value: '', label: automations.isPending ? 'Loading…' : 'Choose an automation' },
                ...active.map((automation) => ({ value: automation.id, label: automation.name })),
              ]}
            />
          </Field>
        )}
        {start.isError && <Banner tone="danger">{errorMessage(start.error)}</Banner>}
      </div>
    </Dialog>
  )
}
