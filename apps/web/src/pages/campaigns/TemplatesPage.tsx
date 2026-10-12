import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Copy, FileText, Megaphone, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  defaultDesign,
  renderDesign,
  roleAtLeast,
  type Campaign,
  type Template,
  type TemplateSummary,
} from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { api, errorMessage } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import { useAuthState } from '@/lib/queries'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback'
import { ActionMenu } from '@/ui/Menu'
import { Page, PageHeader } from '@/ui/Shell'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'

/**
 * A scaled-down picture of the template. The real HTML in a frame nothing can
 * click into, shrunk with a transform: a thumbnail that is the email and not a
 * drawing of one.
 */
function Thumbnail({ id }: { id: string }) {
  const template = useQuery({
    queryKey: ['template', id],
    queryFn: () => api.get<Template>(`/templates/${id}`),
    staleTime: 60_000,
  })
  return (
    <div
      className="relative h-44 overflow-hidden rounded-t-[var(--radius-xl)] border-b border-[var(--ds-border-subtle)] bg-[var(--c-email-stage)]"
      aria-hidden
    >
      {template.data ? (
        <iframe
          title=""
          tabIndex={-1}
          sandbox=""
          srcDoc={template.data.html}
          className="pointer-events-none absolute top-0 left-1/2 h-[704px] w-[640px] origin-top -translate-x-1/2 scale-[0.5] border-0 bg-white"
        />
      ) : (
        <Skeleton className="absolute inset-0 rounded-none" />
      )}
    </div>
  )
}

/** Templates: emails to start other emails from. */
export function TemplatesPage() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const canEdit = roleAtLeast(useAuthState().data?.user?.role ?? 'viewer', 'editor')
  const [removing, setRemoving] = useState<TemplateSummary | null>(null)
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<TemplateSummary[]>('/templates'),
  })
  const refresh = () => client.invalidateQueries({ queryKey: ['templates'] })

  const create = useMutation({
    mutationFn: () => {
      const design = defaultDesign()
      return api.post<Template>('/templates', {
        name: 'Untitled template',
        design,
        html: renderDesign(design),
      })
    },
    onSuccess: (template) => {
      void refresh()
      navigate(`/templates/${template.id}`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const duplicate = useMutation({
    mutationFn: (id: string) => api.post<Template>(`/templates/${id}/duplicate`),
    onSuccess: (template) => {
      void refresh()
      navigate(`/templates/${template.id}`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const use = useMutation({
    mutationFn: async (summary: TemplateSummary) => {
      const template = await api.get<Template>(`/templates/${summary.id}`)
      return api.post<Campaign>('/campaigns', {
        name: `${template.name} campaign`,
        subject: template.subject,
        preheader: template.preheader,
        design: template.design,
        html: template.html,
      })
    },
    onSuccess: (campaign) => {
      void client.invalidateQueries({ queryKey: ['campaigns'] })
      navigate(`/campaigns/${campaign.id}`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (template: TemplateSummary) => api.delete(`/templates/${template.id}`),
    onSuccess: (_result, template) => {
      setRemoving(null)
      void refresh()
      toast.success(`${template.name} deleted`)
    },
  })

  return (
    <Page>
      <PageHeader
        title="Templates"
        description="Emails to start from. Starter templates come with Ariad; copy one to make it yours."
        actions={
          canEdit ? (
            <Button startIcon={<Plus />} onClick={() => create.mutate()} loading={create.isPending}>
              New template
            </Button>
          ) : undefined
        }
      />

      {templates.isError && <Banner tone="danger">{errorMessage(templates.error)}</Banner>}

      {templates.isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-72 rounded-[var(--radius-xl)]" />
          ))}
        </div>
      ) : templates.data && templates.data.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={<FileText />}
            title="No templates yet"
            description="Save any email as a template and it will be here to start the next one from."
          />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(templates.data ?? []).map((template) => (
            <li key={template.id}>
              <Card padding="none" className="flex h-full flex-col">
                <Thumbnail id={template.id} />
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {template.builtin ? (
                          <h2 className="text-h4 text-[var(--ds-fg)]">{template.name}</h2>
                        ) : (
                          <Link
                            to={`/templates/${template.id}`}
                            className="text-h4 text-[var(--ds-fg)] underline-offset-2 hover:underline"
                          >
                            {template.name}
                          </Link>
                        )}
                        {template.builtin && <Badge tone="neutral">Starter</Badge>}
                      </div>
                      <p className="text-body-sm text-[var(--ds-fg-muted)]">
                        {template.description ??
                          (template.builtin ? '' : `Edited ${formatRelative(template.updatedAt)}`)}
                      </p>
                    </div>
                    {canEdit && (
                      <ActionMenu
                        label={`Actions for ${template.name}`}
                        icon={<MoreHorizontal size={16} />}
                        actions={[
                          ...(template.builtin
                            ? []
                            : [
                                {
                                  id: 'edit',
                                  label: 'Edit',
                                  icon: <Pencil size={14} />,
                                  onSelect: () => navigate(`/templates/${template.id}`),
                                },
                              ]),
                          {
                            id: 'duplicate',
                            label: template.builtin ? 'Make a copy to edit' : 'Duplicate',
                            icon: <Copy size={14} />,
                            onSelect: () => duplicate.mutate(template.id),
                          },
                          ...(template.builtin
                            ? []
                            : [
                                {
                                  id: 'delete',
                                  label: 'Delete',
                                  icon: <Trash2 size={14} />,
                                  danger: true,
                                  separated: true,
                                  onSelect: () => {
                                    remove.reset()
                                    setRemoving(template)
                                  },
                                },
                              ]),
                        ]}
                      />
                    )}
                  </div>
                  {canEdit && (
                    <div className="mt-auto flex">
                      <Button
                        size="sm"
                        variant="outlined"
                        startIcon={<Megaphone />}
                        onClick={() => use.mutate(template)}
                        loading={use.isPending && use.variables?.id === template.id}
                      >
                        Use in a campaign
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title={`Delete ${removing?.name ?? 'template'}?`}
        confirmLabel="Delete template"
        loading={remove.isPending}
      >
        <p>
          Campaigns and automations already made from it keep their own copy and are not affected.
        </p>
        {remove.isError && <Banner tone="danger">{errorMessage(remove.error)}</Banner>}
      </ConfirmDialog>
    </Page>
  )
}
