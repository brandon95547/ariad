import { useEffect, useRef, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'

/**
 * Stops unsaved work being lost by a stray click.
 *
 * Two ways out of a page, two guards. Closing the tab or reloading is the
 * browser's to ask about, and it does, in its own words. Moving somewhere else
 * inside the app never reaches the browser, so that one is asked here — with
 * the choice the browser cannot offer, which is to save first.
 *
 * Only a change of page counts as leaving. An editor that keeps its tab in the
 * address (`?step=design`) is not being left when the tab changes.
 */
export function UnsavedGuard({
  dirty,
  onSave,
}: {
  dirty: boolean
  /** Saves, and says whether it worked. Without it the choice is stay or leave. */
  onSave?: () => Promise<boolean>
}) {
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
  )
  const blocked = blocker.state === 'blocked'

  const saveAndLeave = async () => {
    if (!onSave) return
    setSaving(true)
    const ok = await onSave()
    setSaving(false)
    // A failed save keeps them here, with the page's own message saying why.
    if (ok) blocker.proceed?.()
    else blocker.reset?.()
  }

  return (
    <Dialog
      open={blocked}
      onClose={() => blocker.reset?.()}
      title="Leave without saving?"
      size="sm"
      footer={
        <>
          <Button variant="text" onClick={() => blocker.reset?.()} disabled={saving}>
            Stay
          </Button>
          <Button
            variant={onSave ? 'danger-outline' : 'danger'}
            onClick={() => blocker.proceed?.()}
            disabled={saving}
          >
            Leave without saving
          </Button>
          {onSave && (
            <Button onClick={() => void saveAndLeave()} loading={saving}>
              Save and leave
            </Button>
          )}
        </>
      }
    >
      <p className="text-body-sm text-[var(--ds-fg-secondary)]">
        You have changes on this page that have not been saved. Leaving now loses them.
      </p>
    </Dialog>
  )
}
