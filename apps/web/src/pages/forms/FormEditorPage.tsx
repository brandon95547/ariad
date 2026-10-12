import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ExternalLink, Trash2 } from 'lucide-react'
import {
  DEFAULT_CONSENT_TEXT,
  FORM_FIELD_CHOICES,
  publicFieldsOf,
  roleAtLeast,
  type CustomField,
  type FormFieldDef,
  type PublicForm,
  type SignupForm,
} from '@ariad/shared'
import { UnsavedGuard } from '@/components/UnsavedGuard'
import { FormSection } from '@/components/FormSection'
import { ApiError, api, errorMessage } from '@/lib/api'
import { useMediaQuery } from '@/lib/hooks'
import { useAuthState, useFields, useLists, useSettings, useTags } from '@/lib/queries'
import { Badge } from '@/ui/Badge'
import { Button, IconButton } from '@/ui/Button'
import { Field, Select, Switch } from '@/ui/Controls'
import { Banner, Skeleton } from '@/ui/Feedback'
import { Checkbox, TextInput, Textarea } from '@/ui/Inputs'
import { MultiSelect } from '@/ui/MultiSelect'
import { Page, PageHeader } from '@/ui/Shell'
import { Tabs } from '@/ui/Tabs'
import { toast } from '@/ui/Toast'
import { PublicFrame } from '../public/PublicFrame'
import { SignupFormBody, resultFor } from '../public/SignupFormBody'
import { formKeys } from './formKeys'
import { FormShare } from './FormShare'

type Draft = Pick<
  SignupForm,
  | 'name'
  | 'title'
  | 'buttonText'
  | 'successMessage'
  | 'listIds'
  | 'letSubscriberChoose'
  | 'tagIds'
  | 'fields'
  | 'doubleOptIn'
  | 'consentText'
  | 'consentRequired'
  | 'enabled'
> & { description: string; redirectUrl: string }

const pickDraft = (form: SignupForm): Draft => ({
  name: form.name,
  title: form.title,
  description: form.description ?? '',
  buttonText: form.buttonText,
  successMessage: form.successMessage,
  redirectUrl: form.redirectUrl ?? '',
  listIds: form.listIds,
  letSubscriberChoose: form.letSubscriberChoose,
  tagIds: form.tagIds,
  fields: form.fields,
  doubleOptIn: form.doubleOptIn,
  consentText: form.consentText,
  consentRequired: form.consentRequired,
  enabled: form.enabled,
})

/** What has to be right before the server is asked: said in the form's own words, next to the field. */
function problemsIn(draft: Draft): Record<string, string> {
  const problems: Record<string, string> = {}
  if (!draft.name.trim()) problems.name = 'Give the form a name.'
  if (!draft.title.trim()) problems.title = 'Give the form a title.'
  if (!draft.buttonText.trim())
    problems.buttonText = 'Say what the button does, for example Subscribe.'
  if (!draft.successMessage.trim())
    problems.successMessage = 'Write a line to show after someone signs up.'
  if (draft.listIds.length === 0) problems.listIds = 'Choose at least one list.'
  if (draft.redirectUrl.trim() && !/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(draft.redirectUrl.trim())) {
    problems.redirectUrl = 'Enter a full address, starting with https://'
  }
  draft.fields.forEach((field, index) => {
    if (!field.label.trim()) problems[`fields.${index}.label`] = 'Give this field a label.'
  })
  return problems
}

type TabValue = 'settings' | 'preview' | 'share'

/**
 * One signup form: what it asks, where its signups go, what consent it
 * records, and how to put it in front of people. The preview is the public
 * form itself, drawn from what is on screen, so it shows a change before it
 * is saved.
 */
export function FormEditorPage() {
  const { id = '' } = useParams()
  // Keyed, so going from one form to another starts from that form and not from this one's edits.
  return <FormEditor key={id} id={id} />
}

