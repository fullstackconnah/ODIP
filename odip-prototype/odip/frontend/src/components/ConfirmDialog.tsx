import { Modal } from './Modal'

export type ConfirmDialogProps = {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  title: string
  message: string
  confirmLabel?: string
  variant?: 'default' | 'danger'
  loading?: boolean
}

export function ConfirmDialog({
  open, onConfirm, onCancel, title, message,
  confirmLabel = 'Confirm', variant = 'default', loading,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50 ${
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/90'
            }`}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-[var(--color-muted-foreground)]">{message}</p>
    </Modal>
  )
}
