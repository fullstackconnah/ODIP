import { useRef, type ReactNode } from 'react'
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
  /** Holds the confirm button without the "Processing..." label: the caller is still checking what confirming would do. */
  confirmDisabled?: boolean
  /** Accessible name for the confirm button (overrides the visible label for screen readers). */
  confirmAriaLabel?: string
  /**
   * Overrides the default Cancel/Confirm footer entirely — for flows that offer more than
   * one destructive choice (e.g. "Cancel record" vs "Delete permanently"). When provided,
   * `onConfirm`/`confirmLabel`/`variant`/`loading` are ignored; the caller's buttons must
   * call their own mutations and close the dialog.
   */
  footer?: ReactNode
  /** Focus the default cancel button on open, so Enter and Space choose the safe answer (unsaved-changes prompts). Ignored with a custom `footer`. */
  focusCancel?: boolean
  /** Below `sm` the buttons stack full width with the confirm first; from `sm` up they sit side by side as ever. */
  stacked?: boolean
}

export function ConfirmDialog({
  open, onConfirm, onCancel, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'default', loading, confirmDisabled, footer, confirmAriaLabel, focusCancel, stacked,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Modal
      initialFocusRef={focusCancel ? cancelRef : undefined}
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      role="alertdialog"
      footer={
        footer ?? (
          <div className={stacked ? 'flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:gap-3 [&>button]:w-full sm:[&>button]:w-auto' : 'contents'}>
            <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button
              variant={variant === 'danger' ? 'danger' : 'primary'}
              onClick={onConfirm}
              disabled={loading || confirmDisabled}
              aria-label={confirmAriaLabel ?? confirmLabel}
            >
              {loading ? 'Processing...' : confirmLabel}
            </Button>
          </div>
        )
      }
    >
      <div className="text-sm text-[var(--color-muted-foreground)] space-y-2">{message}</div>
    </Modal>
  )
}