function FormEditor({ id }: { id: string }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const canEdit = roleAtLeast(useAuthState().data?.user?.role ?? 'viewer', 'editor')
  const form = useQuery({
    queryKey: formKeys.one(id),
    queryFn: () => api.get<SignupForm>(`/forms/${id}`),
  })
  const settings = useSettings()
  const lists = useLists()
  const tags = useTags()
  const customFields = useFields()
  const wide = useMediaQuery('(min-width: 64rem)')

  const [tab, setTab] = useState<TabValue>('settings')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const settingsRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (form.data && !draft) setDraft(pickDraft(form.data))
  }, [form.data, draft])

  const dirty = Boolean(
    draft && form.data && JSON.stringify(draft) !== JSON.stringify(pickDraft(form.data)),
  )

  const save = useMutation({
    mutationFn: () => api.patch<SignupForm>(`/forms/${id}`, draft),
    onSuccess: (saved) => {
      client.setQueryData(formKeys.one(id), saved)
      void client.invalidateQueries({ queryKey: formKeys.all, exact: true })
      setDraft(pickDraft(saved))
      toast.success('Form saved')
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || Object.keys(error.fields).length === 0)
        toast.error(errorMessage(error))
    },
  })
  const serverFields = save.error instanceof ApiError ? save.error.fields : {}
  const errorFor = (key: string) => problems[key] ?? serverFields[key]

  const previewForm = useMemo<PublicForm | null>(() => {
    if (!draft) return null
    return {
      id,
      title: draft.title.trim() || 'Subscribe to our newsletter',
      description: draft.description.trim() || null,
      buttonText: draft.buttonText.trim() || 'Subscribe',
      successMessage: draft.successMessage.trim() || 'Thanks for subscribing.',
      fields: publicFieldsOf(
        draft.fields.map((field) => ({ ...field, label: field.label.trim() || 'Untitled field' })),
        customFields.data ?? [],
      ),
      lists: (lists.data ?? [])
        .filter((list) => draft.listIds.includes(list.id))
        .map(({ id: listId, name, description }) => ({ id: listId, name, description }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      letSubscriberChoose: draft.letSubscriberChoose,
      consentText: draft.consentText,
      consentRequired: draft.consentRequired,
      organization: settings.data?.organization.name ?? '',
    }
  }, [draft, id, customFields.data, lists.data, settings.data])

  if (form.isError) {
    return (
      <Page>
        <PageHeader title="Signup form" back={{ to: '/forms', label: 'Signup forms' }} />
        <Banner tone="danger">{errorMessage(form.error)}</Banner>
      </Page>
    )
  }
  if (!draft || !form.data || !previewForm) {
    return (
      <Page>
        <PageHeader title="Signup form" back={{ to: '/forms', label: 'Signup forms' }} />
        <div
          className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]"
          aria-busy="true"
        >
          <div className="flex flex-col gap-4">
            <Skeleton className="h-9 w-full max-w-[34rem]" />
            <Skeleton className="h-9 w-full max-w-[34rem]" />
            <Skeleton className="h-24 w-full max-w-[34rem]" />
          </div>
          <Skeleton className="hidden h-96 rounded-[var(--radius-xl)] lg:block" />
        </div>
      </Page>
    )
  }

  const saved = form.data
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft({ ...draft, [key]: value })
    if (problems[key])
      setProblems(Object.fromEntries(Object.entries(problems).filter(([name]) => name !== key)))
  }
  const text = (
    key:
      | 'name'
      | 'title'
      | 'description'
      | 'buttonText'
      | 'successMessage'
      | 'redirectUrl'
      | 'consentText',
  ) => ({
    value: draft[key],
    onChange: (event: { target: { value: string } }) => set(key, event.target.value),
  })

  const trySave = () => {
    const found = problemsIn(draft)
    setProblems(found)
    if (Object.keys(found).length > 0) {
      // Back to the fields, and to the first one that needs fixing.
      setTab('settings')
      requestAnimationFrame(() =>
        settingsRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      )
      return
    }
    save.mutate()
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (canEdit) trySave()
  }

  const hostedUrl = `${settings.data?.effectivePublicUrl ?? window.location.origin}/subscribe/${id}`
  // On a narrow screen the preview takes its turn as a tab; on a wide one it sits beside the settings.
  const tabs: { value: TabValue; label: string }[] = wide
    ? [
        { value: 'settings', label: 'Settings' },
        { value: 'share', label: 'Share' },
      ]
    : [
        { value: 'settings', label: 'Settings' },
        { value: 'preview', label: 'Preview' },
        { value: 'share', label: 'Share' },
      ]
  const current: TabValue = wide && tab === 'preview' ? 'settings' : tab

  const settingsPane = (
    <form ref={settingsRef} onSubmit={submit} noValidate className="min-w-0">
      {/* One switch for the whole form: a viewer reads every setting and changes none. */}
      <fieldset disabled={!canEdit} className="m-0 min-w-0 border-0 p-0">
        {!canEdit && (
          <Banner tone="info" className="mb-8">
            You can look at this form, but only an editor or admin can change it.
          </Banner>
        )}
        {save.isError && Object.keys(serverFields).length > 0 && (
          <Banner tone="danger" className="mb-8">
            {errorMessage(save.error)}
          </Banner>
        )}

        <FormSection
          title="Form"
          description="What you call it, and whether it is taking signups."
          className="lg:grid-cols-1"
        >
          <Field
            label="Name"
            hint="Only you see this. It tells your forms apart."
            error={errorFor('name')}
          >
            <TextInput {...text('name')} />
          </Field>
          <Switch
            label="Accept signups"
            description="Turn this off to close the form. Its page and embeds then say it is closed."
            checked={draft.enabled}
            onChange={(enabled) => set('enabled', enabled)}
          />
        </FormSection>

        <FormSection
          title="What people see"
          description="The words on the form."
          className="lg:grid-cols-1"
        >
          <Field label="Title" error={errorFor('title')}>
            <TextInput {...text('title')} />
          </Field>
          <Field
            label="Description"
            optional
            hint="A line or two on what they are signing up for and how often you write."
          >
            <Textarea rows={3} {...text('description')} />
          </Field>
          <Field label="Button text" error={errorFor('buttonText')}>
            <TextInput {...text('buttonText')} className="max-w-[16rem]" />
          </Field>
        </FormSection>

        <FormSection
          title="Fields"
          description="Email is always asked for. Add what else you want to know: every extra field costs you some signups."
          className="lg:grid-cols-1"
        >
          <FieldsEditor
            fields={draft.fields}
            customFields={customFields.data ?? []}
            errorFor={errorFor}
            onChange={(fields) => {
              setDraft({ ...draft, fields })
              setProblems((currentProblems) =>
                Object.fromEntries(
                  Object.entries(currentProblems).filter(([key]) => !key.startsWith('fields.')),
                ),
              )
            }}
          />
        </FormSection>

        <FormSection
          title="Lists and tags"
          description="Where the people who sign up go."
          className="lg:grid-cols-1"
        >
          <Field label="Lists" error={errorFor('listIds')}>
            <MultiSelect
              options={(lists.data ?? []).map((list) => ({ value: list.id, label: list.name }))}
              value={draft.listIds}
              onChange={(listIds) => set('listIds', listIds)}
              placeholder={lists.isPending ? 'Loading lists…' : 'Choose lists…'}
              disabled={!canEdit}
            />
          </Field>
          <Switch
            label="Let people choose which lists"
            description={
              draft.listIds.length > 1
                ? 'Shows the lists as checkboxes. With this off, everyone joins all of them.'
                : 'Shows the lists as checkboxes when there is more than one. With this off, everyone joins all of them.'
            }
            checked={draft.letSubscriberChoose}
            onChange={(letSubscriberChoose) => set('letSubscriberChoose', letSubscriberChoose)}
          />
          <Field
            label="Tags to add"
            optional
            hint="Put on everyone who signs up through this form."
          >
            <MultiSelect
              options={(tags.data ?? []).map((tag) => ({ value: tag.id, label: tag.name }))}
              value={draft.tagIds}
              onChange={(tagIds) => set('tagIds', tagIds)}
              placeholder={
                tags.isPending
                  ? 'Loading tags…'
                  : tags.data?.length === 0
                    ? 'No tags yet'
                    : 'Choose tags…'
              }
              disabled={!canEdit}
            />
          </Field>
        </FormSection>

        <FormSection
          title="Consent"
          description="How you know each person asked for this, and what they agreed to."
          className="lg:grid-cols-1"
        >
          <Switch
            label="Double opt-in"
            description="New subscribers get an email with a link, and join only when they press it. It keeps typos and bots off your lists and is the clearest record of consent. Someone who unsubscribed and signs up again is always asked to confirm."
            checked={draft.doubleOptIn}
            onChange={(doubleOptIn) => set('doubleOptIn', doubleOptIn)}
          />
          <Switch
            label="Consent is required"
            description="Adds a checkbox people must tick before they can subscribe. What it says is saved with every signup."
            checked={draft.consentRequired}
            onChange={(consentRequired) => set('consentRequired', consentRequired)}
          />
          {draft.consentRequired && (
            <Field
              label="Consent text"
              hint="The sentence beside the checkbox. Say what they will get and that they can leave."
              error={errorFor('consentText')}
            >
              <Textarea rows={2} {...text('consentText')} placeholder={DEFAULT_CONSENT_TEXT} />
            </Field>
          )}
        </FormSection>

        <FormSection
          title="After signing up"
          description={
            draft.doubleOptIn
              ? 'With double opt-in, people are first told to check their inbox. They get this once they have confirmed.'
              : 'What people get as soon as they press the button.'
          }
          className="lg:grid-cols-1"
        >
          <Field label="Success message" error={errorFor('successMessage')}>
            <Textarea rows={2} {...text('successMessage')} />
          </Field>
          <Field
            label="Redirect URL"
            optional
            hint="Send people to a page of your own, a thank-you page for example, in place of the message."
            error={errorFor('redirectUrl')}
          >
            <TextInput
              {...text('redirectUrl')}
              placeholder="https://example.com/thanks"
              inputMode="url"
              spellCheck={false}
            />
          </Field>
        </FormSection>
      </fieldset>
    </form>
  )

  const previewPane = (
    <FormPreview
      form={previewForm}
      doubleOptIn={draft.doubleOptIn}
      redirectUrl={draft.redirectUrl.trim()}
    />
  )

  return (
    <Page>
      <PageHeader
        title={saved.name}
        back={{ to: '/forms', label: 'Signup forms' }}
        actions={
          <>
            {saved.enabled ? (
              <Badge tone="success" dot>
                Taking signups
              </Badge>
            ) : (
              <Badge tone="neutral">Off</Badge>
            )}
            <Button
              variant="outlined"
              startIcon={<ExternalLink />}
              onClick={() => window.open(hostedUrl, '_blank', 'noopener')}
            >
              View page
            </Button>
          </>
        }
      >
        <Tabs aria-label="Form sections" tabs={tabs} value={current} onChange={setTab} />
      </PageHeader>

      {current === 'share' ? (
        <FormShare
          form={saved}
          customFields={customFields.data ?? []}
          publicUrl={settings.data?.effectivePublicUrl ?? window.location.origin}
          publicUrlIsLocal={settings.data?.publicUrlIsLocal ?? false}
          dirty={dirty}
          onSetPublicUrl={() => navigate('/settings/organization')}
        />
      ) : wide ? (
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
          <div className="min-w-0 max-w-[40rem]">{settingsPane}</div>
          {/* Stays in view beside the settings. A form taller than the window scrolls inside its own column, clear of the save bar. */}
          <div className="min-w-0 self-start lg:sticky lg:top-8 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto">
            {previewPane}
          </div>
        </div>
      ) : (
        <>
          {/* Hidden, not unmounted: the settings keep their place and the preview keeps what was typed into it. */}
          <div hidden={current !== 'settings'}>{settingsPane}</div>
          <div hidden={current !== 'preview'}>{previewPane}</div>
        </>
      )}

      <UnsavedGuard dirty={dirty && canEdit} />

      {canEdit && dirty && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[var(--radius-xl)] border border-[var(--ds-border)] bg-[var(--ds-surface-raised)] py-3 pr-3 pl-5 shadow-e4">
          <p className="text-label text-[var(--ds-fg)]">You have unsaved changes</p>
          <div className="flex items-center gap-2 coarse:gap-3">
            <Button
              variant="text"
              disabled={save.isPending}
              onClick={() => {
                setDraft(pickDraft(saved))
                setProblems({})
                save.reset()
              }}
            >
              Discard
            </Button>
            <Button onClick={trySave} loading={save.isPending}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </Page>
  )
}

