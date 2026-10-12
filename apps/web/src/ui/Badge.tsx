import * as React from 'react'
import { cn } from '@/lib/cn'
import type { Tone } from './Display'

/* ===========================================================================
   BADGE — UI Bible spec.

   A status, as a word: Sent, Draft, Bounced. Read, never pressed — if it does
   something, it is a chip or a button.

   A pill, 22px: under a chip and well under a button, and round where every
   control is 8px-cornered. The shape says "label" before the word is read.

   A tint with an inset ring rather than a border, so a row of them keeps one
   height. The text takes the tone's `-text` step, the one certified against
   that tint. The tone is never the only signal: the word is the status, and
   `dot` adds a mark that survives a screen without color.

   (Display's Chip is the 24px square-cornered tag. This is the status pill.)
   ======================================================================== */

const tint: Record<Tone, string> = {
  neutral: 'bg-[var(--ds-layer-active)] text-[var(--ds-fg-secondary)] ring-[var(--ds-border)]',
  accent: 'bg-[var(--ds-accent-subtle)] text-[var(--ds-accent-text)] ring-[var(--ds-accent-border)]',
  success:
    'bg-[var(--ds-success-subtle)] text-[var(--ds-success-text)] ring-[var(--ds-success-border)]',
  warning:
    'bg-[var(--ds-warning-subtle)] text-[var(--ds-warning-text)] ring-[var(--ds-warning-border)]',
  danger: 'bg-[var(--ds-danger-subtle)] text-[var(--ds-danger-text)] ring-[var(--ds-danger-border)]',
  info: 'bg-[var(--ds-info-subtle)] text-[var(--ds-info-text)] ring-[var(--ds-info-border)]',
}

const dotFill: Record<Tone, string> = {
  neutral: 'bg-[var(--ds-fg-muted)]',
  accent: 'bg-[var(--ds-accent)]',
  success: 'bg-[var(--ds-success)]',
  warning: 'bg-[var(--ds-warning)]',
  danger: 'bg-[var(--ds-danger)]',
  info: 'bg-[var(--ds-info)]',
}

export function Badge({
  tone = 'neutral',
  children,
  dot,
  size = 'md',
  className,
}: {
  tone?: Tone
  /** The status, in a word or two. */
  children: React.ReactNode
  /** A 6px mark in the tone at full strength, before the word. */
  dot?: boolean
  /** `sm` is 18px, for a table cell or beside a title. */
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      data-tabular
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap ring-1 ring-inset',
        size === 'sm' ? 'h-[18px] px-1.5 text-caption' : 'h-[22px] px-2 text-caption',
        tint[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotFill[tone])} />}
      {children}
    </span>
  )
}
