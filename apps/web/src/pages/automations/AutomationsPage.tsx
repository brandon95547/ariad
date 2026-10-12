import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { MoreHorizontal, Pause, Pencil, Play, Plus, Trash2, Workflow } from 'lucide-react'
import {
  DEFAULT_THEME,
  renderDesign,
  roleAtLeast,
  type Automation,
  type AutomationInput,
  type AutomationStep,
  type AutomationTrigger,
  type Block,
  type EmailDesign,
} from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { api, errorMessage } from '@/lib/api'
import { formatNumber, formatRate, plural, rate } from '@/lib/format'
import { useAuthState, useLists, useTags } from '@/lib/queries'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Controls'
import { Dialog } from '@/ui/Dialog'
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback'
import { RadioGroup, TextInput } from '@/ui/Inputs'
import { ActionMenu } from '@/ui/Menu'
import { Page, PageHeader } from '@/ui/Shell'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'

export const AUTOMATION_BADGE = {
  draft: { tone: 'neutral', label: 'Draft' },
  active: { tone: 'success', label: 'On' },
  paused: { tone: 'warning', label: 'Paused' },
} as const

const stepId = () => `s_${Math.random().toString(36).slice(2, 10)}`

/** An email step with something in it, so a new automation is one edit away from usable. */
export function emailStep(subject: string, heading: string, body: string): AutomationStep {
  const blocks: Block[] = [
    { id: 'h', type: 'heading', text: heading, level: 1, align: 'left' },
    { id: 't', type: 'text', html: body, align: 'left' },
  ]
  const design: EmailDesign = { version: 1, theme: { ...DEFAULT_THEME }, blocks }
  return { id: stepId(), type: 'email', subject, preheader: null, design, html: renderDesign(design, { title: subject }) }
}

export const delayStep = (amount: number, unit: 'minutes' | 'hours' | 'days'): AutomationStep => ({ id: stepId(), type: 'delay', amount, unit })

const hi = '<p>Hi {{first_name|there}},</p>'

/** Ready-made starting points. Each is a trigger and the steps most people want after it. */
const RECIPES: { key: string; label: string; description: string; name: string; trigger: AutomationTrigger; steps: () => AutomationStep[] }[] = [
  {
    key: 'welcome',
    label: 'Welcome new subscribers',
    description: 'One email, sent as soon as someone joins a list.',
    name: 'Welcome email',
    trigger: { type: 'list_subscribed', listId: null },
    steps: () => [emailStep('Welcome to {{organization}}', 'Welcome', `${hi}<p>Thanks for subscribing. Here is what you can expect from us, and how often.</p>`)],
  },
  {
    key: 'series',
    label: 'Welcome series',
    description: 'Three emails over a week, to introduce yourself properly.',
    name: 'Welcome series',
    trigger: { type: 'list_subscribed', listId: null },
    steps: () => [
      emailStep('Welcome to {{organization}}', 'Welcome', `${hi}<p>Thanks for subscribing. Here is what you can expect from us.</p>`),
      delayStep(2, 'days'),
      emailStep('The one thing to read first', 'Start here', `${hi}<p>If you only read one thing from us, make it this.</p>`),
      delayStep(5, 'days'),
      emailStep('How can we help?', 'A quick question', `${hi}<p>What made you sign up? Reply to this email. A person reads every one.</p>`),
    ],
  },
  {
    key: 'birthday',
    label: 'Birthday greeting',
    description: 'Sent each year on the morning of a contact’s birthday.',
    name: 'Birthday greeting',
    trigger: { type: 'date', field: 'birthday', offsetDays: 0, hour: 9 },
    steps: () => [emailStep('Happy birthday, {{first_name|friend}}', 'Happy birthday', `${hi}<p>All of us at {{organization}} hope it is a good one.</p>`)],
  },
  {
    key: 'anniversary',
    label: 'Signup anniversary',
    description: 'Sent each year on the day someone joined.',
    name: 'Signup anniversary',
    trigger: { type: 'date', field: 'created_at', offsetDays: 0, hour: 9 },
    steps: () => [emailStep('It has been a year', 'Thank you for a year', `${hi}<p>You joined us a year ago today. Thank you for sticking around.</p>`)],
  },
  {
    key: 'followup',
    label: 'Follow up a campaign',
    description: 'A second note, three days later, to people who did not open the first.',
    name: 'Campaign follow-up',
    trigger: { type: 'campaign_followup', campaignId: null, condition: 'not_opened', afterDays: 3 },
    steps: () => [emailStep('In case you missed it', 'In case you missed it', `${hi}<p>We sent this a few days ago and thought it was worth a second look.</p>`)],
  },
  {
    key: 'blank',
    label: 'Start from scratch',
    description: 'Choose the trigger and add the steps yourself.',
    name: 'New automation',
    trigger: { type: 'manual' },
    steps: () => [],
  },
]

