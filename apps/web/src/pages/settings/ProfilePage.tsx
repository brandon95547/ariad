import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ROLE_LABELS, type AuthState, type User } from '@ariad/shared'
import { FormSection } from '@/components/FormSection'
import { api, errorMessage } from '@/lib/api'
import { keys, useAuthState } from '@/lib/queries'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Controls'
import { Banner } from '@/ui/Feedback'
import { PasswordInput, TextInput } from '@/ui/Inputs'
import { toast } from '@/ui/Toast'

/** Settings › Your profile. Your own name and password; nobody else's. */
export function ProfilePage() {
  const client = useQueryClient()
  const user = useAuthState().data?.user
  const [name, setName] = useState(user?.name ?? '')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')

  const remember = (updated: User) =>
    client.setQueryData<AuthState>(keys.auth, (state) =>
      state ? { ...state, user: updated } : state,
    )

  const rename = useMutation({
    mutationFn: () => api.patch<User>('/auth/me', { name }),
    onSuccess: (updated) => {
      remember(updated)
      toast.success('Name saved')
    },
  })

  const changePassword = useMutation({
    mutationFn: () => api.patch<User>('/auth/me', { currentPassword: current, newPassword: next }),
    onSuccess: (updated) => {
      remember(updated)
      setCurrent('')
      setNext('')
      setAgain('')
      toast.success('Password changed')
    },
  })

  if (!user) return null

  const mismatch = again !== '' && next !== again
  const tooShort = next !== '' && next.length < 8

  const submitName = (event: FormEvent) => {
    event.preventDefault()
    rename.mutate()
  }
  const submitPassword = (event: FormEvent) => {
    event.preventDefault()
    if (!mismatch && !tooShort) changePassword.mutate()
  }

  return (
    <div>
      <FormSection
        title="You"
        description="How you appear to the rest of your team, and in the log of who did what."
      >
        <form onSubmit={submitName} className="flex flex-col gap-5" noValidate>
          {rename.isError && <Banner tone="danger">{errorMessage(rename.error)}</Banner>}
          <Field label="Name">
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
            />
          </Field>
          <Field
            label="Email"
            hint={`You sign in with this. Your role is ${ROLE_LABELS[user.role]}; an admin can change either under Team.`}
          >
            <TextInput value={user.email} disabled readOnly />
          </Field>
          <Button
            type="submit"
            variant="outlined"
            loading={rename.isPending}
            disabled={!name.trim() || name.trim() === user.name}
            className="self-start"
          >
            Save name
          </Button>
        </form>
      </FormSection>

      <FormSection
        title="Password"
        description="Changing it does not sign you out here. Use at least 8 characters."
      >
        <form onSubmit={submitPassword} className="flex flex-col gap-5" noValidate>
          {changePassword.isError && (
            <Banner tone="danger">{errorMessage(changePassword.error)}</Banner>
          )}
          <Field label="Current password">
            <PasswordInput
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label="New password" error={tooShort ? 'Use at least 8 characters.' : undefined}>
            <PasswordInput
              value={next}
              onChange={(event) => setNext(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field
            label="New password again"
            error={mismatch ? 'The two new passwords do not match.' : undefined}
          >
            <PasswordInput
              value={again}
              onChange={(event) => setAgain(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Button
            type="submit"
            loading={changePassword.isPending}
            disabled={!current || !next || !again || mismatch || tooShort}
            className="self-start"
          >
            Change password
          </Button>
        </form>
      </FormSection>
    </div>
  )
}
