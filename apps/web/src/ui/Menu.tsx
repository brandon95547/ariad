import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useDismissable } from '@/lib/hooks'
import { IconButton } from './Button'

/**
 * Floating panels: a popover, and the menu of commands built on it.
 *
 * The bar's overflow is a button that opens a list, and that only works if
 * opening it is as dependable as a native control: from the keyboard, back to
 * the trigger on close, and never clipped.
 *
 * Positioned `fixed`, from the trigger's own rectangle, rather than absolutely
 * inside it. A panel inside the bar is at the mercy of whatever the bar sits in
 * — any overflow on the way up cuts it off, and the menu opens with half of it
 * missing. A fixed panel is outside every overflow, and it is clamped to the
 * viewport so a trigger near the right edge still opens a menu that fits.
 */

const GAP = 6
const EDGE = 8

interface Position {
  top: number
  left: number
  maxHeight: number
}

/** Where a panel of this size goes under this trigger, kept on screen. */
function place(anchor: DOMRect, panel: { width: number }, align: 'start' | 'end'): Position {
  const viewportWidth = globalThis.innerWidth || 1024
  const viewportHeight = globalThis.innerHeight || 768
  const ideal = align === 'end' ? anchor.right - panel.width : anchor.left
  const left = Math.min(Math.max(EDGE, ideal), Math.max(EDGE, viewportWidth - panel.width - EDGE))
  const top = anchor.bottom + GAP
  return { top, left, maxHeight: Math.max(160, viewportHeight - top - EDGE) }
}

export function Popover({
  open,
  onClose,
  anchorRef,
  align = 'start',
  label,
  role = 'dialog',
  className,
  children,
}: {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
  align?: 'start' | 'end'
  /** The panel's accessible name. */
  label: string
  role?: 'dialog' | 'menu'
  className?: string
  children: React.ReactNode
}) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [position, setPosition] = React.useState<Position | null>(null)

  // Escape and a click anywhere else both close it. The trigger counts as
  // inside, so clicking it again is a toggle rather than a close-and-reopen.
  const dismiss = React.useCallback(() => {
    // Focus goes back to the trigger only if it was in the panel: a click
    // somewhere else on the page has already put it where the player meant.
    if (panelRef.current?.contains(document.activeElement)) anchorRef.current?.focus()
    onClose()
  }, [anchorRef, onClose])
  useDismissable(open, dismiss, [panelRef, anchorRef])

  React.useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const measure = () => {
      const anchor = anchorRef.current?.getBoundingClientRect()
      const panel = panelRef.current?.getBoundingClientRect()
      if (anchor) setPosition(place(anchor, { width: panel?.width ?? 240 }, align))
    }
    measure()
    // A resize moves the trigger out from under the panel, and a panel left
    // floating over the wrong control is worse than one that closes.
    const close = () => onClose()
    globalThis.addEventListener?.('resize', close)
    return () => globalThis.removeEventListener?.('resize', close)
  }, [open, align, anchorRef, onClose])

  // Into the panel on open: to the chosen item if there is one, so the arrow
  // keys start from where the player already is. Once it has been placed, not
  // before — the panel is `visibility: hidden` while it measures itself, and
  // nothing inside a hidden element can take focus.
  const placed = position !== null
  React.useEffect(() => {
    if (!open || !placed) return
    const panel = panelRef.current
    const first =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>('[aria-checked="true"]:not([disabled])') ??
      panel?.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]')
    first?.focus()
  }, [open, placed])

  if (!open) return null

  return (
    <div
      ref={panelRef}
      role={role}
      aria-label={label}
      className={cn('popover', className)}
      style={
        position
          ? { top: position.top, left: position.left, maxHeight: position.maxHeight }
          : { visibility: 'hidden', top: 0, left: 0 }
      }
      onKeyDown={(event) => {
        // Tab out of a popover means the player has moved on. Leaving it open
        // behind them strands a panel over the controls they are heading for.
        if (event.key === 'Tab') onClose()
      }}
    >
      {children}
    </div>
  )
}

export interface MenuAction {
  readonly id: string
  readonly label: string
  readonly icon?: React.ReactNode
  readonly onSelect: () => void
  readonly disabled?: boolean
  /** Where you are, for a menu that also navigates: checked, and announced so. */
  readonly checked?: boolean
  /** Shown after the label — the lock on a place that is not open yet. */
  readonly trail?: React.ReactNode
  /** Said on hover — why a disabled item is disabled. */
  readonly title?: string
  /** A hairline before this item, starting a new group. */
  readonly separated?: boolean
  /** Cannot be undone. Set in the danger color, and last in the menu. */
  readonly danger?: boolean
  readonly className?: string
}

/**
 * A button that opens a list of commands — the bar's overflow.
 *
 * Arrow keys move, Home and End jump, Enter and Space choose, Escape leaves
 * with nothing done. An item is a `menuitem`, or a `menuitemradio` where it
 * says where you are. The command runs after the menu has closed and focus has gone back to the trigger, so a
 * command that opens a panel takes focus from there rather than from a menu
 * that is being torn down under it.
 */
export function ActionMenu({
  label,
  icon,
  actions,
  className,
}: {
  label: string
  icon: React.ReactNode
  actions: readonly MenuAction[]
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const menuId = React.useId()
  const close = React.useCallback(() => setOpen(false), [])

  const run = (action: MenuAction) => {
    setOpen(false)
    triggerRef.current?.focus()
    action.onSelect()
  }

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"], [role="menuitemradio"]',
      ),
      // An item the stylesheet folds away at this width is not there to move to.
    ].filter((item) => !item.disabled && getComputedStyle(item).display !== 'none')
    if (items.length === 0) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const move = (to: number) => {
      event.preventDefault()
      items[(to + items.length) % items.length]?.focus()
    }
    if (event.key === 'ArrowDown') move(index + 1)
    else if (event.key === 'ArrowUp') move(index - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(items.length - 1)
  }

  return (
    <>
      <IconButton
        ref={triggerRef}
        size="sm"
        label={label}
        icon={icon}
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      />
      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        align="end"
        label={label}
        role="menu"
        className="popover--menu"
      >
        <div id={menuId} onKeyDown={onMenuKeyDown}>
          {actions.map((action) => (
            <React.Fragment key={action.id}>
              {action.separated && (
                <div role="separator" className={cn('menu-separator', action.className)} />
              )}
              <button
                type="button"
                role={action.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={action.checked}
                tabIndex={-1}
                disabled={action.disabled}
                title={action.title}
                className={cn('menu-item', action.danger && 'menu-item--danger', action.className)}
                onClick={() => run(action)}
              >
                <span className="menu-item__mark" aria-hidden>
                  {action.icon}
                </span>
                <span className="menu-item__text">
                  <span className="menu-item__label">{action.label}</span>
                </span>
                {(action.trail ?? action.checked) && (
                  <span className="menu-item__trail" aria-hidden>
                    {action.trail ?? <Check size={14} />}
                  </span>
                )}
              </button>
            </React.Fragment>
          ))}
        </div>
      </Popover>
    </>
  )
}
