import * as React from 'react'
import { cn } from '@/lib/cn'

/* ===========================================================================
   CARD — UI Bible spec.

   A card groups content that belongs together AND can be acted on as a unit.
   If neither is true, you want a section with a heading, not a card.

   In dark UI the card is lighter than the canvas — that is the elevation. The
   shadow only reinforces it, and on a near-black page it does almost nothing
   on its own.
   ======================================================================== */

export type CardVariant = 'outlined' | 'filled' | 'elevated'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
  /** Adds hover lift and pointer. The whole card must be one target. */
  interactive?: boolean
  selected?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
  as?: React.ElementType
}

const cardPad = { none: '', sm: 'p-3.5', md: 'p-5', lg: 'p-6' }

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = 'outlined', interactive, selected, padding = 'md', className, as, children, ...rest },
  ref,
) {
  const Comp = (as ?? 'div') as React.ElementType
  return (
    <Comp
      ref={ref}
      data-selected={selected || undefined}
      className={cn(
        'relative rounded-[var(--radius-xl)] transition-all duration-[180ms] ease-[cubic-bezier(0.2,0,0,1)]',
        variant === 'outlined' && 'border border-[var(--ds-border-subtle)] bg-[var(--ds-surface)]',
        variant === 'filled' && 'bg-[var(--ds-surface-inset)]',
        variant === 'elevated' &&
          'border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-raised)] shadow-e2',
        interactive &&
          'cursor-pointer text-left hover:-translate-y-px hover:border-[var(--ds-border)] hover:shadow-e3 active:translate-y-0 active:shadow-e1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
        selected && 'border-[var(--ds-accent)] shadow-[0_0_0_1px_var(--ds-accent)]',
        cardPad[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </Comp>
  )
})

/** A titled block. Not a card — a card implies the group can be acted on. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-overline text-[var(--ds-fg-muted)] uppercase">{title}</h2>
          {description && <p className="text-body-sm text-[var(--ds-fg-muted)]">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2 coarse:gap-3">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
