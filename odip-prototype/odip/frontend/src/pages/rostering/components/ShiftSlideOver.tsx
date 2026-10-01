import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { X, Trash2, AlertTriangle } from 'lucide-react'
import type { ShiftDto, CreateShiftDto, RosterFindingDto, SupportRatio, SleepoverType, ShiftStatus } from '@/api/types'
import { SUPPORT_RATIOS, SLEEPOVER_TYPES, COORDINATOR_SETTABLE_SHIFT_STATUSES } from '@/api/types'
import { ROUTINE_CATEGORY_LABELS } from '@/api/types/routines'
import { Dropdown } from '@/components/Dropdown'
import type { DropdownItem } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { FormField } from '@/components/FormField'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  useCheckShift, useCreateShift, useUpdateShift, useDeleteShift, useParticipantRoutines, useCompatibility, useRosterShiftNotes, getRosterFindings,
} from '@/api/hooks'
import { formatNoteTimestamp } from '@/lib/format'
import { formatFlaggedCategoryList, type ShiftNoteFlagCategory } from '@/lib/shiftNoteKeywords'
import { RosterGateFields } from './RosterGateFields'
import { Button } from '@/components/Button'
import { modalGrid } from '@/lib/formGrid'
import { useSlideOverA11y } from '../lib/useSlideOverA11y'
import { getRosterGate } from '../lib/rosterGate'
import { RATIO_LABELS, NIGHT_TYPE_LABELS, formatShiftTimeRange } from '../lib/roster'
import { getRelevantRoutines } from '../lib/routines'

export type ShiftSlideOverTarget =
  | {
      mode: 'create'
      participantId?: string
      staffId?: string | null
      serviceDate?: string
      /** Which field to send focus to once the panel opens, overriding the default first-focusable — set when the field it names is already prefilled and the other one is what needs picking (e.g. clicking an empty cell). */
      focusField?: 'participant' | 'staff'
    }
  | { mode: 'edit'; shift: ShiftDto }

export type ShiftSlideOverProps = {
  target: ShiftSlideOverTarget | null
  onClose: () => void
  canWrite: boolean
  participantOptions: { value: string; label: string }[]
  staffOptions: { value: string; label: string }[]
  /** Which board grouping opened this panel — only changes the "leave unassigned" hint copy, since an unfilled shift has no separate lane to point to in participant view. */
  groupBy?: 'participant' | 'staff'
}

/** Normalises a Shift/TimeOnly string ("HH:mm:ss" or "HH:mm") to the "HH:mm" a <input type="time"> needs. */
function toTimeInputValue(time: string | undefined): string {
  return (time ?? '09:00').slice(0, 5)
}

/** Sort-boost order for the Staff dropdown: Preferred first, then Allowed/no row, Excluded last. */
const COMPATIBILITY_RANK = { Preferred: 0, Allowed: 1, Excluded: 2 } as const

