import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { Copy, Save } from 'lucide-react'
import { roleAtLeast, type Template } from '@ariad/shared'
import { EmailEditor } from '@/features/email/EmailEditor'
import { EmailPreview } from '@/features/email/EmailPreview'
import { MergeTagMenu, insertAtCursor } from '@/features/email/MergeTagMenu'
import { ApiError, api, errorMessage } from '@/lib/api'
import { useAuthState } from '@/lib/queries'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Controls'
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback'
import { TextInput } from '@/ui/Inputs'
import { Page, PageHeader } from '@/ui/Shell'
import { toast } from '@/ui/Toast'

type Draft = Pick<Template, 'name' | 'description' | 'subject' | 'preheader' | 'html' | 'design'>

const toDraft = (template: Template): Draft => ({
  name: template.name,
  description: template.description,
  subject: template.subject,
  preheader: template.preheader,
  html: template.html,
  design: template.design,
})

/** One template: its name, its suggested subject, and the email itself. */
export function TemplateEditorPage() {
  const { id = '' } = useParams()
  const template = useQuery({ queryKey: ['template', id], queryFn: () => api.get<Template>(`/templates/${id}`) })

  if (template.isPending) {
    return (
      <Page>
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-96 rounded-[var(--radius-xl)]" />
      </Page>
    )
  }
  if (template.isError) {
    const missing = template.error instanceof ApiError && template.error.status === 404
    return (
      <Page>
        <PageHeader title="Template" back={{ to: '/templates', label: 'Templates' }} />
        {missing ? <EmptyState title="This template no longer exists" /> : <Banner tone="danger">{errorMessage(template.error)}</Banner>}
      </Page>
    )
  }
  return <Editor key={template.data.id} template={template.data} />
}

function Editor({ template }: { template: Template }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const canEdit = roleAtLeast(useAuthState().data?.user?.role ?? 'viewer', 'editor') && !template.builtin
  const [draft, setDraft] = useState<Draft>(() => toDraft(template))
  const [saved, setSaved] = useState<Draft>(() => toDraft(template))
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved])
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }))
  const subject = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const save = useMutation({
    mutationFn: (body: Draft) => api.patch<Template>(`/templates/${template.id}`, body),
    onSuccess: (updated, body) => {
      setSaved(body)
      client.setQueryData(['template', template.id], updated)
      void client.invalidateQueries({ queryKey: ['templates'] })
      toast.success('Template saved')
    },
    onError: (error) => toast.error('The template was not saved', { description: errorMessage(error) }),
  })

  const duplicate = useMutation({
    mutationFn: () => api.post<Template>(`/templates/${template.id}/duplicate`),
    onSuccess: (copy) => {
      void client.invalidateQueries({ queryKey: ['templates'] })
      navigate(`/templates/${copy.id}`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <Page>
      <PageHeader
        title={draft.name || 'Untitled template'}
        back={{ to: '/templates', label: 'Templates' }}
        description={canEdit ? (dirty ? 'Unsaved changes' : 'All changes saved') : undefined}
        actions={
          canEdit ? (
            <Button startIcon={<Save />} onClick={() => save.mutate(draft)} loading={save.isPending} disabled={!dirty || !draft.name.trim()}>
              Save template
            </Button>
          ) : template.builtin ? (
            <Button startIcon={<Copy />} onClick={() => duplicate.mutate()} loading={duplicate.isPending}>
              Make a copy to edit
            </Button>
          ) : undefined
        }
      />

      {template.builtin && (
        <Banner tone="info" title="This is a starter template">
          It comes with Ariad and cannot be changed. Make a copy and the copy is yours to edit.
        </Banner>
      )}

      {canEdit ? (
        <>
          <div className="grid max-w-[44rem] grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Template name">
              <TextInput value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
            </Field>
            <Field label="Description" optional>
              <TextInput value={draft.description ?? ''} onChange={(event) => patch({ description: event.target.value || null })} />
            </Field>
            <Field label="Suggested subject" optional hint="Fills in the subject of an email started from this template.">
              <TextInput ref={subject} value={draft.subject} onChange={(event) => patch({ subject: event.target.value })} />
            </Field>
            <Field label="Suggested preview text" optional>
              <TextInput value={draft.preheader ?? ''} onChange={(event) => patch({ preheader: event.target.value || null })} />
            </Field>
            <div className="-mt-2 flex sm:col-span-2">
              <MergeTagMenu onPick={(token) => patch({ subject: insertAtCursor(subject.current, draft.subject, token) })} />
            </div>
          </div>
          <EmailEditor value={{ html: draft.html, design: draft.design }} onChange={(body) => patch(body)} subject={draft.subject} preheader={draft.preheader} />
        </>
      ) : (
        <EmailPreview html={template.html} subject={template.subject} />
      )}
    </Page>
  )
}
