import { cn } from '@/lib/cn'

/** The mark: an envelope in the accent color. Drawn inline so it follows the theme. */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={cn('shrink-0', className)}>
      <rect width="32" height="32" rx="8" fill="var(--ds-accent)" />
      <rect x="7" y="9" width="18" height="14" rx="2.5" fill="none" stroke="var(--ds-accent-fg)" strokeWidth="2.2" />
      <path d="M7.5 11.5 16 17.6l8.5-6.1" fill="none" stroke="var(--ds-accent-fg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <BrandMark />
      <span className="text-h4 text-[var(--ds-fg)]">Ariad</span>
    </span>
  )
}
