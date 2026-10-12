import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'
import { useDismissable, useFocusTrap, useMediaQuery } from '@/lib/hooks'

/* ===========================================================================
   DIALOG — UI Bible spec.

   A panel in the middle of the screen, over a scrim. It stops everything, so
   it is for the short task the page behind makes no sense without: choosing
   the song before there is a song to show. Anything read beside the workspace,
   or changed while watching it land, is a Drawer.

   Widths are the Bible's: sm 24rem (a decision) · md 32rem (the default: a
   short form) · lg 44rem (content) · xl 60rem (a picker that needs the room).
   No taller than 44rem, and past that the body scrolls while the header and
   footer stay put. On a phone it fills the screen: a centered panel there has
   no margins to spare.
   ======================================================================== */

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl'

const widths: Record<DialogSize, string> = {
  sm: 'max-w-[24rem]',
  md: 'max-w-[32rem]',
  lg: 'max-w-[44rem]',
  xl: 'max-w-[60rem]',
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  tall,
  flush,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  size?: DialogSize
  /**
   * Holds its full height whatever is in it, so a list that changes length
   * does not resize the panel under the pointer.
   */
  tall?: boolean
  /** The body lays itself out and scrolls its own regions: no padding here. */
  flush?: boolean
}) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const isNarrow = useMediaQuery('(max-width: 39.999rem)')
  const titleId = React.useId()
  const descriptionId = React.useId()

  useDismissable(open, onClose, [panelRef])
  useFocusTrap(open, panelRef)

  // Focus moves into the panel on open and goes back where it was on close,
  // and the page behind stops scrolling. The panel takes the focus rather than
  // its first field: on a touch screen a focused field brings up the keyboard
  // over the thing that was just opened.
  React.useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className={cn('fixed inset-0 z-50 grid place-items-center', !isNarrow && 'p-6')}
      role="presentation"
    >
      {/* Dimmed and a little out of focus: the page reads as paused, not gone. */}
      <div
        className="absolute inset-0 bg-[var(--ds-layer-scrim)] backdrop-blur-[2px] motion-safe:animate-[fade-in_160ms_cubic-bezier(0.2,0,0,1)_both]"
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex w-full flex-col overflow-hidden bg-[var(--ds-surface-overlay)] shadow-e5 outline-none',
          'motion-safe:animate-[scale-in_200ms_cubic-bezier(0.32,0.72,0,1)_both]',
          isNarrow
            ? 'h-dvh'
            : cn(
                'rounded-[var(--radius-2xl)] border border-[var(--ds-border)]',
                widths[size],
                tall ? 'h-[min(44rem,calc(100dvh-3rem))]' : 'max-h-[min(44rem,calc(100dvh-3rem))]',
              ),
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--ds-border-subtle)] px-6 pt-5 pb-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id={titleId} className="text-h3 text-[var(--ds-fg)]">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="text-body-sm text-[var(--ds-fg-muted)]">
                {description}
              </p>
            )}
          </div>
          <IconButton label="Close" icon={<X />} size="sm" onClick={onClose} />
        </header>

        <div
          className={cn('min-h-0 flex-1', flush ? 'flex flex-col' : 'overflow-y-auto px-6 py-5')}
        >
          {children}
        </div>

        {footer && (
          <footer className="flex items-center justify-end gap-2.5 coarse:gap-3 border-t border-[var(--ds-border-subtle)] px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
