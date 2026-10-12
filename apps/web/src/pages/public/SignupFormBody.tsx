import { useId, useRef, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertCircle, Check, MailCheck } from 'lucide-react'
import {
  DEFAULT_CONSENT_TEXT,
  isEmail,
  type FormSubmission,
  type FormSubmissionResult,
  type PublicForm,
  type PublicFormField,
} from '@ariad/shared'
import { ApiError, errorMessage } from '@/lib/api'
import { Button } from '@/ui/Button'
import { Field, Select } from '@/ui/Controls'
import { Banner } from '@/ui/Feedback'
import { Checkbox, TextInput } from '@/ui/Inputs'
import { PublicHeading, ResultMark } from './PublicFrame'

/** 44px and 16px type at every width: this is filled in with a thumb, by someone doing you a favor. */
const COMFORTABLE = 'h-11 md:text-body'

const CONFIRM_MESSAGE = 'Almost done. Check your inbox and click the link to confirm.'

/** What the form says after a signup, from the status alone: all a redirect from the plain-HTML embed carries. */
export function resultFor(
  form: PublicForm,
  status: FormSubmissionResult['status'],
): FormSubmissionResult {
  return {
    status,
    message: status === 'confirmation_sent' ? CONFIRM_MESSAGE : form.successMessage,
    redirectUrl: null,
  }
}

/** Out of the iframe when there is one: a thank-you page belongs to the whole window. */
function leaveTo(url: string) {
  try {
    ;(window.top ?? window).location.href = url
  } catch {
    window.location.href = url
  }
}

const AUTOCOMPLETE: Record<string, string> = {
  firstName: 'given-name',
  lastName: 'family-name',
  company: 'organization',
  phone: 'tel',
  birthday: 'bday',
}

