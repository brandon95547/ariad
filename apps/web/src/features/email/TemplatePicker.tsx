import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import type { Template, TemplateSummary } from '@ariad/shared'
import { api, errorMessage } from '@/lib/api'
import { Badge } from '@/ui/Badge'
import { Dialog } from '@/ui/Dialog'
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback'

/**
 * Choose a template to start from. Picking one hands back the whole template;
 * what to do with it (replace the body, also take the subject) is the caller's.
 */
export function TemplatePicker({
  open,
  onClose,
  onPick,
  title = 'Start from a template',
  description = 'This replaces the content you have now.',
}: {
  open: boolean
  onClose: () => void
  onPick: (template: Template) => void
  title?: string
  description?: string
}) {
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.get<TemplateSummary[]>('/templates'), enabled: open })

  const pick = async (id: string) => {
    onPick(await api.get<Template>(`/templates/${id}`))
  }

  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} size="lg">
      {templates.isError && <Banner tone="danger">{errorMessage(templates.error)}</Banner>}
      {templates.isPending ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-[4.5rem] rounded-[var(--radius-lg)]" />
          ))}
        </div>
      ) : templates.data && templates.data.length === 0 ? (
        <EmptyState compact icon={<FileText />} title="No templates yet" description="Save an email as a template and it will be here." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(templates.data ?? []).map((template) => (
            <li key={template.id}>
              <button
                type="button"
                onClick={() => void pick(template.id)}
                className="touch-target flex h-full w-full flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--ds-border-interactive)] p-3.5 text-left transition-colors duration-[120ms] hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-layer-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]"
              >
                <span className="flex items-center gap-2">
                  <span className="text-label text-[var(--ds-fg)]">{template.name}</span>
                  {template.builtin && <Badge tone="neutral">Starter</Badge>}
                </span>
                {template.description && <span className="text-caption text-[var(--ds-fg-muted)]">{template.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
