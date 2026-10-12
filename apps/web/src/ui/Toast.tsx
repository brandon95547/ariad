import * as React from 'react'
import { CheckCircle2, Info, X, XCircle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'

/* ===========================================================================
   TOAST — UI Bible spec.

   The system saying that something finished: "Campaign scheduled", "Could not
   save". It comes, is read, and goes — so it never holds the only copy of
   anything: no key, no reference to copy down, nothing a decision hangs on.
   What has to stay is a Banner, or a toast given `duration: Infinity`.

   Bottom right, 20px in: out of the reading path and away from the page's own
   action. On a phone it runs the width of the screen, above the home
   indicator.

   It stays 4 seconds plus the time it takes to read — 18 characters a second
   — and never more than 9. The clock stops while the pointer or the focus is
   on the stack, because a notice that leaves while it is being read was not
   delivered. Four at most: a fifth pushes the oldest out, it is not queued.

   A toast never takes the focus. It is announced — errors at once, the rest
   at the next pause — from two regions that are in the page from the start,
   because a live region added together with its message is often not read.

       toast.success('Campaign scheduled')
       toast.error('Could not save', { description: 'The server did not answer.' })
       toast.info('List archived', { action: { label: 'Undo', onClick: restore } })
   ======================================================================== */

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastOptions {
  /** One more line under the message. */
  description?: string
  /** Exactly one, said as a verb: Undo, View. Choosing it closes the toast. */
  action?: { label: string; onClick: () => void }
  /** Milliseconds. Worked out from the length of the text when left out; `Infinity` waits to be dismissed. */
  duration?: number
}

interface ToastItem extends ToastOptions {
  id: string
  tone: ToastTone
  message: string
}

const MAX_VISIBLE = 4

interface ToastState {
  items: readonly ToastItem[]
  /** The last of each kind to arrive: what the two live regions say. */
  calm: ToastItem | null
  urgent: ToastItem | null
}

let state: ToastState = { items: [], calm: null, urgent: null }
let sequence = 0
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshot = () => state

function show(tone: ToastTone, message: string, options: ToastOptions = {}): string {
  sequence += 1
  const item: ToastItem = { ...options, id: `toast-${sequence}`, tone, message }
  state = {
    items: [...state.items.slice(-(MAX_VISIBLE - 1)), item],
    calm: tone === 'error' ? state.calm : item,
    urgent: tone === 'error' ? item : state.urgent,
  }
  emit()
  return item.id
}

function dismiss(id: string) {
  if (!state.items.some((item) => item.id === id)) return
  const items = state.items.filter((item) => item.id !== id)
  // Only an arrival is said. One leaving changes nothing a screen reader
  // hears, and the last one leaving empties what it could still walk into.
  state = items.length > 0 ? { ...state, items } : { items, calm: null, urgent: null }
  emit()
}

/** Each returns the toast's id, for `toast.dismiss`. */
export const toast = {
  success: (message: string, options?: ToastOptions) => show('success', message, options),
  error: (message: string, options?: ToastOptions) => show('error', message, options),
  info: (message: string, options?: ToastOptions) => show('info', message, options),
  dismiss,
}

/** Four seconds, and the time to read it at about 18 characters a second, to a ceiling of nine. */
function lifetime(item: ToastItem) {
  if (item.duration !== undefined) return item.duration > 0 ? item.duration : Infinity
  const characters = item.message.length + (item.description?.length ?? 0)
  return Math.min(9000, 4000 + (characters / 18) * 1000)
}

const toneIcon: Record<ToastTone, LucideIcon> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
}

const toneInk: Record<ToastTone, string> = {
  success: 'text-[var(--ds-success-text)]',
  error: 'text-[var(--ds-danger-text)]',
  info: 'text-[var(--ds-info-text)]',
}