function ErrorLine({ id, children }: { id?: string; children: string }) {
  return (
    <p
      id={id}
      role="alert"
      className="flex items-start gap-1.5 text-caption text-[var(--ds-danger-text)]"
    >
      <AlertCircle size={13} aria-hidden className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function FormField({
  field,
  value,
  error,
  onChange,
}: {
  field: PublicFormField
  value: string
  error: string | undefined
  onChange: (value: string) => void
}) {
  const id = useId()
  const choices =
    field.type === 'select' && field.options.length > 0
      ? field.options.map((option) => ({ value: option, label: option }))
      : field.type === 'boolean'
        ? // Saved as the words themselves, the way the contact pages save a yes-or-no field.
          [
            { value: 'Yes', label: 'Yes' },
            { value: 'No', label: 'No' },
          ]
        : null

  if (choices) {
    return (
      <Field label={field.label} optional={!field.required} error={error} htmlFor={id}>
        <Select
          id={id}
          name={field.key}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          options={[{ value: '', label: 'Choose…' }, ...choices]}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={COMFORTABLE}
        />
      </Field>
    )
  }

  return (
    <Field label={field.label} optional={!field.required} error={error}>
      <TextInput
        name={field.key}
        type={field.type === 'date' ? 'date' : field.key === 'phone' ? 'tel' : 'text'}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        autoComplete={AUTOCOMPLETE[field.key] ?? 'off'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={COMFORTABLE}
      />
    </Field>
  )
}

/**
 * A signup form, as a subscriber meets it: the hosted page, the iframe embed,
 * and the preview beside the form's settings are all this one component, so
 * the three cannot drift apart. Where the signup goes is the caller's
 * business: the page sends it to the server, the preview sends it nowhere.
 */
export function SignupFormBody({
  form,
  submit,
  initialResult = null,
  initialError = null,
  onResult,
  headingLevel = 1,
}: {
  form: PublicForm
  submit: (input: FormSubmission) => Promise<FormSubmissionResult>
  /** A result carried in by the address: where the plain-HTML embed lands after posting. */
  initialResult?: FormSubmissionResult | null
  initialError?: string | null
  onResult?: (result: FormSubmissionResult) => void
  /** 2 where the page it is shown on already has a title of its own. */
  headingLevel?: 1 | 2
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const baseId = useId()
  const [email, setEmail] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [listIds, setListIds] = useState<string[]>(() => form.lists.map((list) => list.id))
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(initialError)
  const [result, setResult] = useState<FormSubmissionResult | null>(initialResult)
  const [leaving, setLeaving] = useState(false)

  // One list is not a choice: it is where they are signing up to.
  const choosesLists = form.letSubscriberChoose && form.lists.length > 1
  const consentText = form.consentText.trim() || DEFAULT_CONSENT_TEXT

  const send = useMutation({
    mutationFn: () =>
      submit({
        email,
        fields: Object.fromEntries(
          Object.entries(values).filter(([, value]) => value.trim() !== ''),
        ),
        listIds: choosesLists ? listIds : undefined,
        consent,
        website,
      }),
    onSuccess: (outcome) => {
      onResult?.(outcome)
      if (outcome.redirectUrl) {
        setLeaving(true)
        leaveTo(outcome.redirectUrl)
      } else {
        setResult(outcome)
      }
    },
    onError: (error) => {
      const emailProblem = error instanceof ApiError ? error.fields.email : undefined
      if (emailProblem) setErrors({ email: emailProblem })
      else setFailure(errorMessage(error))
    },
  })

  /** An error goes as soon as its field is touched again: it was about the old answer. */
  const clearError = (key: string) =>
    setErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })

  const check = (): Record<string, string> => {
    const problems: Record<string, string> = {}
    if (!email.trim()) problems.email = 'Enter your email address.'
    else if (!isEmail(email)) problems.email = 'Enter a full email address, like name@example.com.'
    for (const field of form.fields) {
      if (field.required && !values[field.key]?.trim())
        problems[field.key] = `${field.label} is required.`
    }
    if (choosesLists && listIds.length === 0) problems.lists = 'Choose at least one.'
    if (form.consentRequired && !consent)
      problems.consent = 'Tick the box to agree before subscribing.'
    return problems
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setFailure(null)
    const problems = check()
    setErrors(problems)
    if (Object.keys(problems).length > 0) {
      // To the first thing that needs fixing, once it has been marked.
      requestAnimationFrame(() => {
        const first = formRef.current?.querySelector<HTMLElement>(
          '[aria-invalid="true"], [data-invalid="true"] input',
        )
        first?.focus()
      })
      return
    }
    send.mutate()
  }

  if (result) {
    const confirming = result.status === 'confirmation_sent'
    return (
      <div className="flex flex-col gap-5" role="status">
        <ResultMark tone={confirming ? 'info' : 'success'}>
          {confirming ? <MailCheck size={22} /> : <Check size={22} />}
        </ResultMark>
        <PublicHeading
          title={confirming ? 'One more step' : 'You are subscribed'}
          level={headingLevel}
          focusOnMount
        >
          <p className="whitespace-pre-line">{result.message}</p>
        </PublicHeading>
      </div>
    )
  }

  const setValue = (key: string) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    clearError(key)
  }

  return (
    <div className="flex flex-col gap-6">
      <PublicHeading title={form.title} level={headingLevel}>
        {form.description && <p className="whitespace-pre-line">{form.description}</p>}
      </PublicHeading>

      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <Field label="Email" error={errors.email}>
          <TextInput
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              clearError('email')
            }}
            className={COMFORTABLE}
          />
        </Field>

        {form.fields.map((field) => (
          <FormField
            key={field.key}
            field={field}
            value={values[field.key] ?? ''}
            error={errors[field.key]}
            onChange={setValue(field.key)}
          />
        ))}

        {choosesLists && (
          <fieldset
            className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
            data-invalid={errors.lists ? true : undefined}
          >
            <legend className="mb-1.5 p-0 text-label text-[var(--ds-fg-secondary)]">
              What would you like to get?
            </legend>
            <div className="flex flex-col gap-2.5">
              {form.lists.map((list) => (
                <Checkbox
                  key={list.id}
                  label={list.name}
                  description={list.description ?? undefined}
                  checked={listIds.includes(list.id)}
                  onChange={(on) => {
                    setListIds((current) =>
                      on ? [...current, list.id] : current.filter((id) => id !== list.id),
                    )
                    clearError('lists')
                  }}
                />
              ))}
            </div>
            {errors.lists && <ErrorLine>{errors.lists}</ErrorLine>}
          </fieldset>
        )}

        {form.consentRequired && (
          <div className="flex flex-col gap-1.5" data-invalid={errors.consent ? true : undefined}>
            <Checkbox
              id={`${baseId}-consent`}
              label={consentText}
              checked={consent}
              onChange={(on) => {
                setConsent(on)
                clearError('consent')
              }}
            />
            {errors.consent && <ErrorLine>{errors.consent}</ErrorLine>}
          </div>
        )}

        {/* Not for people: out of sight, out of the tab order, and out of the accessibility tree. Whatever fills it in is a bot. */}
        <div className="sr-only-ds" aria-hidden="true">
          <label>
            Website
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </label>
        </div>

        {failure && <Banner tone="danger">{failure}</Banner>}

        <Button type="submit" size="lg" fullWidth loading={send.isPending || leaving}>
          {form.buttonText}
        </Button>
      </form>
    </div>
  )
}
