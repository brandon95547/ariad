import { useEffect, useId, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  GMAIL_DAILY_LIMIT,
  GMAIL_WORKSPACE_DAILY_LIMIT,
  SMTP_PRESETS,
  type SendingAccount,
  type SendingAccountKind,
  type SmtpSecurity,
  type VerifyResult,
} from '@ariad/shared'
import { ApiError, api, errorMessage } from '@/lib/api'
import { Button } from '@/ui/Button'
import { Field, SegmentedControl, Select } from '@/ui/Controls'
import { Dialog } from '@/ui/Dialog'
import { Banner } from '@/ui/Feedback'
import { PasswordInput, TextInput } from '@/ui/Inputs'

type Saved = { account: SendingAccount; verify: VerifyResult | null }

interface FormState {
  preset: string
  label: string
  email: string
  password: string
  host: string
  port: string
  security: SmtpSecurity
  username: string
  fromName: string
  fromEmail: string
  replyTo: string
  dailyLimit: string
  perMinute: string
}

function initialState(kind: SendingAccountKind, account: SendingAccount | null, organization: string): FormState {
  if (account) {
    return {
      preset: SMTP_PRESETS.find((preset) => preset.host === account.host)?.id ?? 'custom',
      label: account.label,
      email: account.fromEmail,
      password: '',
      host: account.host,
      port: String(account.port),
      security: account.security,
      username: account.username,
      fromName: account.fromName,
      fromEmail: account.fromEmail,
      replyTo: account.replyTo ?? '',
      dailyLimit: String(account.dailyLimit),
      perMinute: String(account.perMinute),
    }
  }
  const preset = SMTP_PRESETS[0]!
  return {
    preset: preset.id,
    label: '',
    email: '',
    password: '',
    host: '',
    port: String(preset.port),
    security: preset.security,
    username: '',
    fromName: organization,
    fromEmail: '',
    replyTo: '',
    dailyLimit: String(kind === 'gmail' ? GMAIL_DAILY_LIMIT : preset.dailyLimit),
    perMinute: String(kind === 'gmail' ? 20 : preset.perMinute),
  }
}

const SECURITY_OPTIONS: { value: SmtpSecurity; label: string }[] = [
  { value: 'ssl', label: 'SSL/TLS' },
  { value: 'starttls', label: 'STARTTLS' },
  { value: 'none', label: 'None' },
]

/**
 * Adds or edits a sending account.
 *
 * Saving also signs in. When the sign-in fails the account is still saved, and
 * the dialog stays open on it with the reason — so the fix is one corrected
 * field and Save again, not the whole form from the top.
 */
