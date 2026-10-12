import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarClock, CheckCircle2, FileText, Save, Send, XCircle } from 'lucide-react'
import {
  roleAtLeast,
  type AudienceEstimate,
  type Campaign,
  type CampaignAudience,
  type CampaignCheck,
  type Template,
} from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmailEditor } from '@/features/email/EmailEditor'
import { EmailPreview } from '@/features/email/EmailPreview'
import { MergeTagMenu, insertAtCursor } from '@/features/email/MergeTagMenu'
import { TemplatePicker } from '@/features/email/TemplatePicker'
import { api, errorMessage } from '@/lib/api'
import { formatDateTime, formatNumber, plural, toLocalInput } from '@/lib/format'
import { useDebounced } from '@/lib/hooks'
import { useAccounts, useAuthState, useLists, useSegments, useSettings, useTags } from '@/lib/queries'
import { Button } from '@/ui/Button'
import { Field, Select, Switch } from '@/ui/Controls'
import { Dialog } from '@/ui/Dialog'
import { Banner, Skeleton } from '@/ui/Feedback'
import { RadioGroup, TextInput } from '@/ui/Inputs'
import { MultiSelect } from '@/ui/MultiSelect'
import { Page, PageHeader } from '@/ui/Shell'
import { Card } from '@/ui/Surface'
import { Tabs } from '@/ui/Tabs'
import { toast } from '@/ui/Toast'
import { CampaignStatusBadge } from './CampaignsPage'

type Step = 'details' | 'audience' | 'design' | 'review'
const STEPS: { value: Step; label: string }[] = [
  { value: 'details', label: 'Details' },
  { value: 'audience', label: 'Audience' },
  { value: 'design', label: 'Design' },
  { value: 'review', label: 'Review and send' },
]

/** The parts of a campaign the editor changes. Compared whole to know if there is anything to save. */
type Draft = Pick<
  Campaign,
  'name' | 'subject' | 'preheader' | 'fromName' | 'replyTo' | 'accountId' | 'audience' | 'html' | 'design' | 'trackOpens' | 'trackClicks'
>

const toDraft = (campaign: Campaign): Draft => ({
  name: campaign.name,
  subject: campaign.subject,
  preheader: campaign.preheader,
  fromName: campaign.fromName,
  replyTo: campaign.replyTo,
  accountId: campaign.accountId,
  audience: campaign.audience,
  html: campaign.html,
  design: campaign.design,
  trackOpens: campaign.trackOpens,
  trackClicks: campaign.trackClicks,
})

/**
 * Writing a campaign: what it says, who gets it, and the last look before it
 * goes. Four tabs in the order the decisions are made, any of them reachable
 * at any time. Changes are saved on leaving a tab and before anything is sent.
 */
