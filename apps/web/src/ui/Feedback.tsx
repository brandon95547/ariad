import * as React from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'

/* ===========================================================================
   FEEDBACK — UI Bible spec (Banner, Empty States, Skeleton, Loading States,
   Progress Indicator, Error States).

   What the system says back: a banner that stays until it is dealt with, the
   screen with nothing on it yet, and the three ways of saying "wait".
   ======================================================================== */

export type BannerTone = 'info' | 'success' | 'warning' | 'danger'

const bannerIcon: Record<BannerTone, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
}

const bannerSkin: Record<BannerTone, string> = {
  info: 'border-[var(--ds-info-border)] bg-[var(--ds-info-subtle)]',
  success: 'border-[var(--ds-success-border)] bg-[var(--ds-success-subtle)]',
  warning: 'border-[var(--ds-warning-border)] bg-[var(--ds-warning-subtle)]',
  danger: 'border-[var(--ds-danger-border)] bg-[var(--ds-danger-subtle)]',
}

/** On a tint the icon takes the `-text` step: the solid tone lands near 3:1 there. */
const bannerInk: Record<BannerTone, string> = {
  info: 'text-[var(--ds-info-text)]',
  success: 'text-[var(--ds-success-text)]',
  warning: 'text-[var(--ds-warning-text)]',
  danger: 'text-[var(--ds-danger-text)]',
}

/**
 * Banner — UI Bible spec.
 *
 * In the page, where the thing it is about is, and there until it is dealt
 * with: a sending domain that is not verified, an import that failed. What
 * comes and goes on its own is a toast.
 *
 * A tint and a border, never a solid fill — body text on a solid status color
 * cannot reach 4.5:1 — and the tone is carried by the icon as well, so it
 * survives a screen without color. The body stays in ordinary ink: a message
 * colored red end to end is harder to read and says more than it means.
 *
 * Danger interrupts a screen reader; the rest wait their turn. Two actions at
 * most: a third is a decision, and a decision is a dialog.
 */
export function Banner({
  tone,
  title,
  children,
  actions,
  onDismiss,
  className,
}: {
  tone: BannerTone
  title?: React.ReactNode
  children?: React.ReactNode
  /** One or two buttons, `sm`. */
  actions?: React.ReactNode
  onDismiss?: () => void
  className?: string
}) {
  const Icon = bannerIcon[tone]
  const titleId = React.useId()
  const urgent = tone === 'danger'
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      aria-labelledby={title ? titleId : undefined}
      className={cn('flex gap-3 rounded-[var(--radius-lg)] border p-3.5', bannerSkin[tone], className)}
    >
      {/* A pixel down, which puts it between a title's line and a body's. */}
      <span className={cn('mt-px shrink-0', bannerInk[tone])} aria-hidden>
        <Icon size={17} strokeWidth={2} />
      </span>
      <div className="flex min-w-0 max-w-[68ch] flex-1 flex-col gap-1.5">
        {title && (
          <p id={titleId} className="text-label text-[var(--ds-fg)]">
            {title}
          </p>
        )}
        {children && (
          <div className="text-body-sm text-[var(--ds-fg-secondary)]">{children}</div>
        )}
        {actions && (
          <div className="flex flex-wrap items-center gap-2 coarse:gap-3">{actions}</div>
        )}
      </div>
      {onDismiss && (
        <IconButton
          // A page with three banners needs three names for this.
          label={typeof title === 'string' ? `Dismiss: ${title}` : 'Dismiss'}
          icon={<X />}
          size="xs"
          onClick={onDismiss}
          className="-mt-1 -mr-1 ml-auto shrink-0"
        />
      )}
    </div>
  )
}

