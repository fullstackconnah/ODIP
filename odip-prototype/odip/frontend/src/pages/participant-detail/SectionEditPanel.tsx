import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Callout } from '@/components/Callout'
import type { ScalarGroupKey } from '@/api/types/participant-patch'
import { isSectionChanged, sectionChangedRevisions } from '@/lib/sectionConflict'
import { DirtyEditsContext } from './dirtyEdits'

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
 * - `groups` / `revisions`: the field groups this panel saves and the section revisions of the participant as last fetched. The revisions are
 *   snapshotted when edit starts and passed to `onSave` as the expected revisions. When the server refuses the save because someone else saved
 *   one of those groups first (a 409 `participant-section-changed`), the draft stays, the latest saved version shows beside it once the refetch
 *   lands, and Save then replaces it knowingly. The host must not re-seed its draft from the participant while editing.
 * - `children(editing, startEdit)`: render-prop — read-only fields when `editing` is false, input controls
 *   bound to the caller's own draft state when true. `startEdit('first-empty')` opens edit and focuses
 *   the first empty field (the "Add" link on a FactList foot line).
 */
type Revisions = Partial<Record<ScalarGroupKey, number>>

const REFUSED_TITLE = 'Someone else saved this section since you opened it.'
const REFUSED_BODY = 'Compare what you typed with Latest saved, then save to replace their version, or cancel to keep it.'
const LOADING = 'Loading the latest saved version…'
const LANDED = 'Latest saved version shown.'
const COLUMN_LABEL = 'mb-2 text-[13px] font-semibold text-[var(--color-muted-foreground)]'

/** The defined revisions for these groups only (a missing one, e.g. an older API, means no check for that group). */
function pick(revisions: Revisions | undefined, groups: readonly ScalarGroupKey[]): Revisions {
  const out: Revisions = {}
  for (const k of groups) if (revisions?.[k] !== undefined) out[k] = revisions[k]
  return out
}

export type SectionEditPanelProps = {
  title?: string
  className?: string
  /** Whether the Edit button renders at all — gated by the caller's own permission boolean. */
  canEdit: boolean
  /** True once the in-edit draft differs from the last-saved values — drives the Cancel confirm guard. */
  isDirty: boolean
  onEditStart: () => void
  onCancel: () => void
  onSave: (expected: Revisions) => Promise<void>
  groups?: readonly ScalarGroupKey[]
  revisions?: Revisions
  children: (editing: boolean, startEdit: (focus?: 'first-empty') => void) => ReactNode
}

export function SectionEditPanel({ title, className, canEdit, isDirty, onEditStart, onCancel, onSave, groups = [], revisions, children }: SectionEditPanelProps) {
  const [editing, setEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [focusEmpty, setFocusEmpty] = useState(false)
  const [snapshot, setSnapshot] = useState<Revisions>({})
  const [refused, setRefused] = useState<Revisions | null>(null)
  const [refusals, setRefusals] = useState(0)
  const calloutRef = useRef<HTMLDivElement>(null)
  const labelId = useId()
  const { hold } = useContext(DirtyEditsContext)
  // "Refetched" is a fact: the panel's revisions have caught up with what the 409 reported for every group it saves.
  const landed = refused !== null && groups.every(k => (revisions?.[k] ?? 0) >= (refused[k] ?? 0))

  useEffect(() => (editing && isDirty ? hold() : undefined), [editing, isDirty, hold])

  useEffect(() => {
    if (refusals === 0) return
    calloutRef.current?.focus({ preventScroll: true })
    calloutRef.current?.scrollIntoView({ block: 'start' })
  }, [refusals])

  useEffect(() => {
    if (!editing || !focusEmpty) return
    const fields = bodyRef.current?.querySelectorAll<HTMLInputElement>('input, select, textarea') ?? []
    for (const el of fields) {
      if (el.value === '' && el.type !== 'hidden') { el.focus(); break }
    }
  }, [editing, focusEmpty])

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 3000)
    return () => clearTimeout(timer)
  }, [saved])

  function handleEdit(focus?: 'first-empty') {
    setError(null)
    setSaved(false)
    setSnapshot(pick(revisions, groups))
    onEditStart()
    setEditing(true)
    setFocusEmpty(focus === 'first-empty')
  }

  function discardAndClose() {
    setError(null)
    setRefused(null)
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
    // After the refetch the person has seen the latest saved version, so Save now replaces it knowingly.
    const expected = refused && landed ? pick(revisions, groups) : snapshot
    setSnapshot(expected)
    try {
      await onSave(expected)
      setEditing(false)
      setSaved(true)
      setRefused(null)
    } catch (err) {
      if (isSectionChanged(err)) {
        setRefused(sectionChangedRevisions(err))
        setRefusals(n => n + 1)
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save changes.')
      }
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
          <Button variant="ghost" size="sm" onClick={() => handleEdit()}>
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Button>
        ) : undefined
      }
    >
      <div className="@container" data-save-refused={refused ? '' : undefined}>
        {error && (
          <Callout tone="error" className="mb-3">{error}</Callout>
        )}

        {refused && !error && (
          <div
            key={refusals}
            ref={calloutRef}
            tabIndex={-1}
            data-save-refused-callout
            className="mb-3 scroll-mt-16 scroll-mb-20 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <Callout tone="warning" title={REFUSED_TITLE}>{REFUSED_BODY}</Callout>
          </div>
        )}

        {saved && (
          <div role="status" className="mb-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)] text-sm border border-[var(--color-on-primary-fixed)]/20">
            Saved.
          </div>
        )}

        {editing && <div role="status" className="sr-only">{refused ? (landed ? LANDED : LOADING) : ''}</div>}

        <div className={refused ? 'grid items-start gap-[var(--section-gap)] @min-[53rem]:grid-cols-2' : undefined}>
          <div data-your-changes>
            {refused && <h4 className={COLUMN_LABEL}>Your changes</h4>}
            <div ref={bodyRef}>{children(editing, handleEdit)}</div>

            {editing && (
              <div data-edit-footer className="mt-[var(--section-gap)] flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-[var(--card-pad)]">
                <Button variant="secondary" onClick={handleCancel} disabled={isSaving}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            )}
          </div>

          {refused && (
            <section data-latest-saved aria-labelledby={labelId}>
              <h4 id={labelId} className={COLUMN_LABEL}>Latest saved</h4>
              {/* Buttons are hidden, not inert: the read view's Add and Edit do nothing here, but a screen reader must still read it. */}
              <div className="min-h-[6rem] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-[var(--card-pad)] [&_button]:hidden">
                {landed
                  ? children(false, () => {})
                  : <p aria-hidden="true" className="text-[13px] text-[var(--color-muted-foreground)]">{LOADING}</p>}
              </div>
            </section>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={discardAndClose}
        title="Discard changes?"
        message="You have unsaved changes in this section. Discard them?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        focusCancel
        variant="danger"
      />
    </Card>
  )
}
