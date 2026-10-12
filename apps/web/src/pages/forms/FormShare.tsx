import {
  API_PREFIX,
  escapeHtml,
  publicFieldsOf,
  type CustomField,
  type PublicFormField,
  type SignupForm,
} from '@ariad/shared'
import { FormSection } from '@/components/FormSection'
import { Button } from '@/ui/Button'
import { CodeSnippet } from '@/ui/CodeSnippet'
import { Banner } from '@/ui/Feedback'

/**
 * Tall enough for the embedded form without a scrollbar of its own: the card,
 * each thing in it at its usual height, and room for a line of error under a field.
 */
function embedHeight(form: SignupForm): number {
  const choosesLists = form.letSubscriberChoose && form.listIds.length > 1
  const height =
    130 + // the card's padding, the title and the credit under the card
    (form.description ? 70 : 0) +
    86 * (1 + form.fields.length) +
    (choosesLists ? 36 + 54 * form.listIds.length : 0) +
    (form.consentRequired ? 74 : 0) +
    64 + // the button
    48 // one error, or a title that runs to a second line
  return Math.ceil(height / 20) * 20
}

function inputFor(field: PublicFormField): string {
  const name = escapeHtml(field.key)
  const required = field.required ? ' required' : ''
  if (field.type === 'select' && field.options.length > 0) {
    const options = [
      '<option value=""></option>',
      ...field.options.map((option) => `<option>${escapeHtml(option)}</option>`),
    ].join('')
    return `<select name="${name}"${required}>${options}</select>`
  }
  if (field.type === 'boolean') {
    return `<select name="${name}"${required}><option value=""></option><option>Yes</option><option>No</option></select>`
  }
  const type = field.type === 'date' ? 'date' : field.key === 'phone' ? 'tel' : 'text'
  return `<input type="${type}" name="${name}"${required}>`
}

/** The same form as bare HTML, for a site that wants it in its own styles. The field names are what the server reads. */
function plainHtml(form: SignupForm, fields: PublicFormField[], action: string): string {
  const lines = [
    `<form action="${escapeHtml(action)}" method="post">`,
    '  <label>Email <input type="email" name="email" required></label>',
    ...fields.map((field) => `  <label>${escapeHtml(field.label)} ${inputFor(field)}</label>`),
  ]
  if (form.consentRequired) {
    lines.push(
      `  <label><input type="checkbox" name="consent" required> ${escapeHtml(form.consentText)}</label>`,
    )
  }
  lines.push(
    '  <!-- Leave this in, and leave it hidden. People never see it; bots fill it in and are turned away. -->',
    '  <div style="position:absolute;left:-9999px" aria-hidden="true">',
    '    <label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label>',
    '  </div>',
    `  <button type="submit">${escapeHtml(form.buttonText)}</button>`,
    '</form>',
  )
  return lines.join('\n')
}

/**
 * The three ways to put a form in front of people: a link to its own page,
 * that page inside a frame on another site, and plain HTML to style yourself.
 * All three are for the form as it was last saved, because that is the one
 * the server has.
 */
export function FormShare({
  form,
  customFields,
  publicUrl,
  publicUrlIsLocal,
  dirty,
  onSetPublicUrl,
}: {
  form: SignupForm
  customFields: CustomField[]
  /** What links are built from: the saved public URL, or the server's own address. */
  publicUrl: string
  publicUrlIsLocal: boolean
  dirty: boolean
  onSetPublicUrl: () => void
}) {
  const hosted = `${publicUrl}/subscribe/${form.id}`
  const action = `${publicUrl}${API_PREFIX}/public/forms/${form.id}/subscribe`
  const iframe = `<iframe src="${escapeHtml(hosted)}" title="${escapeHtml(form.title)}" width="100%" height="${embedHeight(form)}" style="border:0;max-width:30rem" loading="lazy"></iframe>`
  const choosesLists = form.letSubscriberChoose && form.listIds.length > 1

  return (
    <div className="flex flex-col">
      {(publicUrlIsLocal || !form.enabled || dirty) && (
        <div className="mb-8 flex flex-col gap-3">
          {publicUrlIsLocal && (
            <Banner
              tone="warning"
              title="These links only work on this computer"
              actions={
                <Button size="sm" variant="outlined" onClick={onSetPublicUrl}>
                  Set a public URL
                </Button>
              }
            >
              {publicUrl} cannot be reached from anyone else's device. Give Ariad a public URL
              before you share this form, then copy these again.
            </Banner>
          )}
          {!form.enabled && (
            <Banner tone="warning" title="This form is off">
              Its page and embeds say it is closed. Turn on "Accept signups" in Settings to open it.
            </Banner>
          )}
          {dirty && (
            <Banner tone="info" title="You have unsaved changes">
              What is below is for the form as it was last saved. Save, and it updates.
            </Banner>
          )}
        </div>
      )}

      <FormSection
        title="Hosted page"
        description="A page of its own for the form. Link to it from an email, a social profile or a QR code."
      >
        <CodeSnippet label="Link" code={hosted} />
      </FormSection>

      <FormSection
        title="Embed"
        description="Shows the hosted form inside a page of your website. Paste it where the form should appear. It keeps up with every change you save here."
      >
        <div className="flex flex-col gap-1.5">
          <CodeSnippet label="Embed code" code={iframe} wrap />
          <p className="text-caption text-[var(--ds-fg-muted)]">
            The height fits the form as it is now. If your site shows it with a scrollbar, make the
            number larger.
          </p>
        </div>
      </FormSection>

      <FormSection
        title="Plain HTML"
        description="The form as bare HTML, for when you want it in your own site's styles. It posts to Ariad, which sends people on to your redirect URL or to the hosted page with the result."
      >
        <div className="flex flex-col gap-1.5">
          <CodeSnippet
            label="HTML form"
            code={plainHtml(form, publicFieldsOf(form.fields, customFields), action)}
          />
          <p className="text-caption text-[var(--ds-fg-muted)]">
            Keep the field names as they are. Paste it again after you add or remove a field here:
            unlike the embed, it does not update itself.
            {choosesLists
              ? ' People who sign up this way join every list on the form; only the hosted form offers the choice.'
              : ''}
          </p>
        </div>
      </FormSection>
    </div>
  )
}
