import * as React from 'react'
import { cn } from '@/lib/cn'

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

const chipTone: Record<Tone, string> = {
  neutral: 'bg-[var(--ds-layer-hover)] text-[var(--ds-fg-secondary)] border-[var(--ds-border)]',
  accent:
    'bg-[var(--ds-accent-subtle)] text-[var(--ds-accent-text)] border-[var(--ds-accent-border)]',
  success:
    'bg-[var(--ds-success-subtle)] text-[var(--ds-success-text)] border-[var(--ds-success-border)]',
  warning:
    'bg-[var(--ds-warning-subtle)] text-[var(--ds-warning-text)] border-[var(--ds-warning-border)]',
  danger:
    'bg-[var(--ds-danger-subtle)] text-[var(--ds-danger-text)] border-[var(--ds-danger-border)]',
  info: 'bg-[var(--ds-info-subtle)] text-[var(--ds-info-text)] border-[var(--ds-info-border)]',
}

export function Chip({
  children,
  tone = 'neutral',
  icon,
  className,
}: {
  children: React.ReactNode
  tone?: Tone
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 text-label-sm',
        chipTone[tone],
        className,
      )}
    >
      {icon && (
        <span aria-hidden style={{ lineHeight: 0 }}>
          {icon}
        </span>
      )}
      {children}
    </span>
  )
}

const dotTone: Record<Tone, string> = {
  neutral: 'bg-[var(--ds-fg-disabled)]',
  accent: 'bg-[var(--ds-accent)]',
  success: 'bg-[var(--ds-success)]',
  warning: 'bg-[var(--ds-warning)]',
  danger: 'bg-[var(--ds-danger)]',
  info: 'bg-[var(--ds-info)]',
}

/**
 * A status dot. Always paired with a text label — colour alone carries no
 * meaning for a colour-blind or screen-reader user, so the dot is decorative
 * and the word next to it is the status.
 */
export function StatusDot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden>
      {pulse && (
        <span
          className={cn(
            'absolute inset-0 rounded-full opacity-60 motion-safe:animate-[pulse-ring_1.8s_cubic-bezier(0.2,0,0,1)_infinite]',
            dotTone[tone],
          )}
        />
      )}
      <span className={cn('relative h-2 w-2 rounded-full', dotTone[tone])} />
    </span>
  )
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-0 border-t border-[var(--ds-border-subtle)]', className)} />
}
