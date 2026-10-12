import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Card } from '@/ui/Surface'

/**
 * A titled block on a dashboard: one idea, with a heading that says what it
 * is. The UI Bible's Panel — a header over a hairline, then the body — built
 * on the kit's Card so it sits on the same surface as everything else.
 *
 * `flush` is for a body that brings its own edges: a table, an empty state.
 */
export function Panel({
  title,
  description,
  actions,
  flush,
  className,
  children,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  flush?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Card as="section" padding="none" className={cn('flex min-w-0 flex-col overflow-hidden', className)}>
      <header className="flex items-center justify-between gap-4 border-b border-[var(--ds-border-subtle)] px-5 py-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-label text-[var(--ds-fg)]">{title}</h2>
          {description && <p className="text-caption text-[var(--ds-fg-muted)]">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5 coarse:gap-3">{actions}</div>}
      </header>
      <div className={cn('min-w-0 flex-1', !flush && 'p-5')}>{children}</div>
    </Card>
  )
}