export function AccountDialog({
  open,
  kind,
  account,
  organization,
  onClose,
  onSaved,
}: {
  open: boolean
  kind: SendingAccountKind
  /** The account being edited, or null to add one. */
  account: SendingAccount | null
  organization: string
  onClose: () => void
  onSaved: (saved: Saved, done: boolean) => void
}) {
  const formId = useId()
  const [editing, setEditing] = useState<SendingAccount | null>(account)
  const [form, setForm] = useState<FormState>(() => initialState(kind, account, organization))
  const [verify, setVerify] = useState<VerifyResult | null>(null)

  // A fresh form each time the dialog opens: nothing from the last account,
  // and above all not its password.
  useEffect(() => {
    if (!open) return
    setEditing(account)
    setForm(initialState(kind, account, organization))
    setVerify(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, account?.id])

  const set = (key: keyof FormState) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  const isGmail = kind === 'gmail'
  const preset = SMTP_PRESETS.find((entry) => entry.id === form.preset) ?? SMTP_PRESETS[0]!

  const choosePreset = (id: string) => {
    const next = SMTP_PRESETS.find((entry) => entry.id === id) ?? SMTP_PRESETS[0]!
    setForm((current) => ({
      ...current,
      preset: next.id,
      host: next.host || current.host,
      port: String(next.port),
      security: next.security,
      label: current.label || (next.id === 'custom' ? '' : next.label),
      dailyLimit: String(next.dailyLimit),
      perMinute: String(next.perMinute),
    }))
  }

  const save = useMutation({
    mutationFn: (): Promise<Saved> => {
      const limits = { dailyLimit: Number(form.dailyLimit) || undefined, perMinute: Number(form.perMinute) || undefined }
      if (editing) {
        return api.patch<Saved>(`/sending-accounts/${editing.id}`, {
          label: form.label || undefined,
          fromName: form.fromName,
          replyTo: form.replyTo,
          // Blank means "keep the password already stored".
          password: form.password || undefined,
          ...(isGmail
            ? { fromEmail: form.email }
            : { fromEmail: form.fromEmail, host: form.host, port: Number(form.port), security: form.security, username: form.username }),
          ...limits,
        })
      }
      return api.post<Saved>(
        '/sending-accounts',
        isGmail
          ? { kind: 'gmail', email: form.email, appPassword: form.password, fromName: form.fromName, replyTo: form.replyTo, ...limits }
          : {
              kind: 'smtp',
              label: form.label,
              host: form.host,
              port: Number(form.port),
              security: form.security,
              username: form.username,
              password: form.password,
              fromName: form.fromName,
              fromEmail: form.fromEmail,
              replyTo: form.replyTo,
              ...limits,
            },
      )
    },
    onSuccess: (saved) => {
      const failed = saved.verify && !saved.verify.ok
      if (failed) {
        setEditing(saved.account)
        setVerify(saved.verify)
        setForm((current) => ({ ...current, password: '' }))
      }
      onSaved(saved, !failed)
    },
  })

  const fields = save.error instanceof ApiError ? save.error.fields : {}
  const general = save.isError && Object.keys(fields).length === 0 ? errorMessage(save.error) : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setVerify(null)
    save.mutate()
  }

  const title = editing ? `Edit ${editing.label}` : isGmail ? 'Add a Gmail account' : 'Add an SMTP account'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={
        isGmail
          ? 'Ariad signs in to Gmail with an app password, a 16-letter password Google makes for one app.'
          : 'Any mail server or sending service that offers SMTP.'
      }
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {editing ? 'Save and check' : isGmail ? 'Connect Gmail' : 'Connect account'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {verify && !verify.ok && (
          <Banner tone="danger" title="Saved, but the sign-in failed">
            {verify.message}
          </Banner>
        )}
        {general && <Banner tone="danger">{general}</Banner>}

        {isGmail ? (
          <>
            {!editing && (
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-body-sm text-[var(--ds-fg-secondary)]">
                <li>Turn on 2-Step Verification for the Google account, if it is not on already.</li>
                <li>
                  Open{' '}
                  <a
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--ds-accent-text)] underline underline-offset-2 hover:text-[var(--ds-fg)]"
                  >
                    myaccount.google.com/apppasswords
                  </a>{' '}
                  and create an app password. Name it Ariad.
                </li>
                <li>Paste the 16 letters Google shows you below.</li>
              </ol>
            )}
            <Field label="Gmail address" error={fields.email ?? fields.fromEmail}>
              <TextInput type="email" value={form.email} onChange={set('email')} autoComplete="off" placeholder="you@gmail.com" required />
            </Field>
            <Field
              label="App password"
              hint={editing ? 'Leave blank to keep the one already saved.' : 'Not the password you sign in to Google with. Spaces are fine.'}
              error={fields.appPassword ?? fields.password}
            >
              <PasswordInput value={form.password} onChange={set('password')} autoComplete="off" placeholder="abcd efgh ijkl mnop" className="font-mono" />
            </Field>
          </>
        ) : (
          <>
            {!editing && (
              <Field label="Provider" htmlFor={`${formId}-preset`}>
                <Select
                  id={`${formId}-preset`}
                  value={form.preset}
                  onChange={(event) => choosePreset(event.target.value)}
                  options={SMTP_PRESETS.map((entry) => ({ value: entry.id, label: entry.label }))}
                />
              </Field>
            )}
            <Field label="Account name" hint="Only you see this. It tells accounts apart in menus." error={fields.label}>
              <TextInput value={form.label} onChange={set('label')} placeholder="Company mail server" required />
            </Field>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_7rem]">
              <Field label="Host" error={fields.host}>
                <TextInput value={form.host} onChange={set('host')} placeholder="smtp.example.com" autoComplete="off" spellCheck={false} required />
              </Field>
              <Field label="Port" error={fields.port}>
                <TextInput value={form.port} onChange={set('port')} inputMode="numeric" required />
              </Field>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="block text-label text-[var(--ds-fg-secondary)]">Security</span>
              <SegmentedControl
                label="Security"
                value={form.security}
                onChange={(security) =>
                  setForm((current) => ({
                    ...current,
                    security,
                    // The two usual pairings, so choosing one sets the other.
                    port: security === 'ssl' && current.port === '587' ? '465' : security === 'starttls' && current.port === '465' ? '587' : current.port,
                  }))
                }
                options={SECURITY_OPTIONS}
              />
              <p className="text-caption text-[var(--ds-fg-muted)]">Port 465 uses SSL/TLS. Ports 587 and 25 use STARTTLS.</p>
            </div>
            <Field label="Username" hint={preset.usernameHint} error={fields.username}>
              <TextInput value={form.username} onChange={set('username')} autoComplete="off" spellCheck={false} />
            </Field>
            <Field
              label="Password"
              hint={editing ? 'Leave blank to keep the one already saved.' : preset.passwordHint}
              error={fields.password}
            >
              <PasswordInput value={form.password} onChange={set('password')} autoComplete="off" />
            </Field>
          </>
        )}

        <div className="flex flex-col gap-4 border-t border-[var(--ds-border-subtle)] pt-5">
          <h3 className="text-overline text-[var(--ds-fg-muted)] uppercase">How it appears to recipients</h3>
          <Field label="From name" error={fields.fromName}>
            <TextInput value={form.fromName} onChange={set('fromName')} placeholder="Your organization" required />
          </Field>
          {!isGmail && (
            <Field label="From email" error={fields.fromEmail}>
              <TextInput type="email" value={form.fromEmail} onChange={set('fromEmail')} placeholder="news@example.com" autoComplete="off" required />
            </Field>
          )}
          <Field label="Reply-to" optional hint="Where replies go, when that is not the From address." error={fields.replyTo}>
            <TextInput type="email" value={form.replyTo} onChange={set('replyTo')} autoComplete="off" />
          </Field>
        </div>

        <div className="flex flex-col gap-4 border-t border-[var(--ds-border-subtle)] pt-5">
          <h3 className="text-overline text-[var(--ds-fg-muted)] uppercase">Sending limits</h3>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Emails per day" error={fields.dailyLimit}>
              <TextInput value={form.dailyLimit} onChange={set('dailyLimit')} inputMode="numeric" />
            </Field>
            <Field label="Emails per minute" error={fields.perMinute}>
              <TextInput value={form.perMinute} onChange={set('perMinute')} inputMode="numeric" />
            </Field>
          </div>
          <p className="text-caption text-[var(--ds-fg-muted)]">
            {isGmail
              ? `Google allows ${GMAIL_DAILY_LIMIT} recipients a day on a personal Gmail account and ${GMAIL_WORKSPACE_DAILY_LIMIT.toLocaleString('en-US')} on Google Workspace. Mail over the limit waits in the queue until it clears.`
              : 'Set these at or under what your provider allows. Mail over the limit waits in the queue until it clears.'}
          </p>
        </div>
      </form>
    </Dialog>
  )
}