/** What starts an automation, as a sentence. */
export function describeTrigger(trigger: AutomationTrigger, names: { list: (id: string) => string; tag: (id: string) => string }): string {
  switch (trigger.type) {
    case 'list_subscribed':
      return trigger.listId ? `When someone subscribes to ${names.list(trigger.listId)}` : 'When someone subscribes to any list'
    case 'tag_added':
      return `When a contact is tagged ${names.tag(trigger.tagId)}`
    case 'form_submitted':
      return trigger.formId ? 'When a specific signup form is submitted' : 'When any signup form is submitted'
    case 'date': {
      const what = trigger.field === 'birthday' ? 'birthday' : trigger.field === 'created_at' ? 'signup anniversary' : `${trigger.field.replace('custom.', '')} date`
      const offset = trigger.offsetDays === 0 ? 'On' : `${Math.abs(trigger.offsetDays)} ${Math.abs(trigger.offsetDays) === 1 ? 'day' : 'days'} ${trigger.offsetDays < 0 ? 'before' : 'after'}`
      return `${offset} each contact's ${what}`
    }
    case 'campaign_followup': {
      const who = { sent: 'everyone it was sent to', opened: 'people who opened it', not_opened: 'people who did not open it', clicked: 'people who clicked', not_clicked: 'people who did not click' }[trigger.condition]
      return `${trigger.afterDays} ${trigger.afterDays === 1 ? 'day' : 'days'} after a campaign, to ${who}`
    }
    case 'manual':
      return 'When you add a contact by hand'
  }
}