export function CampaignEditor({ campaign }: { campaign: Campaign }) {
  const client = useQueryClient()
  const canEdit = roleAtLeast(useAuthState().data?.user?.role ?? 'viewer', 'editor')
  const [params, setParams] = useSearchParams()
  const step = (STEPS.find((entry) => entry.value === params.get('step'))?.value ?? 'details') as Step

  const [draft, setDraft] = useState<Draft>(() => toDraft(campaign))
  const [saved, setSaved] = useState<Draft>(() => toDraft(campaign))
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved])
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }))

  const save = useMutation({
    mutationFn: (body: Draft) => api.patch<Campaign>(`/campaigns/${campaign.id}`, body),
    onSuccess: (updated, body) => {
      setSaved(body)
      client.setQueryData(['campaign', campaign.id], updated)
      void client.invalidateQueries({ queryKey: ['campaigns'] })
      void client.invalidateQueries({ queryKey: ['campaign-checks', campaign.id] })
      void client.invalidateQueries({ queryKey: ['campaign-preview', campaign.id] })
    },
    onError: (error) => toast.error('Your changes were not saved', { description: errorMessage(error) }),
  })

  /** Saves if there is anything to save. Resolves false when the save failed. */
  const saveNow = async (): Promise<boolean> => {
    if (!dirty) return true
    try {
      await save.mutateAsync(draft)
      return true
    } catch {
      return false
    }
  }

  const go = async (next: Step) => {
    if (canEdit) await saveNow()
    const copy = new URLSearchParams(params)
    copy.set('step', next)
    setParams(copy, { replace: true })
  }

  // Leaving the page with unsaved work: the browser asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const unschedule = useMutation({
    mutationFn: () => api.post<Campaign>(`/campaigns/${campaign.id}/unschedule`),
    onSuccess: (updated) => {
      client.setQueryData(['campaign', campaign.id], updated)
      void client.invalidateQueries({ queryKey: ['campaigns'] })
      toast.success('Back to a draft', { description: 'It will not send until you schedule or send it again.' })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <Page>
      <PageHeader
        title={draft.name || 'Untitled campaign'}
        back={{ to: '/campaigns', label: 'Campaigns' }}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <CampaignStatusBadge status={campaign.status} />
            <span>{save.isPending ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          </span>
        }
        actions={
          canEdit ? (
            <>
              <Button variant="outlined" startIcon={<Save />} onClick={() => void saveNow()} disabled={!dirty} loading={save.isPending}>
                Save
              </Button>
              {step !== 'review' && (
                <Button onClick={() => void go('review')} endIcon={<Send />}>
                  Review and send
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        <Tabs aria-label="Campaign steps" tabs={STEPS} value={step} onChange={(next) => void go(next)} />
      </PageHeader>

      {campaign.status === 'scheduled' && (
        <Banner
          tone="info"
          title={`Scheduled for ${formatDateTime(campaign.scheduledAt)}`}
          actions={
            canEdit ? (
              <Button size="sm" variant="outlined" onClick={() => unschedule.mutate()} loading={unschedule.isPending}>
                Unschedule
              </Button>
            ) : undefined
          }
        >
          It can still be changed until then. Whatever is saved at that moment is what goes out.
        </Banner>
      )}

      {step === 'details' && <DetailsStep draft={draft} patch={patch} />}
      {step === 'audience' && <AudienceStep audience={draft.audience} onChange={(audience) => patch({ audience })} />}
      {step === 'design' && <DesignStep draft={draft} patch={patch} />}
      {step === 'review' && <ReviewStep campaign={campaign} draft={draft} dirty={dirty} saveNow={saveNow} goTo={(next) => void go(next)} canEdit={canEdit} />}
    </Page>
  )
}

/* ---- Details ------------------------------------------------------------ */

function DetailsStep({ draft, patch }: { draft: Draft; patch: (next: Partial<Draft>) => void }) {
  const accounts = useAccounts()
  const subject = useRef<HTMLInputElement>(null)
  const usable = (accounts.data ?? []).filter((account) => account.enabled)
  const fallback = usable.find((account) => account.isDefault) ?? usable[0]
  const chosen = usable.find((account) => account.id === draft.accountId) ?? fallback

  return (
    <div className="flex max-w-[44rem] flex-col gap-8">
      <div className="flex flex-col gap-5">
        <Field label="Campaign name" hint="For your own reference. Recipients never see it.">
          <TextInput value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
        </Field>
        <Field label="Subject line" hint="What people see in their inbox. Say what is inside; under about 50 characters reads best on a phone.">
          <TextInput
            ref={subject}
            value={draft.subject}
            onChange={(event) => patch({ subject: event.target.value })}
            endAdornment={<span className="pr-1 text-caption text-[var(--ds-fg-muted)]" data-tabular>{draft.subject.length}</span>}
          />
        </Field>
        <div className="-mt-2 flex">
          <MergeTagMenu onPick={(token) => patch({ subject: insertAtCursor(subject.current, draft.subject, token) })} />
        </div>
        <Field label="Preview text" optional hint="The line shown after the subject in most inboxes. Left blank, mail apps fill it with the start of the email.">
          <TextInput value={draft.preheader ?? ''} onChange={(event) => patch({ preheader: event.target.value || null })} />
        </Field>
      </div>

      <div className="flex flex-col gap-5 border-t border-[var(--ds-border-subtle)] pt-8">
        <h2 className="text-h4 text-[var(--ds-fg)]">Who it is from</h2>
        {accounts.isPending ? (
          <Skeleton className="h-9" />
        ) : usable.length === 0 ? (
          <Banner
            tone="warning"
            title="There is no sending account yet"
            actions={
              <Link to="/settings/sending" className="text-label text-[var(--ds-accent-text)] underline underline-offset-2">
                Add a sending account
              </Link>
            }
          >
            You can write the campaign now, but it cannot be sent until Ariad has a Gmail or SMTP account to send through.
          </Banner>
        ) : (
          <>
            <Field label="Sending account" htmlFor="campaign-account" hint={chosen ? `Sends as ${draft.fromName || chosen.fromName} <${chosen.fromEmail}>` : undefined}>
              <Select
                id="campaign-account"
                value={draft.accountId ?? ''}
                onChange={(event) => patch({ accountId: event.target.value || null })}
                options={[
                  { value: '', label: fallback ? `Default account (${fallback.label})` : 'Default account' },
                  ...usable.map((account) => ({ value: account.id, label: `${account.label} — ${account.fromEmail}` })),
                ]}
              />
            </Field>
            <Field label="From name" optional hint="Leave blank to use the account's own.">
              <TextInput value={draft.fromName ?? ''} onChange={(event) => patch({ fromName: event.target.value || null })} placeholder={chosen?.fromName} />
            </Field>
            <Field label="Reply-to" optional hint="Where replies go, when that is not the sending address.">
              <TextInput type="email" value={draft.replyTo ?? ''} onChange={(event) => patch({ replyTo: event.target.value || null })} placeholder={chosen?.replyTo ?? chosen?.fromEmail} />
            </Field>
          </>
        )}
      </div>

      <div className="flex flex-col gap-5 border-t border-[var(--ds-border-subtle)] pt-8">
        <h2 className="text-h4 text-[var(--ds-fg)]">Tracking</h2>
        <Switch
          label="Track opens"
          description="Counts who opened it. An estimate: some mail apps load images by themselves, others block them."
          checked={draft.trackOpens}
          onChange={(trackOpens) => patch({ trackOpens })}
        />
        <Switch
          label="Track clicks"
          description="Counts which links were clicked, and by whom."
          checked={draft.trackClicks}
          onChange={(trackClicks) => patch({ trackClicks })}
        />
      </div>
    </div>
  )
}

/* ---- Audience ----------------------------------------------------------- */

function AudienceStep({ audience, onChange }: { audience: CampaignAudience; onChange: (audience: CampaignAudience) => void }) {
  const lists = useLists()
  const segments = useSegments()
  const tags = useTags()
  const settled = useDebounced(audience, 350)
  const estimate = useQuery({
    queryKey: ['audience-estimate', settled],
    queryFn: () => api.post<AudienceEstimate>('/audience/estimate', settled),
    placeholderData: (previous) => previous,
  })

  const listOptions = (lists.data ?? []).map((list) => ({ value: list.id, label: list.name, hint: plural(list.subscribedCount, 'subscriber') }))
  const segmentOptions = (segments.data ?? []).map((segment) => ({ value: segment.id, label: segment.name, hint: plural(segment.contactCount, 'contact') }))
  const tagOptions = (tags.data ?? []).map((tag) => ({ value: tag.id, label: tag.name, hint: plural(tag.contactCount, 'contact') }))
  const set = (next: Partial<CampaignAudience>) => onChange({ ...audience, ...next })
  const excluding = audience.excludeListIds.length + audience.excludeSegmentIds.length + audience.excludeTagIds.length > 0
  const [showExclude, setShowExclude] = useState(excluding)

  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        <RadioGroup
          label="Send to"
          value={audience.everyone ? 'everyone' : 'some'}
          onChange={(value) => set({ everyone: value === 'everyone' })}
          options={[
            { value: 'some', label: 'People I choose', description: 'By list, segment or tag.' },
            { value: 'everyone', label: 'Everyone who is subscribed', description: 'Every contact you are allowed to email.' },
          ]}
        />

        {!audience.everyone && (
          <div className="flex flex-col gap-5">
            <p className="text-body-sm text-[var(--ds-fg-muted)]">Anyone on any of these gets one copy, however many of them they are in.</p>
            <Field label="Lists">
              <MultiSelect options={listOptions} value={audience.listIds} onChange={(listIds) => set({ listIds })} placeholder="Choose lists" emptyText="No lists yet" />
            </Field>
            <Field label="Segments" optional>
              <MultiSelect options={segmentOptions} value={audience.segmentIds} onChange={(segmentIds) => set({ segmentIds })} placeholder="Choose segments" emptyText="No segments yet" />
            </Field>
            <Field label="Tags" optional>
              <MultiSelect options={tagOptions} value={audience.tagIds} onChange={(tagIds) => set({ tagIds })} placeholder="Choose tags" emptyText="No tags yet" />
            </Field>
          </div>
        )}

        <div className="flex flex-col gap-5 border-t border-[var(--ds-border-subtle)] pt-6">
          <Switch
            label="Leave some people out"
            description="Anyone matching these is skipped, even if they match above."
            checked={showExclude}
            onChange={(on) => {
              setShowExclude(on)
              if (!on) set({ excludeListIds: [], excludeSegmentIds: [], excludeTagIds: [] })
            }}
          />
          {showExclude && (
            <>
              <Field label="Not on these lists" optional>
                <MultiSelect options={listOptions} value={audience.excludeListIds} onChange={(excludeListIds) => set({ excludeListIds })} placeholder="Choose lists" />
              </Field>
              <Field label="Not in these segments" optional>
                <MultiSelect options={segmentOptions} value={audience.excludeSegmentIds} onChange={(excludeSegmentIds) => set({ excludeSegmentIds })} placeholder="Choose segments" />
              </Field>
              <Field label="Without these tags" optional>
                <MultiSelect options={tagOptions} value={audience.excludeTagIds} onChange={(excludeTagIds) => set({ excludeTagIds })} placeholder="Choose tags" />
              </Field>
            </>
          )}
        </div>
      </div>

      <Card className="flex flex-col gap-4 lg:sticky lg:top-4" aria-live="polite">
        <div className="flex flex-col gap-1.5">
          <span className="block text-label text-[var(--ds-fg-secondary)]">Will receive this</span>
          {estimate.data ? (
            <span className="text-h1 text-[var(--ds-fg)]" data-tabular>
              {formatNumber(estimate.data.sendable)}
            </span>
          ) : (
            <Skeleton className="h-9 w-24" />
          )}
        </div>
        {estimate.isError && <Banner tone="danger">{errorMessage(estimate.error)}</Banner>}
        {estimate.data && <EstimateNotes estimate={estimate.data} chosen={audience.everyone || audience.listIds.length + audience.segmentIds.length + audience.tagIds.length > 0} />}
      </Card>
    </div>
  )
}

function EstimateNotes({ estimate, chosen }: { estimate: AudienceEstimate; chosen: boolean }) {
  if (!chosen) return <p className="text-body-sm text-[var(--ds-fg-muted)]">Choose a list, segment or tag to see how many people this reaches.</p>
  const left = [
    [estimate.excluded.unsubscribed, 'unsubscribed'],
    [estimate.excluded.pending, 'have not confirmed their subscription'],
    [estimate.excluded.bounced, 'bounced before'],
    [estimate.excluded.complained, 'marked an email as spam'],
    [estimate.excluded.suppressed, 'are on the suppression list'],
  ].filter((entry): entry is [number, string] => (entry[0] as number) > 0)
  return (
    <div className="flex flex-col gap-2 text-body-sm text-[var(--ds-fg-muted)]">
      <p>
        {estimate.matched === estimate.sendable
          ? `Everyone this audience matches can be emailed.`
          : `${plural(estimate.matched, 'contact')} match. ${formatNumber(estimate.matched - estimate.sendable)} will be skipped:`}
      </p>
      {left.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {left.map(([count, why]) => (
            <li key={why}>
              {formatNumber(count)} {why}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---- Design ------------------------------------------------------------- */

function DesignStep({ draft, patch }: { draft: Draft; patch: (next: Partial<Draft>) => void }) {
  const client = useQueryClient()
  const [picking, setPicking] = useState(false)
  const [naming, setNaming] = useState(false)
  const [templateName, setTemplateName] = useState('')

  const saveTemplate = useMutation({
    mutationFn: () =>
      api.post<Template>('/templates', { name: templateName, subject: draft.subject, preheader: draft.preheader, html: draft.html, design: draft.design }),
    onSuccess: (template) => {
      setNaming(false)
      void client.invalidateQueries({ queryKey: ['templates'] })
      toast.success(`Saved as the template "${template.name}"`)
    },
  })

  return (
    <>
      <EmailEditor
        value={{ html: draft.html, design: draft.design }}
        onChange={(body) => patch(body)}
        subject={draft.subject}
        preheader={draft.preheader}
        toolbarEnd={
          <>
            <Button size="sm" variant="outlined" startIcon={<FileText />} onClick={() => setPicking(true)}>
              Templates
            </Button>
            <Button
              size="sm"
              variant="text"
              onClick={() => {
                setTemplateName(draft.name)
                saveTemplate.reset()
                setNaming(true)
              }}
            >
              Save as template
            </Button>
          </>
        }
      />

      <TemplatePicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(template) => {
          patch({
            html: template.html,
            design: template.design,
            // A template's subject is a suggestion: it fills an empty field and never overwrites one.
            subject: draft.subject || template.subject,
            preheader: draft.preheader || template.preheader,
          })
          setPicking(false)
        }}
      />

      <Dialog
        open={naming}
        onClose={() => setNaming(false)}
        title="Save as a template"
        description="The design, subject and preview text, to start other emails from."
        size="sm"
        footer={
          <>
            <Button variant="text" onClick={() => setNaming(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveTemplate.mutate()} loading={saveTemplate.isPending} disabled={!templateName.trim()}>
              Save template
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {saveTemplate.isError && <Banner tone="danger">{errorMessage(saveTemplate.error)}</Banner>}
          <Field label="Template name">
            <TextInput value={templateName} onChange={(event) => setTemplateName(event.target.value)} autoFocus />
          </Field>
        </div>
      </Dialog>
    </>
  )
}

/* ---- Review and send ---------------------------------------------------- */

const FIX: Record<CampaignCheck['key'], { step?: Step; to?: string; label: string }> = {
  subject: { step: 'details', label: 'Add a subject' },
  content: { step: 'design', label: 'Open the design' },
  audience: { step: 'audience', label: 'Choose the audience' },
  account: { to: '/settings/sending', label: 'Sending accounts' },
  address: { to: '/settings/organization', label: 'Add your address' },
  public_url: { to: '/settings/organization', label: 'Set a public URL' },
  unsubscribe: { step: 'design', label: 'Open the design' },
}

function ReviewStep({
  campaign,
  draft,
  dirty,
  saveNow,
  goTo,
  canEdit,
}: {
  campaign: Campaign
  draft: Draft
  dirty: boolean
  saveNow: () => Promise<boolean>
  goTo: (step: Step) => void
  canEdit: boolean
}) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const me = useAuthState().data?.user
  const settings = useSettings()

  // The checks and the preview describe what is saved, so they wait for the save.
  const checks = useQuery({
    queryKey: ['campaign-checks', campaign.id],
    queryFn: () => api.get<CampaignCheck[]>(`/campaigns/${campaign.id}/checks`),
    enabled: !dirty,
  })
  const preview = useQuery({
    queryKey: ['campaign-preview', campaign.id],
    queryFn: () => api.get<{ subject: string; html: string }>(`/campaigns/${campaign.id}/preview`),
    enabled: !dirty,
  })
  const estimate = useQuery({
    queryKey: ['audience-estimate', draft.audience],
    queryFn: () => api.post<AudienceEstimate>('/audience/estimate', draft.audience),
  })

  const [when, setWhen] = useState<'now' | 'later'>(campaign.status === 'scheduled' ? 'later' : 'now')
  const [at, setAt] = useState(() => toLocalInput(campaign.scheduledAt ? new Date(campaign.scheduledAt) : new Date(Date.now() + 3_600_000)))
  const [confirming, setConfirming] = useState(false)
  const [testTo, setTestTo] = useState(me?.email ?? '')

  const blocking = (checks.data ?? []).filter((check) => !check.ok && check.severity === 'error')
  const recipients = estimate.data?.sendable ?? 0
  const scheduleDate = new Date(at)
  const scheduleOk = when === 'now' || (!Number.isNaN(scheduleDate.getTime()) && scheduleDate.getTime() > Date.now())

  const send = useMutation({
    mutationFn: async () => {
      if (!(await saveNow())) throw new Error('Your latest changes could not be saved, so nothing was sent.')
      return api.post<Campaign>(`/campaigns/${campaign.id}/send`, { scheduledAt: when === 'later' ? scheduleDate.toISOString() : null })
    },
    onSuccess: (updated) => {
      setConfirming(false)
      client.setQueryData(['campaign', campaign.id], updated)
      void client.invalidateQueries({ queryKey: ['campaigns'] })
      if (updated.status === 'scheduled') {
        toast.success(`Scheduled for ${formatDateTime(updated.scheduledAt)}`)
        navigate('/campaigns')
      } else {
        toast.success(`Sending to ${plural(updated.stats.recipients, 'person', 'people')}`)
      }
    },
  })

  const test = useMutation({
    mutationFn: async () => {
      if (!(await saveNow())) throw new Error('Your latest changes could not be saved, so the test was not sent.')
      const to = testTo.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean)
      return api.post<{ sent: string[]; failed: { to: string; message: string }[] }>(`/campaigns/${campaign.id}/test`, { to })
    },
    onSuccess: ({ sent, failed }) => {
      if (sent.length) toast.success(`Test sent to ${sent.join(', ')}`, { description: 'It is marked [Test] and is not counted in the report.' })
      for (const failure of failed) toast.error(`The test to ${failure.to} did not send`, { description: failure.message })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const account = useAccounts().data?.find((entry) => (draft.accountId ? entry.id === draft.accountId : entry.isDefault))

  return (
    <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-4">
          <h2 className="text-h4 text-[var(--ds-fg)]">Before it goes</h2>
          {dirty || checks.isPending ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3].map((key) => (
                <Skeleton key={key} className="h-5" />
              ))}
            </div>
          ) : checks.isError ? (
            <Banner tone="danger">{errorMessage(checks.error)}</Banner>
          ) : (
            <ul className="flex flex-col gap-3">
              {checks.data.map((check, index) => {
                const fix = FIX[check.key]
                return (
                  <li key={`${check.key}-${index}`} className="flex items-start gap-2.5">
                    {check.ok ? (
                      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--ds-success-text)]" aria-label="Ready" />
                    ) : check.severity === 'error' ? (
                      <XCircle size={16} className="mt-0.5 shrink-0 text-[var(--ds-danger-text)]" aria-label="Needs fixing" />
                    ) : (
                      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--ds-warning-text)]" aria-label="Worth a look" />
                    )}
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-body-sm text-[var(--ds-fg-secondary)]">{check.message}</span>
                      {!check.ok &&
                        (fix.step ? (
                          <button type="button" onClick={() => goTo(fix.step!)} className="self-start text-label text-[var(--ds-accent-text)] underline underline-offset-2">
                            {fix.label}
                          </button>
                        ) : (
                          <Link to={fix.to!} className="self-start text-label text-[var(--ds-accent-text)] underline underline-offset-2">
                            {fix.label}
                          </Link>
                        ))}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {canEdit && (
          <Card className="flex flex-col gap-4">
            <h2 className="text-h4 text-[var(--ds-fg)]">Send yourself a test</h2>
            <Field label="Send to" hint="Up to ten addresses, separated by commas.">
              <TextInput value={testTo} onChange={(event) => setTestTo(event.target.value)} inputMode="email" autoComplete="email" />
            </Field>
            <Button variant="outlined" startIcon={<Send />} onClick={() => test.mutate()} loading={test.isPending} disabled={!testTo.trim()} className="self-start">
              Send test
            </Button>
          </Card>
        )}

        {canEdit && (
          <Card className="flex flex-col gap-5">
            <h2 className="text-h4 text-[var(--ds-fg)]">Send it</h2>
            <RadioGroup
              label="When"
              value={when}
              onChange={setWhen}
              options={[
                { value: 'now', label: 'Now', description: 'It starts going out as soon as you confirm.' },
                { value: 'later', label: 'At a time I choose', description: `In your browser's time zone.` },
              ]}
            />
            {when === 'later' && (
              <Field label="Send at" error={scheduleOk ? undefined : 'Choose a time in the future.'}>
                <TextInput type="datetime-local" value={at} min={toLocalInput(new Date())} onChange={(event) => setAt(event.target.value)} />
              </Field>
            )}
            {account && recipients > account.dailyLimit && (
              <p className="text-caption text-[var(--ds-fg-muted)]">
                {account.label} sends {formatNumber(account.dailyLimit)} a day, so this will go out over about {Math.ceil(recipients / account.dailyLimit)} days.
              </p>
            )}
            <Button
              startIcon={when === 'later' ? <CalendarClock /> : <Send />}
              onClick={() => {
                send.reset()
                setConfirming(true)
              }}
              disabled={dirty ? false : checks.isPending || blocking.length > 0 || !scheduleOk || recipients === 0}
              className="self-start"
            >
              {when === 'later' ? 'Schedule' : `Send to ${plural(recipients, 'person', 'people')}`}
            </Button>
            {blocking.length > 0 && !dirty && (
              <p className="text-caption text-[var(--ds-danger-text)]">
                {blocking.length === 1 ? 'One thing above needs fixing first.' : `${blocking.length} things above need fixing first.`}
              </p>
            )}
          </Card>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <h2 className="text-h4 text-[var(--ds-fg)]">What they will get</h2>
        {dirty || preview.isPending ? (
          <Skeleton className="h-[32rem] rounded-[var(--radius-lg)]" />
        ) : preview.isError ? (
          <Banner tone="danger">{errorMessage(preview.error)}</Banner>
        ) : (
          <EmailPreview
            html={preview.data.html}
            merged
            subject={preview.data.subject}
            from={account ? `${draft.fromName || account.fromName} <${account.fromEmail}>` : undefined}
          />
        )}
        <p className="text-caption text-[var(--ds-fg-muted)]">
          Shown with sample details in place of each person's own. The footer with your address and the unsubscribe link is included
          {settings.data?.publicUrlIsLocal ? ', though its links point at this computer until a public URL is set' : ''}.
        </p>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => send.mutate()}
        title={when === 'later' ? 'Schedule this campaign?' : `Send to ${plural(recipients, 'person', 'people')}?`}
        confirmLabel={when === 'later' ? 'Schedule it' : 'Send now'}
        danger={false}
        loading={send.isPending}
      >
        <p>
          <strong className="text-[var(--ds-fg)]">{draft.subject || 'No subject'}</strong>
          {account ? ` from ${draft.fromName || account.fromName}.` : '.'}
        </p>
        <p>
          {when === 'later'
            ? `It goes to ${plural(recipients, 'person', 'people')} on ${formatDateTime(scheduleDate.toISOString())}. You can change or unschedule it until then.`
            : 'It starts going out straight away. Once sent, an email cannot be taken back.'}
        </p>
        {send.isError && <Banner tone="danger">{errorMessage(send.error)}</Banner>}
      </ConfirmDialog>
    </div>
  )
}
