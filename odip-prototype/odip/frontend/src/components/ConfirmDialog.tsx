import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from '@/components/Button'

export type ConfirmDialogProps = {
  open: boolean
  onConfirm?: () => void
  onCancel: () => void
  title: string
  message: ReactNode
  confirmLabel?: string
  /** Label for the default dismiss button. Ignored when `footer` is provided. */
  cancelLabel?: string
  variant?: 'default' | 'danger'
  loading?: boolean
  /** Accessible name for the confirm button (overrides the visible label for screen readers). */
  confirmAriaLabel?: string
  /**
   * Overrides the default Cancel/Confirm footer entirely — for flows that offer more than
   * one destructive choice (e.g. "Cancel record" vs "Delete permanently"). When provided,
   * `onConfirm`/`confirmLabel`/`variant`/`loading` are ignored; the caller's buttons must
   * call their own mutations and close the dialog.
   */
  footer?: ReactNode
}

export function ConfirmDialog({
  open, onConfirm, onCancel, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'default', loading, footer, confirmAriaLabel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      role="alertdialog"
      footer={
        footer ?? (
          <>
            <Button variant="secondary" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button
              variant={variant === 'danger' ? 'danger' : 'primary'}
              onClick={onConfirm}
              disabled={loading}
              aria-label={confirmAriaLabel ?? confirmLabel}
            >
              {loading ? 'Processing...' : confirmLabel}
            </Button>
          </>
        )
      }
    >
      <div className="text-sm text-[var(--color-muted-foreground)] space-y-2">{message}</div>
    </Modal>
  )
}
