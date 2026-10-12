import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * A titled group of fields on a settings page. A section, not a card: the
 * fields are saved together with the rest of the page, so there is nothing
 * about the group itself to act on. On a wide screen the title sits beside
 * its fields; on a narrow one, above them.
 */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('grid gap-x-10 gap-y-4 border-t border-[var(--ds-border-subtle)] py-8 first:border-t-0 first:pt-0 lg:grid-cols-[18rem_minmax(0,34rem)]', className)}>
      <div className="flex flex-col gap-1">
        <h3 className="text-h4 text-[var(--ds-fg)]">{title}</h3>
        {description && <p className="text-body-sm text-[var(--ds-fg-muted)]">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </section>
  )
}