function ToastCard({ item, paused }: { item: ToastItem; paused: boolean }) {
  const remaining = React.useRef(lifetime(item))

  React.useEffect(() => {
    if (paused || !Number.isFinite(remaining.current)) return
    const started = Date.now()
    const timer = window.setTimeout(() => dismiss(item.id), remaining.current)
    return () => {
      window.clearTimeout(timer)
      // Picked up where it stopped, with at least a second left: one that
      // vanished the moment the pointer moved off it would feel snatched.
      remaining.current = Math.max(1000, remaining.current - (Date.now() - started))
    }
  }, [paused, item.id])

  const Icon = toneIcon[item.tone]
  return (
    <li
      className={cn(
        'pointer-events-auto flex w-full gap-3 rounded-[var(--radius-lg)] border border-[var(--ds-border)] bg-[var(--ds-surface-overlay)] p-3.5 shadow-e4 sm:w-[24rem]',
        'motion-safe:animate-[slide-up_220ms_cubic-bezier(0.32,0.72,0,1)_both]',
      )}
    >
      <span className={cn('mt-px shrink-0', toneInk[item.tone])} aria-hidden>
        <Icon size={17} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-label text-[var(--ds-fg)]">{item.message}</p>
        {item.description && (
          <p className="text-caption text-[var(--ds-fg-secondary)]">{item.description}</p>
        )}
        {item.action && (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick()
              dismiss(item.id)
            }}
            className={cn(
              'touch-target mt-1 self-start rounded-[var(--radius-xs)] text-label text-[var(--ds-accent-text)] underline-offset-4',
              // Underlined under the pointer and the focus, so it is not a
              // link by color alone.
              'hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
            )}
          >
            {item.action.label}
          </button>
        )}
      </div>
      <IconButton
        label="Dismiss notification"
        icon={<X />}
        size="xs"
        onClick={() => dismiss(item.id)}
        className="-mt-1 -mr-1 shrink-0"
      />
    </li>
  )
}

/**
 * The stack. Mount it once, at the root of the app, outside anything that
 * unmounts with a page: it has to be there before the first toast is.
 */
export function Toaster() {
  const { items, calm, urgent } = React.useSyncExternalStore(subscribe, snapshot, snapshot)
  const regionRef = React.useRef<HTMLElement>(null)
  const [hovered, setHovered] = React.useState(false)
  const [focused, setFocused] = React.useState(false)

  // With nothing left in it the stack is not under anything.
  React.useEffect(() => {
    if (items.length > 0) return
    setHovered(false)
    setFocused(false)
  }, [items.length])

  // A dialog closes on a press anywhere outside itself, and a toast is
  // outside it: dismissing "Could not save" would close the form it is about.
  // The window hears a press before the document does, so a press on a toast
  // stops here and no overlay under it takes it for a press outside. Clicks
  // are another event and still reach the buttons.
  React.useEffect(() => {
    const guard = (event: PointerEvent) => {
      if (regionRef.current?.contains(event.target as Node)) event.stopPropagation()
    }
    window.addEventListener('pointerdown', guard, true)
    return () => window.removeEventListener('pointerdown', guard, true)
  }, [])

  // Keyed, so the same words twice running are a new announcement and not an
  // unchanged region.
  const say = (item: ToastItem | null) =>
    item ? (
      <span key={item.id}>
        {item.message}
        {item.description ? `. ${item.description}` : ''}
      </span>
    ) : null

  return (
    <section
      ref={regionRef}
      aria-label="Notifications"
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex flex-col items-stretch p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        'sm:left-auto sm:items-end sm:p-5',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
      onKeyDown={(event) => {
        // Escape takes the newest away, while the focus is in the stack.
        const newest = items[items.length - 1]
        if (event.key === 'Escape' && newest) {
          event.stopPropagation()
          dismiss(newest.id)
        }
      }}
    >
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only-ds">
        {say(calm)}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only-ds">
        {say(urgent)}
      </div>
      {/* The stack never blocks the page: only the toasts take the pointer. */}
      <ol className="flex flex-col gap-2.5">
        {items.map((item) => (
          <ToastCard key={item.id} item={item} paused={hovered || focused} />
        ))}
      </ol>
    </section>
  )
}