/** Automations: emails that send themselves when something happens. */
export function AutomationsPage() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const canEdit = roleAtLeast(useAuthState().data?.user?.role ?? 'viewer', 'editor')
  const automations = useQuery({ queryKey: ['automations'], queryFn: () => api.get<Automation[]>('/automations') })
  const lists = useLists()
  const tags = useTags()
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<Automation | null>(null)
  const refresh = () => client.invalidateQueries({ queryKey: ['automations'] })

  const names = {
    list: (id: string) => lists.data?.find((list) => list.id === id)?.name ?? 'a deleted list',
    tag: (id: string) => tags.data?.find((tag) => tag.id === id)?.name ?? 'a deleted tag',
  }

  const toggle = useMutation({
    mutationFn: (automation: Automation) => api.post<Automation>(`/automations/${automation.id}/${automation.status === 'active' ? 'pause' : 'activate'}`),
    onSuccess: (updated) => {
      void refresh()
      toast.success(updated.status === 'active' ? `${updated.name} is on` : `${updated.name} is paused`, {
        description: updated.status === 'active' ? undefined : 'Everyone partway through stays where they are until it is turned back on.',
      })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (automation: Automation) => api.delete(`/automations/${automation.id}`),
    onSuccess: (_result, automation) => {
      setRemoving(null)
      void refresh()
      toast.success(`${automation.name} deleted`)
    },
  })

  const list = automations.data ?? []

  return (
    <Page>
      <PageHeader
        title="Automations"
        description="Emails that send themselves when something happens: a welcome when someone joins, a note on a birthday, a follow-up after a campaign."
        actions={
          canEdit && list.length > 0 ? (
            <Button startIcon={<Plus />} onClick={() => setCreating(true)}>
              New automation
            </Button>
          ) : undefined
        }
      />

      {automations.isError && <Banner tone="danger">{errorMessage(automations.error)}</Banner>}

      {automations.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28 rounded-[var(--radius-xl)]" />
          <Skeleton className="h-28 rounded-[var(--radius-xl)]" />
        </div>
      ) : list.length === 0 && !automations.isError ? (
        <Card padding="none">
          <EmptyState
            icon={<Workflow />}
            title="No automations yet"
            description="Set one up once and it runs for every contact it applies to. A welcome email is the usual place to start."
            action={
              canEdit ? (
                <Button startIcon={<Plus />} onClick={() => setCreating(true)}>
                  New automation
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((automation) => {
            const emails = automation.steps.filter((step) => step.type === 'email').length
            const badge = AUTOMATION_BADGE[automation.status]
            return (
              <li key={automation.id}>
                <Card className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        <Link to={`/automations/${automation.id}`} className="truncate text-h4 text-[var(--ds-fg)] underline-offset-2 hover:underline">
                          {automation.name}
                        </Link>
                        <Badge tone={badge.tone} dot={automation.status === 'active'}>
                          {badge.label}
                        </Badge>
                      </div>
                      <p className="text-body-sm text-[var(--ds-fg-secondary)]">{describeTrigger(automation.trigger, names)}</p>
                      <p className="text-caption text-[var(--ds-fg-muted)]">
                        {plural(automation.steps.length, 'step')} · {plural(emails, 'email')}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 items-center gap-1.5 coarse:gap-3">
                        <Button
                          size="sm"
                          variant="outlined"
                          startIcon={automation.status === 'active' ? <Pause /> : <Play />}
                          onClick={() => toggle.mutate(automation)}
                          loading={toggle.isPending && toggle.variables?.id === automation.id}
                        >
                          {automation.status === 'active' ? 'Pause' : 'Turn on'}
                        </Button>
                        <ActionMenu
                          label={`Actions for ${automation.name}`}
                          icon={<MoreHorizontal size={16} />}
                          actions={[
                            { id: 'edit', label: 'Edit', icon: <Pencil size={14} />, onSelect: () => navigate(`/automations/${automation.id}`) },
                            {
                              id: 'delete',
                              label: 'Delete',
                              icon: <Trash2 size={14} />,
                              danger: true,
                              separated: true,
                              onSelect: () => {
                                remove.reset()
                                setRemoving(automation)
                              },
                            },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[var(--ds-border-subtle)] pt-4 sm:grid-cols-4">
                    {[
                      ['In progress', formatNumber(automation.stats.active)],
                      ['Finished', formatNumber(automation.stats.completed)],
                      ['Emails sent', formatNumber(automation.stats.emailsSent)],
                      ['Opened', formatRate(rate(automation.stats.opened, automation.stats.emailsSent))],
                    ].map(([label, value]) => (
                      <div key={label} className="flex flex-col gap-1.5">
                        <dt className="text-caption text-[var(--ds-fg-muted)]">{label}</dt>
                        <dd className="text-h4 text-[var(--ds-fg)]" data-tabular>
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      <NewAutomationDialog open={creating} onClose={() => setCreating(false)} />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title={`Delete ${removing?.name ?? 'automation'}?`}
        confirmLabel="Delete automation"
        loading={remove.isPending}
      >
        <p>
          {removing && removing.stats.active > 0
            ? `${plural(removing.stats.active, 'contact is', 'contacts are')} partway through it and will get nothing further. `
            : ''}
          Emails it has already sent stay in each contact's history.
        </p>
        {remove.isError && <Banner tone="danger">{errorMessage(remove.error)}</Banner>}
      </ConfirmDialog>
    </Page>
  )
}

function NewAutomationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [recipe, setRecipe] = useState(RECIPES[0]!.key)
  const [name, setName] = useState('')
  const chosen = RECIPES.find((entry) => entry.key === recipe) ?? RECIPES[0]!

  const create = useMutation({
    mutationFn: () => {
      const body: AutomationInput = { name: name.trim() || chosen.name, trigger: chosen.trigger, steps: chosen.steps() }
      return api.post<Automation>('/automations', body)
    },
    onSuccess: (automation) => {
      void client.invalidateQueries({ queryKey: ['automations'] })
      onClose()
      setName('')
      navigate(`/automations/${automation.id}`)
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New automation"
      description="Pick a starting point. Everything in it can be changed before you turn it on."
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="new-automation" loading={create.isPending}>
            Create automation
          </Button>
        </>
      }
    >
      <form id="new-automation" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {create.isError && <Banner tone="danger">{errorMessage(create.error)}</Banner>}
        <RadioGroup
          label="Start with"
          value={recipe}
          onChange={setRecipe}
          options={RECIPES.map((entry) => ({ value: entry.key, label: entry.label, description: entry.description }))}
        />
        <Field label="Name" optional hint="For your own reference.">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder={chosen.name} />
        </Field>
      </form>
    </Dialog>
  )
}
