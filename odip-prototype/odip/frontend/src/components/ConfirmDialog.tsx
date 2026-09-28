import type { ReactNode } from 'react'
import { Modal } from './Modal'

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
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)]"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              aria-label={confirmAriaLabel ?? confirmLabel}
              className={`px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50 ${
                variant === 'danger'
                  ? 'bg-[var(--color-destructive)] hover:opacity-90'
                  : 'bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/90'
              }`}
            >
              {loading ? 'Processing...' : confirmLabel}
            </button>
          </>
        )
      }
    >
      <div className="text-sm text-[var(--color-muted-foreground)] space-y-2">{message}</div>
    </Modal>
  )
}
