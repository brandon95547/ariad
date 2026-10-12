import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Mail,
  Pause,
  Pencil,
  Play,
  Plus,
  Save,
  Tag,
  Trash2,
  Zap,
} from 'lucide-react'
import {
  TRIGGER_LABELS,
  roleAtLeast,
  type Automation,
  type AutomationRun,
  type AutomationStep,
  type AutomationTrigger,
  type AutomationTriggerType,
  type CampaignSummary,
  type Paged,
  type SignupForm,
} from '@ariad/shared'
import { UnsavedGuard } from '@/components/UnsavedGuard'
import { EmailEditor } from '@/features/email/EmailEditor'
import { MergeTagMenu, insertAtCursor } from '@/features/email/MergeTagMenu'
import { ApiError, api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDateTime, formatNumber, formatRate, formatRelative, rate } from '@/lib/format'
import { useAccounts, useAuthState, useFields, useLists, useTags } from '@/lib/queries'
import { Badge } from '@/ui/Badge'
import { Button, IconButton } from '@/ui/Button'
import { Field, Select } from '@/ui/Controls'
import { DataTable, type Column } from '@/ui/DataTable'
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback'
import { TextInput } from '@/ui/Inputs'
import { Popover } from '@/ui/Menu'
import { Page, PageHeader } from '@/ui/Shell'
import { StatTile } from '@/ui/Stat'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'
import { AUTOMATION_BADGE, delayStep, emailStep } from './AutomationsPage'

type Draft = Pick<Automation, 'name' | 'trigger' | 'steps' | 'accountId'>
const toDraft = (automation: Automation): Draft => ({
  name: automation.name,
  trigger: automation.trigger,
  steps: automation.steps,
  accountId: automation.accountId,
})

const DEFAULT_TRIGGERS: Record<AutomationTriggerType, AutomationTrigger> = {
  list_subscribed: { type: 'list_subscribed', listId: null },
  form_submitted: { type: 'form_submitted', formId: null },
  tag_added: { type: 'tag_added', tagId: '' },
  date: { type: 'date', field: 'birthday', offsetDays: 0, hour: 9 },
  campaign_followup: {
    type: 'campaign_followup',
    campaignId: null,
    condition: 'not_opened',
    afterDays: 3,
  },
  manual: { type: 'manual' },
}

const hourLabel = (hour: number) =>
  `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? 'AM' : 'PM'}`

/** One automation: what starts it, and the steps a contact then goes through. */
export function AutomationEditorPage() {
  const { id = '' } = useParams()
  const automation = useQuery({
    queryKey: ['automation', id],
    queryFn: () => api.get<Automation>(`/automations/${id}`),
  })

  if (automation.isPending) {
    return (
      <Page>
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-80 rounded-[var(--radius-xl)]" />
      </Page>
    )
  }
  if (automation.isError) {
    const missing = automation.error instanceof ApiError && automation.error.status === 404
    return (
      <Page>
        <PageHeader title="Automation" back={{ to: '/automations', label: 'Automations' }} />
        {missing ? (
          <EmptyState title="This automation no longer exists" />
        ) : (
          <Banner tone="danger">{errorMessage(automation.error)}</Banner>
        )}
      </Page>
    )
  }
  return <Editor key={automation.data.id} automation={automation.data} />
}

