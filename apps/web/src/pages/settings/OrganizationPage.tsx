import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatAddress, roleAtLeast, type SettingsView } from '@ariad/shared'
import { FormSection } from '@/components/FormSection'
import { ApiError, api, errorMessage } from '@/lib/api'
import { keys, useAuthState, useSettings } from '@/lib/queries'
import { Button } from '@/ui/Button'
import { Combobox, Field, Switch } from '@/ui/Controls'
import { Banner, Skeleton } from '@/ui/Feedback'
import { TextInput, Textarea } from '@/ui/Inputs'
import { toast } from '@/ui/Toast'

type Draft = Pick<SettingsView, 'organization' | 'publicUrl' | 'timezone' | 'sending' | 'compliance'>

const pickDraft = (settings: SettingsView): Draft => ({
  organization: settings.organization,
  publicUrl: settings.publicUrl,
  timezone: settings.timezone,
  sending: settings.sending,
  compliance: settings.compliance,
})

function timezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'UTC']
  }
}

/**
 * Settings › Organization. Who the mail is from, where they are, and the
 * address the outside world reaches this server at. Saved as one form.
 */
export function OrganizationPage() {
  const client = useQueryClient()
  const settings = useSettings()
  const canEdit = roleAtLeast(useAuthState().data?.user?.role ?? 'viewer', 'admin')
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => {
    if (settings.data && !draft) setDraft(pickDraft(settings.data))
  }, [settings.data, draft])

  const zoneOptions = useMemo(() => timezones().map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') })), [])
  const dirty = Boolean(draft && settings.data && JSON.stringify(draft) !== JSON.stringify(pickDraft(settings.data)))

  const save = useMutation({
    mutationFn: () => api.patch<SettingsView>('/settings', draft),
    onSuccess: (saved) => {
      client.setQueryData(keys.settings, saved)
      setDraft(pickDraft(saved))
      toast.success('Settings saved')
    },
  })
  const fields = save.error instanceof ApiError ? save.error.fields : {}

  if (settings.isError) return <Banner tone="danger">{errorMessage(settings.error)}</Banner>
  if (!draft || !settings.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  const org = (key: keyof Draft['organization']) => ({
    value: draft.organization[key],
    onChange: (event: { target: { value: string } }) =>
      setDraft({ ...draft, organization: { ...draft.organization, [key]: event.target.value } }),
    disabled: !canEdit,
  })
  const address = formatAddress(draft.organization)
  const effective = draft.publicUrl || settings.data.effectivePublicUrl
  const isLocal = /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(effective)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }

  return (
    <form onSubmit={submit} noValidate>
      {save.isError && Object.keys(fields).length === 0 && (
        <Banner tone="danger" className="mb-6">
          {errorMessage(save.error)}
        </Banner>
      )}

      <FormSection title="Organization" description="The name your subscribers know you by. It is in the footer of every email.">
        <Field label="Name" error={fields['organization.name']}>
          <TextInput {...org('name')} autoComplete="organization" />
        </Field>
        <Field label="Website" optional>
          <TextInput {...org('website')} placeholder="https://example.com" inputMode="url" />
        </Field>
      </FormSection>

      <FormSection
        title="Mailing address"
        description="US law (CAN-SPAM) requires a valid physical postal address in every marketing email. A campaign will not send until this is filled in."
      >
        <Field label="Street address">
          <TextInput {...org('address1')} autoComplete="address-line1" />
        </Field>
        <Field label="Suite, unit or PO box" optional>
          <TextInput {...org('address2')} autoComplete="address-line2" />
        </Field>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_8rem_8rem]">
          <Field label="City">
            <TextInput {...org('city')} autoComplete="address-level2" />
          </Field>
          <Field label="State">
            <TextInput {...org('region')} autoComplete="address-level1" />
          </Field>
          <Field label="ZIP">
            <TextInput {...org('postalCode')} autoComplete="postal-code" />
          </Field>
        </div>
        <Field label="Country" optional>
          <TextInput {...org('country')} autoComplete="country-name" />
        </Field>
        <p className="text-caption text-[var(--ds-fg-muted)]">
          {address ? `In the footer as: ${address}` : 'Fill in at least the street address and city.'}
        </p>
      </FormSection>

      <FormSection
        title="Public URL"
        description="The address your recipients' devices reach Ariad at. Unsubscribe links, open tracking and click tracking are built from it."
      >
        <Field label="Public URL" hint={`Links currently use ${effective}`} error={fields.publicUrl}>
          <TextInput
            value={draft.publicUrl}
            onChange={(event) => setDraft({ ...draft, publicUrl: event.target.value })}
            placeholder="https://mail.example.com"
            inputMode="url"
            spellCheck={false}
            disabled={!canEdit}
          />
        </Field>
        {isLocal && (
          <Banner tone="warning" title="These links only work on this computer">
            {effective} is not reachable from anyone else's inbox. You can connect accounts and send yourself tests now; before a real
            campaign, put Ariad on a server with a domain and enter that address here.
          </Banner>
        )}
      </FormSection>

      <FormSection title="Time zone" description="Used for scheduled sends and for date-based automations such as birthdays.">
        <Field label="Time zone" htmlFor="settings-timezone">
          <Combobox id="settings-timezone" options={zoneOptions} value={draft.timezone} onChange={(timezone) => setDraft({ ...draft, timezone })} />
        </Field>
      </FormSection>

      <FormSection title="Tracking" description="The starting choice for new campaigns. Each campaign can change it.">
        <Switch
          label="Track opens"
          description="Adds a 1-pixel image to each email. Some mail apps load it automatically, so opens are an estimate."
          checked={draft.sending.trackOpens}
          onChange={(trackOpens) => setDraft({ ...draft, sending: { ...draft.sending, trackOpens } })}
        />
        <Switch
          label="Track clicks"
          description="Sends links through your public URL so clicks can be counted."
          checked={draft.sending.trackClicks}
          onChange={(trackClicks) => setDraft({ ...draft, sending: { ...draft.sending, trackClicks } })}
        />
      </FormSection>

      <FormSection title="Consent" description="How people join, and what the footer tells them about why they are hearing from you.">
        <Switch
          label="Double opt-in for new lists and forms"
          description="New subscribers confirm by email before they are added. It keeps typos and bots off your lists and is the clearest record of consent."
          checked={draft.compliance.doubleOptInDefault}
          onChange={(doubleOptInDefault) => setDraft({ ...draft, compliance: { ...draft.compliance, doubleOptInDefault } })}
        />
        <Field label="Footer note" optional hint="Shown under your address in every marketing email.">
          <Textarea
            rows={2}
            value={draft.compliance.footerNote}
            onChange={(event) => setDraft({ ...draft, compliance: { ...draft.compliance, footerNote: event.target.value } })}
            disabled={!canEdit}
          />
        </Field>
      </FormSection>

      {canEdit && (
        <div className="flex items-center gap-3 border-t border-[var(--ds-border-subtle)] pt-6">
          <Button type="submit" loading={save.isPending} disabled={!dirty}>
            Save changes
          </Button>
          {dirty && (
            <Button variant="text" onClick={() => setDraft(pickDraft(settings.data))} disabled={save.isPending}>
              Discard
            </Button>
          )}
        </div>
      )}
    </form>
  )
}
