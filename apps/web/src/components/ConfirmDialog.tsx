import type { ReactNode } from 'react'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'

/**
 * The second look before something that cannot be undone.
 *
 * The confirm button says what it does — "Remove account", never "OK" — and
 * is the only red on the screen. Cancel takes the focus's side of the footer
 * but not the red, so the safe choice is the one a stray Enter lands nearest.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel,
  danger = true,
  loading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  loading?: boolean
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'filled'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-body-sm text-[var(--ds-fg-secondary)]">{children}</div>
    </Dialog>
  )
}