function Editor({ automation }: { automation: Automation }) {
  const client = useQueryClient()
  const canEdit = roleAtLeast(useAuthState().data?.user?.role ?? 'viewer', 'editor')
  const [draft, setDraft] = useState<Draft>(() => toDraft(automation))
  const [saved, setSaved] = useState<Draft>(() => toDraft(automation))
  const [editing, setEditing] = useState<string | null>(null)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved])
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }))
  const accounts = useAccounts()

  const settle = (updated: Automation) => {
    client.setQueryData(['automation', automation.id], updated)
    void client.invalidateQueries({ queryKey: ['automations'] })
  }

  const save = useMutation({
    mutationFn: (body: Draft) => api.patch<Automation>(`/automations/${automation.id}`, body),
    onSuccess: (updated, body) => {
      setSaved(body)
      settle(updated)
    },
    onError: (error) =>
      toast.error('Your changes were not saved', { description: errorMessage(error) }),
  })

  const toggle = useMutation({
    mutationFn: async () => {
      // What gets turned on is what is on screen, so save it first.
      if (dirty) {
        await save.mutateAsync(draft)
      }
      return api.post<Automation>(
        `/automations/${automation.id}/${automation.status === 'active' ? 'pause' : 'activate'}`,
      )
    },
    onSuccess: (updated) => {
      settle(updated)
      toast.success(updated.status === 'active' ? 'Turned on' : 'Paused', {
        description:
          updated.status === 'active'
            ? 'It now runs for every contact who meets the trigger from here on.'
            : 'Everyone partway through stays where they are until it is turned back on.',
      })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const setStep = (id: string, next: Partial<AutomationStep>) =>
    patch({
      steps: draft.steps.map((step) =>
        step.id === id ? ({ ...step, ...next } as AutomationStep) : step,
      ),
    })
  const addStep = (step: AutomationStep, at: number) =>
    patch({ steps: [...draft.steps.slice(0, at), step, ...draft.steps.slice(at)] })
  const removeStep = (id: string) => patch({ steps: draft.steps.filter((step) => step.id !== id) })
  const moveStep = (index: number, delta: -1 | 1) => {
    const steps = [...draft.steps]
    const [step] = steps.splice(index, 1)
    if (!step) return
    steps.splice(index + delta, 0, step)
    patch({ steps })
  }

  const editingStep = draft.steps.find((step) => step.id === editing && step.type === 'email')
  const badge = AUTOMATION_BADGE[automation.status]

  /* ---- One email step, full page ---------------------------------------- */

  if (editingStep && editingStep.type === 'email') {
    return (
      <EmailStepEditor
        step={editingStep}
        onChange={(next) => setStep(editingStep.id, next)}
        onDone={() => setEditing(null)}
        automationName={draft.name}
      />
    )
  }

  /* ---- The flow --------------------------------------------------------- */

  return (
    <Page>
      <PageHeader
        title={draft.name || 'Untitled automation'}
        back={{ to: '/automations', label: 'Automations' }}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={badge.tone} dot={automation.status === 'active'}>
              {badge.label}
            </Badge>
            <span>
              {save.isPending ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}
            </span>
          </span>
        }
        actions={
          canEdit ? (
            <>
              <Button
                variant="outlined"
                startIcon={<Save />}
                onClick={() => save.mutate(draft)}
                disabled={!dirty}
                loading={save.isPending}
              >
                Save
              </Button>
              {automation.status === 'active' ? (
                <Button
                  variant="outlined"
                  startIcon={<Pause />}
                  onClick={() => toggle.mutate()}
                  loading={toggle.isPending}
                >
                  Pause
                </Button>
              ) : (
                <Button
                  startIcon={<Play />}
                  onClick={() => toggle.mutate()}
                  loading={toggle.isPending}
                >
                  Turn on
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      <UnsavedGuard
        dirty={dirty && canEdit}
        onSave={() =>
          save.mutateAsync(draft).then(
            () => true,
            () => false,
          )
        }
      />

      {automation.status === 'active' && (
        <Banner tone="info" title="This automation is on">
          Changes you save apply to contacts from their next step on. Someone already waiting keeps
          the wait they were given.
        </Banner>
      )}

      <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,40rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Name">
              <TextInput
                value={draft.name}
                onChange={(event) => patch({ name: event.target.value })}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Send from" htmlFor="automation-account">
              <Select
                id="automation-account"
                value={draft.accountId ?? ''}
                onChange={(event) => patch({ accountId: event.target.value || null })}
                disabled={!canEdit}
                options={[
                  { value: '', label: 'Default account' },
                  ...(accounts.data ?? [])
                    .filter((account) => account.enabled)
                    .map((account) => ({ value: account.id, label: account.label })),
                ]}
              />
            </Field>
          </div>

          <ol className="flex flex-col">
            <li>
              <FlowCard icon={<Zap />} tone="accent" title="Starts">
                <TriggerEditor
                  trigger={draft.trigger}
                  onChange={(trigger) => patch({ trigger })}
                  disabled={!canEdit}
                />
              </FlowCard>
            </li>

            {draft.steps.map((step, index) => (
              <li key={step.id}>
                <Connector>
                  {canEdit && <AddStep onAdd={(next) => addStep(next, index)} />}
                </Connector>
                <FlowCard
                  icon={
                    step.type === 'email' ? <Mail /> : step.type === 'delay' ? <Clock /> : <Tag />
                  }
                  title={
                    step.type === 'email'
                      ? 'Send an email'
                      : step.type === 'delay'
                        ? 'Wait'
                        : step.type === 'add_tag'
                          ? 'Add a tag'
                          : 'Remove a tag'
                  }
                  actions={
                    canEdit ? (
                      <>
                        <IconButton
                          size="sm"
                          label="Move up"
                          icon={<ArrowUp />}
                          onClick={() => moveStep(index, -1)}
                          disabled={index === 0}
                        />
                        <IconButton
                          size="sm"
                          label="Move down"
                          icon={<ArrowDown />}
                          onClick={() => moveStep(index, 1)}
                          disabled={index === draft.steps.length - 1}
                        />
                        <IconButton
                          size="sm"
                          label="Remove step"
                          icon={<Trash2 />}
                          onClick={() => removeStep(step.id)}
                        />
                      </>
                    ) : undefined
                  }
                >
                  <StepBody
                    step={step}
                    onChange={(next) => setStep(step.id, next)}
                    onEdit={() => setEditing(step.id)}
                    disabled={!canEdit}
                  />
                </FlowCard>
              </li>
            ))}

            <li>
              <Connector>
                {canEdit && <AddStep onAdd={(next) => addStep(next, draft.steps.length)} />}
              </Connector>
              <p className="pl-1 text-body-sm text-[var(--ds-fg-muted)]">
                {draft.steps.length === 0
                  ? 'Add a step: an automation with nothing in it does nothing.'
                  : 'The contact is finished here.'}
              </p>
            </li>
          </ol>
        </div>

        <Activity automation={automation} />
      </div>
    </Page>
  )
}

/* ---- Flow pieces -------------------------------------------------------- */

function FlowCard({
  icon,
  title,
  tone = 'neutral',
  actions,
  children,
}: {
  icon: ReactNode
  title: string
  tone?: 'neutral' | 'accent'
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-md)] [&>svg]:size-4',
              tone === 'accent'
                ? 'bg-[var(--ds-accent-subtle)] text-[var(--ds-accent-text)]'
                : 'bg-[var(--ds-surface-raised)] text-[var(--ds-fg-secondary)]',
            )}
            aria-hidden
          >
            {icon}
          </span>
          <h2 className="text-h4 text-[var(--ds-fg)]">{title}</h2>
        </div>
        {actions && <div className="flex items-center gap-0.5 coarse:gap-3">{actions}</div>}
      </div>
      {children}
    </Card>
  )
}

/** The line from one step to the next, with the place to add a step on it. */
function Connector({ children }: { children?: ReactNode }) {
  return (
    <div className="relative flex h-14 items-center pl-[2.125rem]">
      <span className="absolute inset-y-0 left-9 w-px bg-[var(--ds-border-strong)]" aria-hidden />
      <div className="relative ml-4">{children}</div>
    </div>
  )
}

function AddStep({ onAdd }: { onAdd: (step: AutomationStep) => void }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const tags = useTags()
  const firstTag = tags.data?.[0]?.id ?? ''
  const add = (step: AutomationStep) => {
    setOpen(false)
    onAdd(step)
  }
  const id = () => `s_${Math.random().toString(36).slice(2, 10)}`
  return (
    <>
      <Button
        ref={trigger}
        size="xs"
        variant="outlined"
        startIcon={<Plus />}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Add step
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={trigger}
        label="Add a step"
        role="menu"
        className="popover--menu"
      >
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          onClick={() =>
            add(
              emailStep(
                '',
                'A heading',
                '<p>Hi {{first_name|there}},</p><p>Write your message here.</p>',
              ),
            )
          }
        >
          <span className="menu-item__mark" aria-hidden>
            <Mail size={14} />
          </span>
          Send an email
        </button>
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          onClick={() => add(delayStep(1, 'days'))}
        >
          <span className="menu-item__mark" aria-hidden>
            <Clock size={14} />
          </span>
          Wait
        </button>
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          disabled={!firstTag}
          title={firstTag ? undefined : 'Create a tag first'}
          onClick={() => add({ id: id(), type: 'add_tag', tagId: firstTag })}
        >
          <span className="menu-item__mark" aria-hidden>
            <Tag size={14} />
          </span>
          Add a tag
        </button>
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          disabled={!firstTag}
          title={firstTag ? undefined : 'Create a tag first'}
          onClick={() => add({ id: id(), type: 'remove_tag', tagId: firstTag })}
        >
          <span className="menu-item__mark" aria-hidden>
            <Tag size={14} />
          </span>
          Remove a tag
        </button>
      </Popover>
    </>
  )
}

function StepBody({
  step,
  onChange,
  onEdit,
  disabled,
}: {
  step: AutomationStep
  onChange: (next: Partial<AutomationStep>) => void
  onEdit: () => void
  disabled: boolean
}) {
  const tags = useTags()

  if (step.type === 'email') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-caption text-[var(--ds-fg-muted)]">Subject</span>
          <span
            className={cn(
              'truncate text-body-sm',
              step.subject ? 'text-[var(--ds-fg)]' : 'text-[var(--ds-danger-text)]',
            )}
          >
            {step.subject || 'No subject yet'}
          </span>
        </div>
        {!disabled && (
          <Button size="sm" variant="outlined" startIcon={<Pencil />} onClick={onEdit}>
            Edit email
          </Button>
        )}
      </div>
    )
  }

  if (step.type === 'delay') {
    return (
      <div className="flex items-end gap-3">
        <Field label="For" className="w-24">
          <TextInput
            value={String(step.amount)}
            inputMode="numeric"
            disabled={disabled}
            onChange={(event) =>
              onChange({
                amount: Math.max(
                  1,
                  Math.min(365, Number(event.target.value.replace(/\D/g, '')) || 1),
                ),
              })
            }
          />
        </Field>
        <Field label="Unit" htmlFor={`unit-${step.id}`} className="w-36">
          <Select
            id={`unit-${step.id}`}
            value={step.unit}
            disabled={disabled}
            onChange={(event) =>
              onChange({ unit: event.target.value as 'minutes' | 'hours' | 'days' })
            }
            options={[
              { value: 'minutes', label: step.amount === 1 ? 'minute' : 'minutes' },
              { value: 'hours', label: step.amount === 1 ? 'hour' : 'hours' },
              { value: 'days', label: step.amount === 1 ? 'day' : 'days' },
            ]}
          />
        </Field>
      </div>
    )
  }

  return (
    <Field label="Tag" htmlFor={`tag-${step.id}`} className="max-w-[18rem]">
      <Select
        id={`tag-${step.id}`}
        value={step.tagId}
        disabled={disabled}
        onChange={(event) => onChange({ tagId: event.target.value })}
        options={(tags.data ?? []).map((tag) => ({ value: tag.id, label: tag.name }))}
      />
    </Field>
  )
}

