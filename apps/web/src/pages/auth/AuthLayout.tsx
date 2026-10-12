import type { ReactNode } from 'react'
import { Brand } from '@/components/Brand'

/**
 * The frame for the two pages that come before the app: first-run setup and
 * sign-in. One narrow column, the brand above it, nothing else to look at.
 */
export function AuthLayout({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="app-ambient flex min-h-dvh flex-col items-center px-6 py-10 sm:justify-center sm:py-16">
      <main className="relative z-10 flex w-full max-w-[24rem] flex-col gap-8">
        <Brand />
        <div className="flex flex-col gap-2">
          <h1 className="text-h2 text-[var(--ds-fg)]">{title}</h1>
          {description && <p className="text-body-sm text-[var(--ds-fg-muted)]">{description}</p>}
        </div>
        {children}
        {footer && <p className="text-caption text-[var(--ds-fg-muted)]">{footer}</p>}
      </main>
    </div>
  )
}
