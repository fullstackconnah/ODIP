import { useEffect, useState, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { Card } from '@/components/Card'
import { ConfirmDialog } from '@/components/ConfirmDialog'

/**
 * PD-6/PD-7 shared chrome for section-level "edit this card in place" panels (see SPEC-03's PD-7
 * Implementation §2 — PD-6 lands this component first since it lands before PD-7 on the dependency
 * order, and PD-7 reuses it unchanged for its own 11 Details-tab sections).
 *
 * This component owns ONLY the shared chrome — the Edit button, the Save/Cancel footer, in-flight/
 * error state, and a dirty guard on Cancel — never the field JSX or the save/cancel network calls
 * themselves. A caller supplies:
 * - `onEditStart`: seed the caller's own local draft state from the current read values.
 * - `onCancel`: revert that draft state back to the read values (called after a confirmed, or
 *   no-op if not dirty, Cancel).
 * - `onSave`: perform the mutation. Resolving ends edit mode; a thrown Error's `.message` (or the
 *   fallback below) is shown in an inline banner and edit mode stays open with the caller's draft
 *   state untouched — losing typed input on a failed save is exactly what this guards against.
 * - `children(editing)`: render-prop — read-only fields when `editing` is false, input controls
 *   bound to the caller's own draft state when true.
 */
export type SectionEditPanelProps = {
  title?: string
  className?: string
  /** Whether the Edit button renders at all — gated by the caller's own permission boolean. */
  canEdit: boolean
  /** True once the in-edit draft differs from the last-saved values — drives the Cancel confirm guard. */
  isDirty: boolean
  onEditStart: () => void
  onCancel: () => void
  onSave: () => Promise<void>
  children: (editing: boolean) => ReactNode
}

export function SectionEditPanel({ title, className, canEdit, isDirty, onEditStart, onCancel, onSave, children }: SectionEditPanelProps) {
  const [editing, setEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 3000)
    return () => clearTimeout(timer)
  }, [saved])

  function handleEdit() {
    setError(null)
    setSaved(false)
    onEditStart()
    setEditing(true)
  }

  function discardAndClose() {
    setError(null)
    onCancel()
    setEditing(false)
    setConfirmDiscard(false)
  }

  function handleCancel() {
    if (isDirty) {
      setConfirmDiscard(true)
    } else {
      discardAndClose()
    }
  }

  async function handleSave() {
    setError(null)
    setIsSaving(true)
    try {
      await onSave()
      setEditing(false)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card
      title={title}
      className={className}
      action={
        canEdit && !editing ? (
          <button
            type="button"
            onClick={handleEdit}
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1.5 min-h-[44px] rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        ) : undefined
      }
    >
      {error && (
        <div role="alert" className="mb-4 p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          {error}
        </div>
      )}

      {saved && (
        <div role="status" className="mb-4 p-3 rounded-lg bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)] text-sm border border-[var(--color-on-primary-fixed)]/20">
          Saved.
        </div>
      )}

      {children(editing)}

      {editing && (
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-4">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSaving}
            className="min-h-[44px] px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="min-h-[44px] px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDiscard}
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={discardAndClose}
        title="Discard changes?"
        message="You have unsaved changes in this section. Discard them?"
        confirmLabel="Discard"
        variant="danger"
      />
    </Card>
  )
}