function TriggerEditor({
  trigger,
  onChange,
  disabled,
}: {
  trigger: AutomationTrigger
  onChange: (trigger: AutomationTrigger) => void
  disabled: boolean
}) {
  const lists = useLists()
  const tags = useTags()
  const fields = useFields()
  const forms = useQuery({
    queryKey: ['forms'],
    queryFn: () => api.get<SignupForm[]>('/forms'),
    enabled: trigger.type === 'form_submitted',
  })
  const campaigns = useQuery({
    queryKey: ['campaigns', { status: 'sent', pageSize: 50 }],
    queryFn: () => api.get<Paged<CampaignSummary>>('/campaigns?status=sent&pageSize=50'),
    enabled: trigger.type === 'campaign_followup',
  })
  const dateFields = (fields.data ?? []).filter((field) => field.type === 'date')

  return (
    <div className="flex flex-col gap-4">
      <Field label="When" htmlFor="trigger-type" hint={TRIGGER_LABELS[trigger.type].description}>
        <Select
          id="trigger-type"
          value={trigger.type}
          disabled={disabled}
          onChange={(event) =>
            onChange(DEFAULT_TRIGGERS[event.target.value as AutomationTriggerType])
          }
          options={(Object.keys(TRIGGER_LABELS) as AutomationTriggerType[]).map((type) => ({
            value: type,
            label: TRIGGER_LABELS[type].label,
          }))}
        />
      </Field>

      {trigger.type === 'list_subscribed' && (
        <Field label="Which list" htmlFor="trigger-list">
          <Select
            id="trigger-list"
            value={trigger.listId ?? ''}
            disabled={disabled}
            onChange={(event) => onChange({ ...trigger, listId: event.target.value || null })}
            options={[
              { value: '', label: 'Any list' },
              ...(lists.data ?? []).map((list) => ({ value: list.id, label: list.name })),
            ]}
          />
        </Field>
      )}

      {trigger.type === 'tag_added' && (
        <Field
          label="Which tag"
          htmlFor="trigger-tag"
          error={trigger.tagId ? undefined : 'Choose the tag that starts this.'}
        >
          <Select
            id="trigger-tag"
            value={trigger.tagId}
            disabled={disabled}
            onChange={(event) => onChange({ ...trigger, tagId: event.target.value })}
            options={[
              { value: '', label: 'Choose a tag', disabled: true },
              ...(tags.data ?? []).map((tag) => ({ value: tag.id, label: tag.name })),
            ]}
          />
        </Field>
      )}

      {trigger.type === 'form_submitted' && (
        <Field label="Which form" htmlFor="trigger-form">
          <Select
            id="trigger-form"
            value={trigger.formId ?? ''}
            disabled={disabled}
            onChange={(event) => onChange({ ...trigger, formId: event.target.value || null })}
            options={[
              { value: '', label: 'Any form' },
              ...(forms.data ?? []).map((form) => ({ value: form.id, label: form.name })),
            ]}
          />
        </Field>
      )}

      {trigger.type === 'date' && (
        <>
          <Field label="Which date" htmlFor="trigger-date-field">
            <Select
              id="trigger-date-field"
              value={trigger.field}
              disabled={disabled}
              onChange={(event) => onChange({ ...trigger, field: event.target.value })}
              options={[
                { value: 'birthday', label: 'Birthday' },
                { value: 'created_at', label: 'The day they joined (anniversary)' },
                ...dateFields.map((field) => ({
                  value: `custom.${field.key}`,
                  label: field.label,
                })),
              ]}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_6rem_9rem]">
            <Field label="Send" htmlFor="trigger-date-when">
              <Select
                id="trigger-date-when"
                value={
                  trigger.offsetDays === 0 ? 'on' : trigger.offsetDays < 0 ? 'before' : 'after'
                }
                disabled={disabled}
                onChange={(event) => {
                  const days = Math.max(1, Math.abs(trigger.offsetDays))
                  onChange({
                    ...trigger,
                    offsetDays:
                      event.target.value === 'on'
                        ? 0
                        : event.target.value === 'before'
                          ? -days
                          : days,
                  })
                }}
                options={[
                  { value: 'on', label: 'On the day' },
                  { value: 'before', label: 'Days before' },
                  { value: 'after', label: 'Days after' },
                ]}
              />
            </Field>
            <Field label="Days">
              <TextInput
                value={String(Math.abs(trigger.offsetDays))}
                inputMode="numeric"
                disabled={disabled || trigger.offsetDays === 0}
                onChange={(event) => {
                  const days = Math.max(
                    1,
                    Math.min(60, Number(event.target.value.replace(/\D/g, '')) || 1),
                  )
                  onChange({ ...trigger, offsetDays: trigger.offsetDays < 0 ? -days : days })
                }}
              />
            </Field>
            <Field label="At" htmlFor="trigger-date-hour">
              <Select
                id="trigger-date-hour"
                value={String(trigger.hour)}
                disabled={disabled}
                onChange={(event) => onChange({ ...trigger, hour: Number(event.target.value) })}
                options={Array.from({ length: 24 }, (_unused, hour) => ({
                  value: String(hour),
                  label: hourLabel(hour),
                }))}
              />
            </Field>
          </div>
          <p className="text-caption text-[var(--ds-fg-muted)]">
            Every year, in the time zone set under Settings. Contacts without that date on their
            record are skipped.
          </p>
        </>
      )}

      {trigger.type === 'campaign_followup' && (
        <>
          <Field label="Which campaign" htmlFor="trigger-campaign">
            <Select
              id="trigger-campaign"
              value={trigger.campaignId ?? ''}
              disabled={disabled}
              onChange={(event) => onChange({ ...trigger, campaignId: event.target.value || null })}
              options={[
                { value: '', label: 'Every campaign' },
                ...(campaigns.data?.items ?? []).map((campaign) => ({
                  value: campaign.id,
                  label: campaign.name,
                })),
              ]}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_7rem]">
            <Field label="Send to" htmlFor="trigger-condition">
              <Select
                id="trigger-condition"
                value={trigger.condition}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...trigger,
                    condition: event.target.value as typeof trigger.condition,
                  })
                }
                options={[
                  { value: 'not_opened', label: 'People who did not open it' },
                  { value: 'opened', label: 'People who opened it' },
                  { value: 'not_clicked', label: 'People who did not click' },
                  { value: 'clicked', label: 'People who clicked' },
                  { value: 'sent', label: 'Everyone it was sent to' },
                ]}
              />
            </Field>
            <Field label="Days after">
              <TextInput
                value={String(trigger.afterDays)}
                inputMode="numeric"
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...trigger,
                    afterDays: Math.max(
                      0,
                      Math.min(90, Number(event.target.value.replace(/\D/g, '')) || 0),
                    ),
                  })
                }
              />
            </Field>
          </div>
        </>
      )}

      {trigger.type === 'manual' && (
        <p className="text-body-sm text-[var(--ds-fg-muted)]">
          Nothing starts this by itself. Add a contact from their own page, under{' '}
          <Link
            to="/contacts"
            className="text-[var(--ds-accent-text)] underline underline-offset-2"
          >
            Contacts
          </Link>
          .
        </p>
      )}
    </div>
  )
}

