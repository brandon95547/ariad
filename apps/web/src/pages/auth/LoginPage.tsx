import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AuthState } from '@ariad/shared'
import { api, errorMessage } from '@/lib/api'
import { keys } from '@/lib/queries'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Controls'
import { Banner } from '@/ui/Feedback'
import { PasswordInput, TextInput } from '@/ui/Inputs'
import { AuthLayout } from './AuthLayout'

export function LoginPage() {
  const client = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const login = useMutation({
    mutationFn: () => api.post<AuthState>('/auth/login', { email, password }),
    onSuccess: (state) => {
      // Everything cached belongs to whoever was signed in before.
      client.clear()
      client.setQueryData(keys.auth, state)
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    login.mutate()
  }

  return (
    <AuthLayout title="Sign in" description="Use the email and password for your Ariad account.">
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {login.isError && <Banner tone="danger">{errorMessage(login.error)}</Banner>}
        <Field label="Email">
          <TextInput
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoFocus
            required
          />
        </Field>
        <Field label="Password">
          <PasswordInput
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" loading={login.isPending} fullWidth>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}
