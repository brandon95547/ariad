import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AuthState } from '@ariad/shared'
import { ApiError, api, errorMessage } from '@/lib/api'
import { keys } from '@/lib/queries'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Controls'
import { Banner } from '@/ui/Feedback'
import { PasswordInput, TextInput } from '@/ui/Inputs'
import { AuthLayout } from './AuthLayout'

/**
 * First run. There are no accounts yet, so whoever opens the app creates the
 * owner. The API closes this door the moment one exists.
 */
export function SetupPage() {
  const client = useQueryClient()
  const [form, setForm] = useState({ organization: '', name: '', email: '', password: '' })
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  const setup = useMutation({
    mutationFn: () => api.post<AuthState>('/auth/setup', form),
    onSuccess: (state) => client.setQueryData(keys.auth, state),
  })
  const fields = setup.error instanceof ApiError ? setup.error.fields : {}
  const general =
    setup.isError && Object.keys(fields).length === 0 ? errorMessage(setup.error) : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setup.mutate()
  }

  return (
    <AuthLayout
      title="Set up Ariad"
      description="Create the owner account. You can add teammates, with their own roles, once you are in."
      footer="This page only appears once, before the first account exists."
    >
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {general && <Banner tone="danger">{general}</Banner>}
        <Field
          label="Organization"
          hint="The name your subscribers know you by. It goes in every email footer."
          error={fields.organization}
        >
          <TextInput
            value={form.organization}
            onChange={set('organization')}
            autoComplete="organization"
            autoFocus
            required
          />
        </Field>
        <Field label="Your name" error={fields.name}>
          <TextInput value={form.name} onChange={set('name')} autoComplete="name" required />
        </Field>
        <Field label="Email" error={fields.email}>
          <TextInput
            type="email"
            value={form.email}
            onChange={set('email')}
            autoComplete="username"
            required
          />
        </Field>
        <Field label="Password" hint="At least 8 characters." error={fields.password}>
          <PasswordInput
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
            required
          />
        </Field>
        <Button type="submit" loading={setup.isPending} fullWidth>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