/* ---- One email step ----------------------------------------------------- */

function EmailStepEditor({
  step,
  onChange,
  onDone,
  automationName,
}: {
  step: Extract<AutomationStep, { type: 'email' }>
  onChange: (next: Partial<AutomationStep>) => void
  onDone: () => void
  automationName: string
}) {
  const subject = useRef<HTMLInputElement>(null)
  return (
    <Page>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-label text-[var(--ds-fg-muted)]">{automationName}</span>
            <h1 className="text-h1 text-[var(--ds-fg)]">Edit email</h1>
          </div>
          <Button onClick={onDone}>Done</Button>
        </div>
      </header>
      <div className="grid max-w-[44rem] grid-cols-1 gap-5">
        <Field
          label="Subject line"
          error={
            step.subject.trim()
              ? undefined
              : 'An email needs a subject before the automation can be turned on.'
          }
        >
          <TextInput
            ref={subject}
            value={step.subject}
            onChange={(event) => onChange({ subject: event.target.value })}
          />
        </Field>
        <div className="-mt-2 flex">
          <MergeTagMenu
            onPick={(token) =>
              onChange({ subject: insertAtCursor(subject.current, step.subject, token) })
            }
          />
        </div>
        <Field label="Preview text" optional>
          <TextInput
            value={step.preheader ?? ''}
            onChange={(event) => onChange({ preheader: event.target.value || null })}
          />
        </Field>
      </div>
      <EmailEditor
        value={{ html: step.html, design: step.design }}
        onChange={(body) => onChange(body)}
        subject={step.subject}
        preheader={step.preheader}
      />
      <p className="text-caption text-[var(--ds-fg-muted)]">
        Done takes you back to the automation. Save it there to keep these changes.
      </p>
    </Page>
  )
}

