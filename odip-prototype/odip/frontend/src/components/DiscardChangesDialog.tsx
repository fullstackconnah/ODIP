import { ConfirmDialog } from './ConfirmDialog'

/** The "Discard changes?" prompt of SlideOver and Modal (their `dirty` prop): one wording and one pair of buttons, so both layers ask the same way. */
export function DiscardChangesDialog({ open, what, onKeep, onDiscard }: { open: boolean; what: 'panel' | 'dialog'; onKeep: () => void; onDiscard: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      onCancel={onKeep}
      onConfirm={onDiscard}
      title="Discard changes?"
      message={`You have unsaved changes. If you close this ${what} now, they will be lost.`}
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      variant="danger"
    />
  )
}
