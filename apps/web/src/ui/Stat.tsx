import * as React from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/cn'

/* ===========================================================================
   STAT TILE — UI Bible spec (Dashboards).

   The atom of a dashboard: one number and what it measures. The number is the
   largest thing in the tile and the label the smallest, so the eye lands on
   the value and only then learns what it is. The label sits 6px above it,
   like every label over the thing it names.

   Tabular figures, so the digits hold still as the value updates.

   A change is said three ways — an arrow, the figure, and a color — because a
   bare number cannot say whether it is good, and color alone says nothing to
   one reader in twelve. Which way is good is not the tile's to guess: up is
   good for opens and bad for bounces, so `good` says it. Left out, up reads
   as good and down as bad.

   Three or four to a row, 12px apart; six is the ceiling. Past that, delete
   one rather than shrink them.
   ======================================================================== */

const arrows = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight }
const spoken = { up: 'up', down: 'down', flat: 'no change' }

export function StatTile({
  label,
  value,
  hint,
  delta,
  icon,
  className,
}: {
  /** What is measured, with its unit: "Open rate", not "Opens". */
  label: string
  value: React.ReactNode
  /** What the figures are against, or as of when: "vs. last 30 days". */
  hint?: React.ReactNode
  delta?: {
    /** As it should be read: "12.4%", "+318". */
    value: string
    direction: 'up' | 'down' | 'flat'
    /** Whether this change is the good kind. Flat is neither. */
    good?: boolean
  }
  icon?: React.ReactNode
  className?: string
}) {
  const good =
    delta?.direction === 'flat'
      ? undefined
      : (delta?.good ?? (delta ? delta.direction === 'up' : undefined))
  const Arrow = delta ? arrows[delta.direction] : null

  return (
    <div
      className={cn(
        'relative min-w-0 rounded-[var(--radius-xl)] border border-[var(--ds-border-subtle)] bg-[var(--ds-surface)] p-4',
        className,
      )}
    >
      {icon && (
        // Out of the flow, so it cannot push the label off the value.
        <span
          aria-hidden
          className="absolute top-4 right-4 text-[var(--ds-fg-muted)]"
          style={{ lineHeight: 0 }}
        >
          {icon}
        </span>
      )}
      <dl className="flex flex-col gap-1.5">
        <dt className={cn('text-overline text-[var(--ds-fg-muted)] uppercase', icon && 'pr-7')}>
          {label}
        </dt>
        <dd className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span data-tabular className="text-h2 text-[var(--ds-fg)] [overflow-wrap:anywhere]">
            {value}
          </span>
          {delta && Arrow && (
            <span
              data-tabular
              className={cn(
                'inline-flex items-center gap-0.5 text-caption font-medium',
                good === true && 'text-[var(--ds-success-text)]',
                good === false && 'text-[var(--ds-danger-text)]',
                good === undefined && 'text-[var(--ds-fg-muted)]',
              )}
            >
              <Arrow size={13} aria-hidden className="shrink-0" />
              {delta.value}
              <span className="sr-only-ds">, {spoken[delta.direction]}</span>
            </span>
          )}
        </dd>
        {hint && <dd className="mt-1 text-caption text-[var(--ds-fg-muted)]">{hint}</dd>}
      </dl>
    </div>
  )
}