export function ShiftSlideOver({ target, onClose, canWrite, participantOptions, staffOptions, groupBy = 'participant' }: ShiftSlideOverProps) {
  const titleId = useId()
  const staffCompatibilityNoticeId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const open = target !== null
  useSlideOverA11y(open, onClose, panelRef)

  // Overrides the a11y hook's default "focus the first focusable element" behaviour when the
  // caller wants focus on a specific field instead — e.g. clicking an empty participant-row cell
  // prefills the participant and date, so focus should land on Staff (the thing left to pick),
  // not back on the already-correct Participant dropdown. Declared after useSlideOverA11y so it
  // runs after that hook's own focus effect within the same commit and wins.
  useEffect(() => {
    if (!open || target?.mode !== 'create' || !target.focusField) return
    const el = panelRef.current?.querySelector<HTMLElement>(`[data-shift-field="${target.focusField}"] button, [data-shift-field="${target.focusField}"] input`)
    el?.focus()
  }, [open, target])

  const isEdit = target?.mode === 'edit'
  const existing = target?.mode === 'edit' ? target.shift : undefined

  const [participantId, setParticipantId] = useState(existing?.participantId ?? (target?.mode === 'create' ? target.participantId ?? '' : ''))
  const [staffId, setStaffId] = useState<string | null>(existing?.staffId ?? (target?.mode === 'create' ? target.staffId ?? null : null))
  const [serviceDate, setServiceDate] = useState(existing?.serviceDate ?? (target?.mode === 'create' ? target.serviceDate ?? '' : ''))
  const [startTime, setStartTime] = useState(toTimeInputValue(existing?.startTime))
  const [endTime, setEndTime] = useState(toTimeInputValue(existing?.endTime))
  const [endsNextDay, setEndsNextDay] = useState(existing?.endsNextDay ?? false)
  const [ratio, setRatio] = useState<SupportRatio>(existing?.ratio ?? 'OneToOne')
  const [nightType, setNightType] = useState<SleepoverType>(existing?.nightType ?? 'None')
  // PP-8: echoes the shift's current status back on edit so saving never silently resets it to
  // Draft (the backend's UpdateShiftDto.Status defaults to Draft when the field is omitted).
  // Create always defaults to Draft — the backend hardcodes it there regardless of this value.
  const [status, setStatus] = useState<ShiftStatus>(existing?.status ?? 'Draft')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [overrideReason, setOverrideReason] = useState(existing?.overrideReason ?? '')
  const [findings, setFindings] = useState<RosterFindingDto[]>(existing?.findings ?? [])
  const [reasonRequired, setReasonRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const checkShift = useCheckShift()
  const createShift = useCreateShift()
  const updateShift = useUpdateShift()
  const deleteShift = useDeleteShift()

  // Read-only: surfaces the participant's routines/specifics relevant to this shift window so
  // a support worker doesn't have to leave the roster board to check them.
  const { data: participantRoutines = [] } = useParticipantRoutines(participantId || undefined)

  // Compatibility matrix (task 6d): the same POST /shifts/check dry-run below already surfaces
  // an Excluded pairing as a Warning finding once staff + date/time are all filled in, but that
  // only tells you AFTER picking someone. This gives the hint before/without a selection —
  // Preferred staff sort to the top of the dropdown and carry a hint; Excluded staff carry a
  // non-blocking warning both in the dropdown and inline once selected.
  const { data: compatibilityRows = [] } = useCompatibility(participantId || undefined)

  // NOTES-01: read-only for the coordinator — only the assigned worker creates/edits their own,
  // through the portal. Only fetched in edit mode (a real shift id exists); a new/unsaved shift
  // can't have notes yet.
  const { data: shiftNotes = [] } = useRosterShiftNotes(existing?.id)
  const [showAllNotes, setShowAllNotes] = useState(false)
  const visibleNotes = showAllNotes ? shiftNotes : shiftNotes.slice(0, 2)
  const compatibilityByStaffId = useMemo(() => {
    const map = new Map<string, { level: 'Preferred' | 'Allowed' | 'Excluded'; reason: string | null }>()
    compatibilityRows.forEach(row => map.set(row.staffId, { level: row.level, reason: row.reason }))
    return map
  }, [compatibilityRows])
  const sortedStaffOptions: DropdownItem[] = useMemo(() => {
    return staffOptions
      .map(option => {
        const level = compatibilityByStaffId.get(option.value)?.level
        return {
          ...option,
          description: level === 'Preferred' ? 'Preferred for this participant'
            : level === 'Excluded' ? 'Not compatible with this participant'
            : undefined,
        }
      })
      // Array.prototype.sort is stable — ties (Allowed/no row) keep the caller's original order.
      .sort((a, b) => COMPATIBILITY_RANK[compatibilityByStaffId.get(a.value)?.level ?? 'Allowed'] - COMPATIBILITY_RANK[compatibilityByStaffId.get(b.value)?.level ?? 'Allowed'])
  }, [staffOptions, compatibilityByStaffId])
  const selectedStaffCompatibility = staffId ? compatibilityByStaffId.get(staffId) : undefined
  const selectedStaffLabel = staffOptions.find(s => s.value === staffId)?.label ?? 'This staff member'
  const relevantRoutines = participantId && serviceDate && startTime && endTime
    ? getRelevantRoutines(participantRoutines, { serviceDate, startTime, endTime, endsNextDay })
    : []

  // Live dry-run: re-checks findings whenever the candidate shape changes, debounced so we
  // don't fire a request per keystroke. Never writes — POST /shifts/check is a pure preview.
  useEffect(() => {
    if (!canWrite || !participantId || !serviceDate || !startTime || !endTime) return
    const handle = setTimeout(() => {
      checkShift.mutate(
        { id: existing?.id, participantId, staffId, serviceDate, startTime, endTime, endsNextDay, ratio, nightType },
        {
          onSuccess: f => {
            setFindings(f)
            // A fresh dry-run can clear the finding that forced the reason (e.g. the coordinator
            // changed staff/date) — don't leave the error copy pinned once it no longer applies.
            if (!getRosterGate(f).needsReason) setReasonRequired(false)
          },
        },
      )
    }, 400)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, participantId, staffId, serviceDate, startTime, endTime, endsNextDay, ratio, nightType])

  if (!open) return null

  // PP-8 follow-up: RosteringController.UpdateShift's fromAllowed/toAllowed gate only ever
  // allows a Draft/Published/Cancelled status — InProgress/PendingReview/Completed are
  // system/worker-driven states reached only through the completion endpoints
  // (start/finish/approve/return), and picking one here would just 409 with
  // ShiftErrorCodes.ShiftStatusLocked. When the shift is already in one of those states, show
  // it read-only instead of offering a transition the backend will always reject.
  const isCoordinatorSettable = (s: ShiftStatus): boolean =>
    (COORDINATOR_SETTABLE_SHIFT_STATUSES as readonly string[]).includes(s)
  const statusLocked = !!existing && !isCoordinatorSettable(existing.status)
  const statusItems: DropdownItem[] = statusLocked
    ? [{ value: existing!.status, label: existing!.status, disabled: true }]
    : COORDINATOR_SETTABLE_SHIFT_STATUSES.map(s => ({ value: s, label: s }))

  const warningFindings = findings.filter(f => f.severity === 'Warning')
  // A Warning finding only forces a reason when the backend marks it requiresReason (e.g.
  // STAFF_ON_LEAVE) — a soft warning like STAFF_LEAVE_PENDING can be acknowledged with no reason
  // typed, though its code is still recorded in acknowledgedFindingCodes below. The backend never
  // sets requiresReason on a Blocking finding, so deriving reasonRequiredFindings from all
  // findings (via getRosterGate) rather than warningFindings alone is equivalent here.
  const { blockingFindings, reasonRequiredFindings } = getRosterGate(findings)
  const isBusy = createShift.isPending || updateShift.isPending

  async function handleSave() {
    setError(null)
    if (blockingFindings.length > 0) return
    if (reasonRequiredFindings.length > 0 && !overrideReason.trim()) {
      setReasonRequired(true)
      return
    }
    setReasonRequired(false)

    const payload: CreateShiftDto = {
      participantId,
      staffId,
      serviceDate,
      startTime,
      endTime,
      endsNextDay,
      ratio,
      nightType,
      status,
      notes: notes.trim() || null,
      overrideReason: overrideReason.trim() || null,
      acknowledgedFindingCodes: warningFindings.map(f => f.code),
    }

    try {
      if (isEdit && existing) {
        await updateShift.mutateAsync({ id: existing.id, data: payload })
      } else {
        await createShift.mutateAsync(payload)
      }
      onClose()
    } catch (err: unknown) {
      const serverFindings = getRosterFindings(err)
      if (serverFindings) {
        setFindings(serverFindings)
        if (getRosterGate(serverFindings).needsReason && !overrideReason.trim()) setReasonRequired(true)
      } else {
        setError('Something went wrong saving this shift. Please try again.')
      }
    }
  }

  async function handleDelete() {
    if (!existing) return
    await deleteShift.mutateAsync(existing.id)
    setConfirmDelete(false)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-hidden border-l border-border bg-card shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border p-[var(--card-pad)]">
          <h2 id={titleId} className="font-display text-base font-semibold text-foreground">
            {isEdit ? 'Shift details' : 'New shift'}
          </h2>
          <Button variant="ghost" iconOnly onClick={onClose} aria-label="Close panel">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex flex-1 flex-col gap-[var(--field-gap-y)] overflow-y-auto p-[var(--card-pad)]">
          <div data-shift-field="participant">
            <FormField label="Participant" required>
              <Dropdown
                variant="form"
                value={participantId}
                onChange={setParticipantId}
                disabled={!canWrite || isEdit}
                searchable
                label="Select a participant"
                items={participantOptions}
              />
            </FormField>
          </div>

          <div data-shift-field="staff">
            <FormField
              label="Staff"
              hint={groupBy === 'staff' ? 'Leave unassigned to add this shift to the Unfilled lane.' : 'Leave unassigned — the shift shows as unfilled on the participant’s row.'}
              // Links the Preferred/Excluded compatibility notice below (rendered outside this
              // FormField so it can carry its own role/styling) into the Staff control's
              // aria-describedby, so AT users focused on the field hear it — not just sighted
              // users. Only Excluded/Preferred actually render the <p id={staffCompatibilityNoticeId}>
              // below — an explicit Allowed row (or any other level) renders neither, so the guard
              // must match those two levels exactly or this dangles a reference to a nonexistent id.
              descriptionId={
                selectedStaffCompatibility?.level === 'Excluded' || selectedStaffCompatibility?.level === 'Preferred'
                  ? staffCompatibilityNoticeId
                  : undefined
              }
            >
              <SearchableSelect
                value={staffId ?? ''}
                onChange={v => setStaffId(v || null)}
                disabled={!canWrite}
                placeholder="Unassigned"
                items={[{ value: '', label: 'Unassigned' }, ...sortedStaffOptions]}
              />
            </FormField>
            {selectedStaffCompatibility?.level === 'Excluded' && (
              // status, not alert: this is informational and non-blocking (save still works), so an
              // assertive interruption would overstate it — polite matches the Blocking-finding alert
              // below it in severity terms while still surfacing on selection without needing focus.
              <p id={staffCompatibilityNoticeId} role="status" className="mt-1.5 text-xs font-medium text-destructive">
                {selectedStaffLabel} is marked not compatible with this participant
                {selectedStaffCompatibility.reason ? `: ${selectedStaffCompatibility.reason}.` : '.'}
                {' '}You can still save this shift — it just won't be suggested as a match.
              </p>
            )}
            {selectedStaffCompatibility?.level === 'Preferred' && (
              <p id={staffCompatibilityNoticeId} className="mt-1.5 text-xs text-primary">
                {selectedStaffLabel} is a preferred staff member for this participant.
              </p>
            )}
          </div>

          <FormField label="Service date" required>
            <input type="date" value={serviceDate} disabled={!canWrite} onChange={e => setServiceDate(e.target.value)} />
          </FormField>

          <div className={modalGrid}>
            <FormField label="Start time" required>
              <input type="time" value={startTime} disabled={!canWrite} onChange={e => setStartTime(e.target.value)} />
            </FormField>
            <FormField label="End time" required>
              <input type="time" value={endTime} disabled={!canWrite} onChange={e => setEndTime(e.target.value)} />
            </FormField>
          </div>

          <FormField label="Ends the next day" layout="checkbox">
            <input type="checkbox" checked={endsNextDay} disabled={!canWrite} onChange={e => setEndsNextDay(e.target.checked)} />
          </FormField>

          <div className={modalGrid}>
            <FormField label="Ratio">
              <Dropdown
                variant="form"
                value={ratio}
                onChange={v => setRatio(v as SupportRatio)}
                disabled={!canWrite}
                items={SUPPORT_RATIOS.map(r => ({ value: r, label: RATIO_LABELS[r] ?? r }))}
              />
            </FormField>
            <FormField label="Night type">
              <Dropdown
                variant="form"
                value={nightType}
                onChange={v => setNightType(v as SleepoverType)}
                disabled={!canWrite}
                items={SLEEPOVER_TYPES.map(n => ({ value: n, label: NIGHT_TYPE_LABELS[n] ?? n }))}
              />
            </FormField>
          </div>

          {isEdit && (
            <FormField
              label="Status"
              hint={statusLocked ? 'Set automatically as the worker starts/finishes the shift and a reviewer approves or returns it — it can’t be changed here.' : undefined}
            >
              <Dropdown
                variant="form"
                value={status}
                onChange={v => setStatus(v as ShiftStatus)}
                disabled={!canWrite || statusLocked}
                items={statusItems}
              />
            </FormField>
          )}

          <FormField label="Notes">
            <textarea rows={3} value={notes} disabled={!canWrite} onChange={e => setNotes(e.target.value)} placeholder="Optional notes for this shift" />
          </FormField>

          {relevantRoutines.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">Routines &amp; specifics</p>
              <ul className="space-y-2">
                {relevantRoutines.map(routine => (
                  <li
                    key={routine.id}
                    className={`rounded-[var(--radius-sm)] border px-3 py-2 text-sm ${
                      routine.isCritical
                        ? 'border-destructive/30 bg-error-container/20'
                        : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {routine.isCritical && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Critical" />}
                      <span className="font-medium text-foreground">{routine.title}</span>
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap">
                        {ROUTINE_CATEGORY_LABELS[routine.category]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {routine.startTime && routine.endTime ? formatShiftTimeRange(routine.startTime, routine.endTime) : 'Untimed'}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-foreground">{routine.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isEdit && shiftNotes.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">Shift notes</p>
              <ul className="space-y-2">
                {visibleNotes.map(note => (
                  <li key={note.id} className="rounded-[var(--radius-sm)] border border-border bg-card px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{note.authorName}</span> · {formatNoteTimestamp(note.createdAt)}
                      </p>
                      {/* NOTES-02: coordinator-facing read-only signal — the worker still owns
                          dismissing/actioning the prompt on the portal; this is visibility only. */}
                      {note.flaggedCategories.length > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-warning-container)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-on-warning-container)]">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          {formatFlaggedCategoryList(note.flaggedCategories as ShiftNoteFlagCategory[])}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-foreground">{note.body}</p>
                  </li>
                ))}
              </ul>
              {shiftNotes.length > 2 && (
                <Button variant="ghost" size="sm" onClick={() => setShowAllNotes(v => !v)} className="mt-2">
                  {showAllNotes ? 'Show fewer notes' : `Show all ${shiftNotes.length} notes`}
                </Button>
              )}
            </div>
          )}

          <RosterGateFields
            findings={findings}
            overrideReason={overrideReason}
            onOverrideReasonChange={setOverrideReason}
            reasonRequired={reasonRequired}
            forceVisible={!!existing?.overrideReason}
            showOnAnyWarning
            disabled={!canWrite}
          />

          {error && (
            <div role="alert" className="rounded-[var(--radius-sm)] bg-error-container px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        {canWrite && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-[var(--card-pad)]">
            {isEdit ? (
              <Button variant="ghost-danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            ) : <span />}
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isBusy || blockingFindings.length > 0}>
                {isBusy ? 'Saving…' : warningFindings.length > 0 ? 'Save with override' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
        title="Delete shift"
        message="This permanently removes the shift from the roster. This can't be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteShift.isPending}
      />
    </>
  )
}
