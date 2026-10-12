import * as React from 'react'

/**
 * True when the primary input is a finger.
 *
 * Keyed to the pointer, never to the viewport: a 1180px tablet is touch and a
 * 700px browser window is not, so width is the wrong question — the UI Bible's
 * rule, and it decides how wide a key has to be to be playable.
 */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)')
}

export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Closes an overlay on Escape and on a click outside every given element. */
/** Everything the browser will put a focus ring on, in document order. */
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Keeps the Tab key inside an open dialog.
 *
 * `aria-modal` tells a screen reader that the rest of the page is inert. It
 * does nothing whatever to the Tab key, so without this a keyboard user tabs
 * straight out of the dialog and into the page behind the scrim — which is
 * still visible, still clickable, and gives no sign that focus has left. The
 * trap is what makes `aria-modal` true rather than merely announced.
 *
 * Wrapping rather than blocking: Tab off the last control returns to the first,
 * which is what every native dialog does and what a screen-reader user is
 * listening for to know they have reached the end.
 */
export function useFocusTrap(open: boolean, ref: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const panel = ref.current
      if (!panel) return

      // Filtered on attributes rather than on layout. `offsetParent` is the
      // usual "is it visible" trick and it is wrong twice over here: it is null
      // for anything inside a fixed-position ancestor, which is every dialog,
      // and null for everything at all in a test environment that does no
      // layout. What actually has to be skipped is what the browser would not
      // focus anyway.
      const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) =>
          !element.hasAttribute('disabled') &&
          !element.closest('[hidden]') &&
          element.getAttribute('aria-hidden') !== 'true',
      )
      // A dialog with nothing to focus still must not leak: the panel itself
      // takes the focus and Tab does nothing.
      if (stops.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }

      const first = stops[0]!
      const last = stops[stops.length - 1]!
      const active = document.activeElement
      // From the panel itself, Shift+Tab goes to the end rather than out.
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, ref])
}

export function useDismissable(
  open: boolean,
  onDismiss: () => void,
  refs: readonly React.RefObject<HTMLElement | null>[],
) {
  React.useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (refs.some((ref) => ref.current?.contains(target))) return
      onDismiss()
    }

    document.addEventListener('keydown', onKeyDown)
    // Capture phase, so a click on a control that re-renders and unmounts its
    // own trigger still counts as "outside".
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onDismiss])
}