/**
 * Empty state — UI Bible spec.
 *
 * Three parts, always in this order: what is here (the icon), what that means
 * (the title), what to do next (the action). One without an action is a dead
 * end, and the most expensive screen a product has.
 *
 * Capped at 24rem: centered text needs a narrower measure than text set
 * left, because every line starts somewhere different.
 *
 * `compact` is the one inside a table or a card.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
  className,
}: {
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
  /** The one filled button, and beside it a text button at most. */
  action?: React.ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-3 px-6 py-10' : 'gap-4 px-8 py-16',
        className,
      )}
    >
      {icon && (
        <span
          aria-hidden
          className={cn(
            // An alpha layer, not a rung of the ramp: this lands on the page,
            // in a card and in a drawer, and a fixed value is right in one.
            'grid place-items-center rounded-[var(--radius-xl)] border border-[var(--ds-border-subtle)] bg-[var(--ds-layer-active)] text-[var(--ds-fg-muted)]',
            compact ? 'h-11 w-11' : 'h-14 w-14',
          )}
        >
          {icon}
        </span>
      )}
      <div className="flex max-w-sm flex-col gap-1.5">
        <h2 className={cn('text-[var(--ds-fg)]', compact ? 'text-h4' : 'text-h3')}>{title}</h2>
        {description && (
          <p className="text-body-sm text-[var(--ds-fg-muted)]">{description}</p>
        )}
      </div>
      {action && (
        <div className="flex flex-wrap items-center justify-center gap-2 coarse:gap-3">{action}</div>
      )}
    </div>
  )
}

/**
 * Skeleton — UI Bible spec.
 *
 * A block the shape and place of what is coming — sized by `className`, e.g.
 * `h-3 w-40` for a line of 13px text — so the page does not jump when the
 * data lands. The fill is an alpha layer, the same on a card, a dialog and the
 * page. Hidden from a screen reader: the region around it says `aria-busy`
 * once, where twelve gray bars announced would be noise.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative block overflow-hidden rounded-[var(--radius-xs)] bg-[var(--ds-layer-active)]',
        // Slow and low in contrast. A fast, bright sweep reads as urgency and
        // is a hazard to anyone sensitive to flashing.
        'after:absolute after:inset-0 after:animate-[shimmer_1.6s_linear_infinite] after:bg-[linear-gradient(90deg,transparent_0%,var(--ds-layer-hover)_50%,transparent_100%)] after:bg-[length:200%_100%]',
        className,
      )}
    />
  )
}

/**
 * Spinner — UI Bible spec.
 *
 * For a wait with no known length, in something too small for a skeleton: a
 * button, a cell, the corner of a card. Never alone in the middle of a page —
 * that is a skeleton of the page.
 *
 * A spinning icon is silent, so it carries a name: `label`, or "Loading".
 */
export function Spinner({
  size = 16,
  label = 'Loading',
  className,
}: {
  /** 14 beside text, 16 in a control, 20–24 in the middle of a card. */
  size?: number
  label?: string
  className?: string
}) {
  return (
    <span role="status" className={cn('inline-flex text-[var(--ds-fg-muted)]', className)}>
      <Loader2 size={size} aria-hidden className="animate-[spin_720ms_linear_infinite]" />
      <span className="sr-only-ds">{label}</span>
    </span>
  )
}

export type ProgressTone = 'accent' | 'success' | 'warning' | 'danger'

const progressFill: Record<ProgressTone, string> = {
  accent: 'bg-[var(--ds-accent)]',
  success: 'bg-[var(--ds-success)]',
  warning: 'bg-[var(--ds-warning)]',
  danger: 'bg-[var(--ds-danger)]',
}

/**
 * Progress bar — UI Bible spec.
 *
 * For a wait that can be measured — a real number turns waiting into
 * progress. A 6px track, both it and the fill fully round: a square fill in a
 * round track leaves a notch at low values. The fill takes 420ms to move, so
 * a jump from 20% to 80% is seen as movement.
 *
 * `label` says what is progressing, and names it for a screen reader too:
 * "Sending campaign", not "Progress".
 */
export function ProgressBar({
  value,
  max = 100,
  tone = 'accent',
  label,
  showValue,
  className,
}: {
  value: number
  max?: number
  tone?: ProgressTone
  label?: string
  /** The percentage, at the end of the label's line. */
  showValue?: boolean
  className?: string
}) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  const rounded = Math.round(percent)
  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      {(label || showValue) && (
        <div className="flex items-baseline justify-between gap-4">
          {label && <span className="text-label text-[var(--ds-fg-secondary)]">{label}</span>}
          {showValue && (
            <span data-tabular className="ml-auto text-caption text-[var(--ds-fg-muted)]">
              {rounded}%
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label ?? 'Progress'}
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${rounded}%`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ds-layer-active)]"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-[420ms] ease-[cubic-bezier(0.2,0,0,1)]',
            progressFill[tone],
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