/* ---- Who has been through it -------------------------------------------- */

const RUN_BADGE: Record<
  AutomationRun['status'],
  { tone: 'accent' | 'success' | 'neutral' | 'danger'; label: string }
> = {
  active: { tone: 'accent', label: 'In progress' },
  completed: { tone: 'success', label: 'Finished' },
  exited: { tone: 'neutral', label: 'Left early' },
  failed: { tone: 'danger', label: 'Failed' },
}

function Activity({ automation }: { automation: Automation }) {
  const runs = useQuery({
    queryKey: ['automation-runs', automation.id],
    queryFn: () => api.get<Paged<AutomationRun>>(`/automations/${automation.id}/runs?pageSize=10`),
    refetchInterval: automation.status === 'active' ? 15_000 : false,
  })
  const { stats } = automation
  const columns: Column<AutomationRun>[] = [
    {
      key: 'email',
      header: 'Contact',
      cell: (row) => (
        <Link
          to={`/contacts/${row.contactId}`}
          className="text-[var(--ds-fg)] underline-offset-2 hover:underline"
        >
          {row.email}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '8rem',
      cell: (row) => (
        <span title={row.note ?? undefined}>
          <Badge tone={RUN_BADGE[row.status].tone}>{RUN_BADGE[row.status].label}</Badge>
        </span>
      ),
    },
    {
      key: 'when',
      header: 'Next',
      width: '9rem',
      hideBelow: 'sm',
      cell: (row) => (
        <span
          className="text-[var(--ds-fg-muted)]"
          title={row.nextRunAt ? formatDateTime(row.nextRunAt) : undefined}
        >
          {row.status === 'active' && row.nextRunAt
            ? formatRelative(row.nextRunAt)
            : (row.note ?? '—')}
        </span>
      ),
    },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="In progress" value={formatNumber(stats.active)} />
        <StatTile
          label="Finished"
          value={formatNumber(stats.completed)}
          hint={stats.exited ? `${formatNumber(stats.exited)} left early` : undefined}
        />
        <StatTile label="Emails sent" value={formatNumber(stats.emailsSent)} />
        <StatTile
          label="Opened"
          value={formatRate(rate(stats.opened, stats.emailsSent))}
          hint={
            stats.emailsSent
              ? `${formatRate(rate(stats.clicked, stats.emailsSent))} clicked`
              : undefined
          }
        />
      </div>
      <h2 className="text-h4 text-[var(--ds-fg)]">Recent contacts</h2>
      {runs.isError && <Banner tone="danger">{errorMessage(runs.error)}</Banner>}
      <Card padding="none" className="overflow-hidden">
        <DataTable
          aria-label="Contacts in this automation"
          columns={columns}
          rows={runs.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={runs.isPending}
          skeletonRows={3}
          empty={
            <EmptyState
              compact
              title="Nobody yet"
              description={
                automation.status === 'active'
                  ? 'Contacts appear here as they meet the trigger.'
                  : 'Turn the automation on and contacts appear here as they meet the trigger.'
              }
            />
          }
        />
      </Card>
    </div>
  )
}
