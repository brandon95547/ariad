import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { useCoarsePointer } from '@/lib/hooks'

/* ===========================================================================
   TOOLTIP — UI Bible spec.

   A line that adds to a control that already has a name: what an icon button
   does in words, why a button is disabled. Never the only place something is
   said — if it is needed in order to act, it belongs on the screen.

   Inverted, so it is never taken for a menu or a panel that could be clicked
   into. 12px, two lines at most: three is a Popover.

   It waits 400ms, so a pointer crossing a toolbar sets nothing off, and once
   one has shown the next is immediate. The keyboard gets it too, on focus.
   Escape puts it away without moving the pointer, and the pointer can travel
   onto it without it vanishing — at high zoom a tooltip covers the control it
   describes, and those two are the only ways out (WCAG 1.4.13).

   Under a finger there is no hover, and a long press belongs to the platform:
   it is simply not shown there, which is the other reason it may never hold
   the only copy of anything.
   ======================================================================== */

const OPEN_DELAY = 400
/** How long the next tooltip stays immediate after one closes. */
const WARM_FOR = 300
/** Clear of the trigger's focus ring, and still plainly its own. */
const OFFSET_CLASS = { top: 'pb-1.5', bottom: 'pt-1.5' }
const EDGE = 8

let warmUntil = 0

interface Placement {
  top: number
  left: number
  side: 'top' | 'bottom'
}

export function Tooltip({
  content,
  children,
  side = 'top',
  delay = OPEN_DELAY,
}: {
  content: React.ReactNode
  /** One element — the control being described. It is given `aria-describedby`. */
  children: React.ReactElement
  /** Flips by itself where there is no room. */
  side?: 'top' | 'bottom'
  delay?: number
}) {
  const coarse = useCoarsePointer()
  const [open, setOpen] = React.useState(false)
  const [placement, setPlacement] = React.useState<Placement | null>(null)
  const hostRef = React.useRef<HTMLSpanElement>(null)
  const tipRef = React.useRef<HTMLSpanElement>(null)
  const timer = React.useRef<number | undefined>(undefined)
  // Set when it is dismissed, so it does not come straight back under a
  // pointer that never moved. Cleared when the pointer or the focus leaves.
  const suppressed = React.useRef(false)
  const id = React.useId()

  const hide = React.useCallback(() => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }, [])

  const show = (wait: number) => {
    if (suppressed.current) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), wait)
  }

  React.useEffect(() => () => window.clearTimeout(timer.current), [])

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // The innermost layer takes the Escape: a tooltip open inside a dialog
      // closes, and the dialog stays.
      event.stopPropagation()
      suppressed.current = true
      hide()
    }
    // A press on the tooltip itself is not a press outside whatever overlay
    // its trigger is in. The window hears it before the document does.
    const onPointerDown = (event: PointerEvent) => {
      if (tipRef.current?.contains(event.target as Node)) event.stopPropagation()
    }
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    // It is placed once, from where the trigger was. When that moves, it goes.
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      warmUntil = Date.now() + WARM_FOR
    }
  }, [open, hide])

  React.useLayoutEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }
    const host = hostRef.current
    const tip = tipRef.current
    if (!host || !tip) return
    const anchor = host.getBoundingClientRect()
    const size = tip.getBoundingClientRect()
    const viewportWidth = window.innerWidth || 1024
    const viewportHeight = window.innerHeight || 768
    const above = anchor.top
    const below = viewportHeight - anchor.bottom
    let placed = side
    if (side === 'top' && above < size.height + EDGE && below > above) placed = 'bottom'
    if (side === 'bottom' && below < size.height + EDGE && above > below) placed = 'top'
    const centered = anchor.left + anchor.width / 2 - size.width / 2
    setPlacement({
      side: placed,
      top: placed === 'top' ? anchor.top - size.height : anchor.bottom,
      left: Math.min(Math.max(EDGE, centered), Math.max(EDGE, viewportWidth - size.width - EDGE)),
    })
  }, [open, side, content])

  const child = children as React.ReactElement<{ 'aria-describedby'?: string }>
  const described = [child.props['aria-describedby'], open ? id : undefined]
    .filter(Boolean)
    .join(' ')

  // The same wrapper either way, so a layout does not depend on the pointer.
  if (coarse || !content) return <span className="inline-flex">{children}</span>

  return (
    <span
      ref={hostRef}
      className="inline-flex"
      onMouseEnter={() => show(Date.now() < warmUntil ? 0 : delay)}
      onMouseLeave={() => {
        suppressed.current = false
        hide()
      }}
      onFocus={(event) => {
        // From the keyboard only: the focus a click leaves behind is not a
        // request to be told what the button does.
        let keyboard = true
        try {
          keyboard = event.target.matches(':focus-visible')
        } catch {
          // No :focus-visible to ask: show it, which is the safe side.
        }
        if (keyboard) show(0)
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        suppressed.current = false
        hide()
      }}
      onPointerDown={(event) => {
        // Pressed: the question it answers has been answered.
        if (!event.currentTarget.contains(event.target as Node)) return
        suppressed.current = true
        hide()
      }}
    >
      {React.cloneElement(child, { 'aria-describedby': described || undefined })}
      {open &&
        // Out of the page's flow and its clipping: a tooltip on a button in a
        // table or a dialog is not cut off by what scrolls around it. It is
        // still a child here as far as the pointer is concerned, which is what
        // lets the pointer move onto it.
        createPortal(
          <span
            ref={tipRef}
            id={id}
            role="tooltip"
            className={cn(
              'fixed z-[80] max-w-[calc(100vw-1rem)]',
              OFFSET_CLASS[placement?.side ?? side],
            )}
            style={
              placement
                ? { top: placement.top, left: placement.left }
                : { top: 0, left: 0, visibility: 'hidden' }
            }
          >
            <span className="block max-w-[16rem] rounded-[var(--radius-md)] bg-[var(--ds-fg)] px-2.5 py-1.5 text-caption leading-[1.4] text-[var(--ds-fg-inverse)] shadow-e3 motion-safe:animate-[fade-in_120ms_ease-out_both]">
              {content}
            </span>
          </span>,
          document.body,
        )}
    </span>
  )
}