/** The fields after Email: which ones, in what order, what each is called on the form, and whether it must be filled in. */
function FieldsEditor({
  fields,
  customFields,
  errorFor,
  onChange,
}: {
  fields: FormFieldDef[]
  customFields: CustomField[]
  errorFor: (key: string) => string | undefined
  onChange: (fields: FormFieldDef[]) => void
}) {
  const choices = useMemo(
    () => [
      ...FORM_FIELD_CHOICES.map((choice) => ({ ...choice, custom: false })),
      ...customFields.map((field) => ({
        key: `custom.${field.key}`,
        label: field.label,
        custom: true,
      })),
    ],
    [customFields],
  )
  const unused = choices.filter((choice) => !fields.some((field) => field.key === choice.key))

  const move = (index: number, by: -1 | 1) => {
    const next = [...fields]
    const [moved] = next.splice(index, 1)
    if (!moved) return
    next.splice(index + by, 0, moved)
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-4">
      {fields.length > 0 && (
        <ul className="flex flex-col divide-y divide-[var(--ds-border-subtle)] border-y border-[var(--ds-border-subtle)]">
          {fields.map((field, index) => {
            const source = choices.find((choice) => choice.key === field.key)
            const called = field.label.trim() || source?.label || 'field'
            return (
              <li key={field.key} className="flex flex-col gap-3 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="truncate text-label text-[var(--ds-fg)]">
                      {source?.label ?? field.key}
                    </span>
                    <span className="text-caption text-[var(--ds-fg-muted)]">
                      {source
                        ? source.custom
                          ? 'Custom field'
                          : 'Contact field'
                        : 'This custom field no longer exists'}
                    </span>
                  </p>
                  <div className="flex shrink-0 items-center gap-1 coarse:gap-3">
                    <IconButton
                      size="sm"
                      label={`Move ${called} up`}
                      icon={<ArrowUp />}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    />
                    <IconButton
                      size="sm"
                      label={`Move ${called} down`}
                      icon={<ArrowDown />}
                      disabled={index === fields.length - 1}
                      onClick={() => move(index, 1)}
                    />
                    <IconButton
                      size="sm"
                      label={`Remove ${called}`}
                      icon={<Trash2 />}
                      onClick={() => onChange(fields.filter((_, at) => at !== index))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <Field label="Label on the form" error={errorFor(`fields.${index}.label`)}>
                    <TextInput
                      value={field.label}
                      onChange={(event) =>
                        onChange(
                          fields.map((entry, at) =>
                            at === index ? { ...entry, label: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                  </Field>
                  {/* Level with the input, not with its label. */}
                  <div className="sm:pt-7">
                    <Checkbox
                      label="Required"
                      checked={field.required}
                      onChange={(required) =>
                        onChange(
                          fields.map((entry, at) =>
                            at === index ? { ...entry, required } : entry,
                          ),
                        )
                      }
                    />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {unused.length > 0 ? (
        <div className="max-w-[16rem]">
          <Select
            aria-label="Add a field"
            value=""
            onChange={(event) => {
              const choice = unused.find((entry) => entry.key === event.target.value)
              if (choice)
                onChange([...fields, { key: choice.key, label: choice.label, required: false }])
            }}
            options={[
              { value: '', label: 'Add a field…' },
              ...unused.map((choice) => ({
                value: choice.key,
                label: choice.custom ? `${choice.label} (custom field)` : choice.label,
              })),
            ]}
          />
        </div>
      ) : (
        <p className="text-caption text-[var(--ds-fg-muted)]">
          Every field you have is on the form.
        </p>
      )}
    </div>
  )
}

/**
 * The form as a subscriber will meet it, light theme and all, drawn from what
 * is in the settings right now. It can be filled in and pressed, and shows what
 * comes next, but nothing leaves the page.
 */
function FormPreview({
  form,
  doubleOptIn,
  redirectUrl,
}: {
  form: PublicForm
  doubleOptIn: boolean
  redirectUrl: string
}) {
  const [round, setRound] = useState(0)
  const [submittedIn, setSubmittedIn] = useState<string | null>(null)
  // A change to what the form is made of starts it again; a change of wording does not.
  const shape = `${round}|${JSON.stringify([
    form.fields.map((field) => [field.key, field.type]),
    form.lists.map((list) => list.id),
    form.letSubscriberChoose,
    form.consentRequired,
  ])}`
  const submitted = submittedIn === shape

  const next = !submitted
    ? 'Try it out. Nothing is sent from the preview.'
    : doubleOptIn
      ? redirectUrl
        ? `Once they confirm from the email, they are sent to ${redirectUrl}.`
        : 'Once they confirm from the email, they see your success message.'
      : redirectUrl
        ? `On the real form, people skip this and go straight to ${redirectUrl}.`
        : 'This is what people see after signing up.'

  return (
    <section aria-label="Preview" className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 className="text-overline text-[var(--ds-fg-muted)] uppercase">Preview</h2>
        {submitted && (
          <Button
            variant="text"
            size="sm"
            onClick={() => {
              setRound((value) => value + 1)
              setSubmittedIn(null)
            }}
          >
            Show the form again
          </Button>
        )}
      </div>
      <div data-theme="light" className="overflow-hidden rounded-[var(--radius-xl)]">
        <PublicFrame mode="preview" organization={form.organization}>
          <SignupFormBody
            key={shape}
            form={form}
            headingLevel={2}
            submit={async () => resultFor(form, doubleOptIn ? 'confirmation_sent' : 'subscribed')}
            onResult={() => setSubmittedIn(shape)}
          />
        </PublicFrame>
      </div>
      <p className="text-caption text-[var(--ds-fg-muted)] [overflow-wrap:anywhere]" role="status">
        {next}
      </p>
    </section>
  )
}
