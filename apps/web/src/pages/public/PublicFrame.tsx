import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Skeleton } from '@/ui/Feedback'
import { Card } from '@/ui/Surface'

/** True when the page is inside someone else's: the signup form as an iframe embed. */
export const isEmbedded = (() => {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
})()

/**
 * Subscriber pages are light, whatever the admin app is: they are opened from
 * an inbox, by someone who has never seen Ariad. The theme goes on the root
 * element so the tokens do the rest, and comes off again on the way out.
 *
 * Embedded, the page's own background is taken away as well: an iframe is a
 * rectangle on someone else's page, and only the card should show in it.
 */
export function useLightTheme(embedded: boolean) {
  useLayoutEffect(() => {
    const root = document.documentElement
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const colorScheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
    const before = {
      theme: root.dataset.theme,
      themeColor: themeColor?.content,
      colorScheme: colorScheme?.content,
      background: document.body.style.backgroundColor,
    }

    root.dataset.theme = 'light'
    const backdrop = getComputedStyle(root).getPropertyValue('--ds-sunken').trim()
    if (themeColor && backdrop) themeColor.content = backdrop
    if (colorScheme) colorScheme.content = 'light'
    if (embedded) document.body.style.backgroundColor = 'transparent'

    return () => {
      root.dataset.theme = before.theme ?? 'dark'
      if (themeColor && before.themeColor !== undefined) themeColor.content = before.themeColor
      if (colorScheme && before.colorScheme !== undefined) colorScheme.content = before.colorScheme
      document.body.style.backgroundColor = before.background
    }
  }, [embedded])
}

/** The tab says whose page this is, and goes back to the app's own title on the way out. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const before = document.title
    document.title = title
    return () => {
      document.title = before
    }
  }, [title])
}

/**
 * The frame every subscriber page sits in: one narrow column, the
 * organization's name over a single card, and a small credit under it.
 */
export function PublicFrame({
  organization,
  mode = 'page',
  children,
}: {
  /** Whose page this is. Left out while it is not known yet. */
  organization?: string
  /**
   * `page` fills the window. `embedded` is the same card with nothing around
   * it, for an iframe. `preview` is the page at whatever size it is given: the
   * picture of it beside a form's settings.
   */
  mode?: 'page' | 'embedded' | 'preview'
  children: ReactNode
}) {
  const Column = mode === 'preview' ? 'div' : 'main'
  return (
    <div
      className={cn(
        'flex flex-col items-center text-[var(--ds-fg)]',
        mode === 'embedded' && 'p-1',
        mode === 'page' && 'min-h-dvh bg-[var(--ds-sunken)] px-4 py-8 sm:justify-center sm:py-16',
        mode === 'preview' && 'bg-[var(--ds-sunken)] px-4 py-6',
      )}
    >
      <Column className="flex w-full max-w-[28rem] flex-col gap-4">
        {mode !== 'embedded' && organization && <p className="px-1 text-h4 text-[var(--ds-fg)] [overflow-wrap:anywhere]">{organization}</p>}
        <Card padding="none" className="p-6 sm:p-8">
          {children}
        </Card>
        <p className="px-1 text-caption text-[var(--ds-fg-muted)]">Sent with Ariad</p>
      </Column>
    </div>
  )
}

/** A page's heading and the sentence under it. */
export function PublicHeading({
  title,
  children,
  focusOnMount,
  level = 1,
}: {
  title: string
  children?: ReactNode
  focusOnMount?: boolean
  level?: 1 | 2
}) {
  const ref = useRef<HTMLHeadingElement>(null)
  const Heading = level === 1 ? 'h1' : 'h2'
  // After an action replaces the page's content, the new heading is where a
  // screen reader should be: otherwise the result is announced to nobody.
  useEffect(() => {
    if (focusOnMount) ref.current?.focus()
  }, [focusOnMount])
  return (
    <div className="flex flex-col gap-2">
      <Heading ref={ref} tabIndex={-1} className="text-balance-ds text-h2 text-[var(--ds-fg)] outline-none [overflow-wrap:anywhere]">
        {title}
      </Heading>
      {children && <div className="flex flex-col gap-2 text-body text-[var(--ds-fg-secondary)] [overflow-wrap:anywhere]">{children}</div>}
    </div>
  )
}

/** The mark over a result: done, sent, or could not be done. */
export function ResultMark({ tone, children }: { tone: 'success' | 'info' | 'danger' | 'neutral'; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid h-11 w-11 shrink-0 place-items-center rounded-full',
        tone === 'success' && 'bg-[var(--ds-success-subtle)] text-[var(--ds-success-text)]',
        tone === 'info' && 'bg-[var(--ds-info-subtle)] text-[var(--ds-info-text)]',
        tone === 'danger' && 'bg-[var(--ds-danger-subtle)] text-[var(--ds-danger-text)]',
        tone === 'neutral' && 'bg-[var(--ds-layer-active)] text-[var(--ds-fg-secondary)]',
      )}
    >
      {children}
    </span>
  )
}

/** What a public page shows while it asks the server who the link belongs to. */
export function PublicLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="mt-2 h-11 w-full rounded-[var(--radius-lg)]" />
      <span className="sr-only-ds" role="status">
        Loading
      </span>
    </div>
  )
}

/** A link in the page's own ink, for the quiet way out: preferences, unsubscribe. */
export const publicLinkClass =
  'touch-target inline-flex rounded-[var(--radius-xs)] text-body-sm font-medium text-[var(--ds-accent-text)] underline underline-offset-2 hover:text-[var(--ds-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]'
