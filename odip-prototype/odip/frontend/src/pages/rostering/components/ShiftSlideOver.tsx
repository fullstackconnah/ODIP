import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Trash2, AlertTriangle, ChevronRight } from 'lucide-react'
import type { ShiftDto, CreateShiftDto, RosterFindingDto, SupportRatio, SleepoverType, ShiftStatus } from '@/api/types'
import { SUPPORT_RATIOS, SLEEPOVER_TYPES, COORDINATOR_SETTABLE_SHIFT_STATUSES } from '@/api/types'
import { ROUTINE_CATEGORY_LABELS } from '@/api/types/routines'
import { Dropdown } from '@/components/Dropdown'
import type { DropdownItem } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { FormField } from '@/components/FormField'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ReadinessNote } from '@/components/ReadinessNote'
import { RequirementChips } from '@/components/RequirementChips'
import { requirementLabels } from '@/lib/workerRequirements'
import {
  useCheckShift, useCreateShift, useUpdateShift, useDeleteShift, useParticipantRoutines, useCompatibility, useRosterShiftNotes, getRosterFindings,
} from '@/api/hooks'
import { extractErrorMessage } from '@/lib/utils'
import { formatNoteTimestamp } from '@/lib/format'
import { formatFlaggedCategoryList, type ShiftNoteFlagCategory } from '@/lib/shiftNoteKeywords'
import { RosterGateFields } from './RosterGateFields'
import {
  BUDGET_FINDING_CODES, BudgetEmergencyReviewMarker, BudgetFindingDetails, BudgetOverrideReasonFields, canSubmit, emergencyOffered, figuresOf, markerForAcknowledgedCodes,
  type BudgetOverrideChoice, type EmergencyReviewDetails,
} from './parallel-budget-override'
import { Button } from '@/components/Button'
import { SlideOver } from '@/components/SlideOver'
import { TAP_FLOOR } from '@/components/tapArea'
import { bringIntoView } from '@/lib/bringIntoView'
import { modalGrid } from '@/lib/formGrid'
import { getRosterGate } from '../lib/rosterGate'
import { RATIO_LABELS, NIGHT_TYPE_LABELS, formatShiftTimeRange } from '../lib/roster'
import { NO_LENGTH_MESSAGE, hasNoLength, oneHourAfter } from '../lib/shiftTimes'
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
  /**
   * participantId to what is still missing for them ("Intake not complete"), from the participants list. Shown as a quiet, never-blocking
   * line under the Participant field for whoever is selected. A participant the list does not know about falls back to the shift's own
   * `readinessIssues` in edit mode; an entry holding an empty list means "ready", and wins over that fallback.
   */
  participantReadiness?: Record<string, string[]>
}

/** Normalises a Shift/TimeOnly string ("HH:mm:ss" or "HH:mm") to the "HH:mm" a <input type="time"> needs. */
function toTimeInputValue(time: string | undefined): string {
  return (time ?? '09:00').slice(0, 5)
}

/** What the panel says when the budget refuses the shift (the hard limit, for a Coordinator): one line, in the budget's words and not the roster conflict gate's. */
const BUDGET_REFUSAL_SENTENCE = "The hard limit is on, so this shift can't be saved as it is."

/** No findings, one stable array (a new `[]` each render would look like a change). */
const NO_FINDINGS: RosterFindingDto[] = []

/** What the reason field says when the budget is the only thing asking for a reason (an Admin under the hard limit). */
const BUDGET_REASON_COPY = {
  hint: 'The hard limit is on. This reason is recorded in the audit log.',
  placeholder: 'Why this shift should go ahead over budget',
  error: 'Add a reason to save this shift over budget.',
} as const

/** Sort-boost order for the Staff dropdown: Preferred first, then Allowed/no row, Excluded last. */
const COMPATIBILITY_RANK = { Preferred: 0, Allowed: 1, Excluded: 2 } as const

export function ShiftSlideOver({ target, onClose, canWrite, participantOptions, staffOptions, groupBy = 'participant', participantReadiness }: ShiftSlideOverProps) {
  const staffCompatibilityNoticeId = useId()
  const refusalId = useId()
  const open = target !== null

  // Overrides SlideOver's default "focus the first focusable element" behaviour when the caller wants focus on a specific
  // field instead — e.g. clicking an empty participant-row cell prefills the participant and date, so focus should land on
  // Staff (the thing left to pick), not on the already-correct Participant dropdown. SlideOver reads initialFocusRef when focus
  // moves in, which is after every layout effect has run, so this one has set it by then.
  const participantFieldRef = useRef<HTMLDivElement>(null)
  const staffFieldRef = useRef<HTMLDivElement>(null)
  const initialFocusRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const field = open && target?.mode === 'create' && target.focusField
      ? (target.focusField === 'staff' ? staffFieldRef : participantFieldRef).current
      : null
    initialFocusRef.current = field?.querySelector<HTMLElement>('button, input') ?? null
  }, [open, target])

  const isEdit = target?.mode === 'edit'
  const existing = target?.mode === 'edit' ? target.shift : undefined

  const [participantId, setParticipantId] = useState(existing?.participantId ?? (target?.mode === 'create' ? target.participantId ?? '' : ''))
  const [staffId, setStaffId] = useState<string | null>(existing?.staffId ?? (target?.mode === 'create' ? target.staffId ?? null : null))
  const [serviceDate, setServiceDate] = useState(existing?.serviceDate ?? (target?.mode === 'create' ? target.serviceDate ?? '' : ''))
  const [startTime, setStartTime] = useState(toTimeInputValue(existing?.startTime))
  // A new shift opens with an end an hour after the start, so it opens with a length (09:00 gives 10:00) and the live check has something to say about it; an existing shift keeps its own.
  const [endTime, setEndTime] = useState(existing?.endTime ? toTimeInputValue(existing.endTime) : oneHourAfter(toTimeInputValue(existing?.startTime)))
  const [endsNextDay, setEndsNextDay] = useState(existing?.endsNextDay ?? false)
  const [ratio, setRatio] = useState<SupportRatio>(existing?.ratio ?? 'OneToOne')
  const [nightType, setNightType] = useState<SleepoverType>(existing?.nightType ?? 'None')
  // PP-8: echoes the shift's current status back on edit so saving never silently resets it to
  // Draft (the backend's UpdateShiftDto.Status defaults to Draft when the field is omitted).
  // Create always defaults to Draft — the backend hardcodes it there regardless of this value.
  const [status, setStatus] = useState<ShiftStatus>(existing?.status ?? 'Draft')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  // The marker a shift already carries from a save past its budget (read from the codes the server stored, never from the reason's words). Its reason is shown by the marker, read only: it is not copied into
  // the ordinary reason field below, where a later save would send the server's own sentence back as if somebody had just written it.
  const budgetMarker = markerForAcknowledgedCodes(existing?.acknowledgedFindingCodes)
  const [overrideReason, setOverrideReason] = useState(budgetMarker ? '' : existing?.overrideReason ?? '')
  const [checkedFindings, setFindings] = useState<RosterFindingDto[]>(existing?.findings ?? [])
  // Budget phase 3: "Emergency or safety", the one way through a one-off shift a hard limit refused for a Coordinator, and the one line a shift the budget could not check gets.
  const [budgetChoice, setBudgetChoice] = useState<BudgetOverrideChoice>('none')
  const [emergencyDescription, setEmergencyDescription] = useState('')
  const [emergencySubmitted, setEmergencySubmitted] = useState(false)
  const [checkedBudgetNote, setBudgetNote] = useState<string | null>(null)
  // A pair of times with no length (the end at or before the start, and not ending the next day): a rule of the End time field, and no question for the live check. What the last check said was about a different
  // shift, so while the pair has no length none of it is shown. Derived here, not set from an effect: the check's answer is kept and comes back the moment the pair has a length again.
  const noLength = hasNoLength(startTime, endTime, endsNextDay)
  const findings = noLength ? NO_FINDINGS : checkedFindings
  const budgetNote = noLength ? null : checkedBudgetNote
  const [reasonRequired, setReasonRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The live dry-run below runs the same readiness gate as the save, so in Enforce mode (or for an inactive participant, in either
  // mode) the server refuses it with the same 400 message. That is shown as soon as the preview says so, not only at Save. It is tied
  // to the exact candidate it was computed for: it hides itself the moment any field of the candidate changes, and a late reply for an
  // older candidate can never show. It never gates Save; a preview that fails without a server message (a network blip) says nothing.
  const [previewRefusal, setPreviewRefusal] = useState<{ key: string; message: string } | null>(null)
  const candidateKey = JSON.stringify([participantId, staffId, serviceDate, startTime, endTime, endsNextDay, ratio, nightType, status])
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Unsaved edits: the form as it is now against the form as it first rendered. The page keys this component on the target,
  // so "first render" is the moment the panel opened.
  const current = JSON.stringify([participantId, staffId, serviceDate, startTime, endTime, endsNextDay, ratio, nightType, status, notes, overrideReason, emergencyDescription])
  const [opened] = useState(current)
  const dirty = current !== opened

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
    // Nothing to ask while the pair has no length: the answer is known, and the End time field says it (what the last check said is hidden meanwhile, below).
    if (noLength) return
    const handle = setTimeout(() => {
      checkShift.mutate(
        // The status the shift would be saved with, for an existing shift: a cancel costs nothing and gets no budget finding.
        { id: existing?.id, participantId, staffId, serviceDate, startTime, endTime, endsNextDay, ratio, nightType, status: isEdit ? status : undefined },
        {
          onSuccess: ({ findings: f, budgetNote: note }) => {
            setFindings(f)
            setBudgetNote(note ?? null)
            setPreviewRefusal(null)
            // A fresh dry-run can clear the finding that forced the reason (e.g. the coordinator
            // changed staff/date) — don't leave the error copy pinned once it no longer applies.
            if (!getRosterGate(f).needsReason) setReasonRequired(false)
            // The emergency path answers a refusal: once the server no longer refuses the shift there is nothing to answer.
            if (!emergencyOffered(f)) setBudgetChoice('none')
          },
          onError: err => {
            const message = extractErrorMessage(err, '')
            setPreviewRefusal(message ? { key: candidateKey, message } : null)
          },
        },
      )
    }, 400)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, participantId, staffId, serviceDate, startTime, endTime, endsNextDay, ratio, nightType, status])

  // A refusal that arrives below the fold is brought into view: the finding, the one-line refusal and the way through are at the bottom of a long form, and a disabled Save cannot be tapped to ask why.
  // It happens when the refusal APPEARS (or a different pool or period is the one refused), not on every re-check: pulling the panel down while the coordinator is still adjusting the times above would
  // fight them. Instant under reduced motion, and where the browser cannot say.
  const gateBlockRef = useRef<HTMLDivElement>(null)
  const refusal = findings.find(f => f.code === BUDGET_FINDING_CODES.forecastOver && f.severity === 'Blocking')
  const refusalKey = refusal ? `${refusal.budget?.poolName ?? ''}|${refusal.budget?.periodStart ?? ''}` : null
  useEffect(() => {
    if (refusalKey !== null && canWrite) bringIntoView(gateBlockRef.current)
  }, [refusalKey, canWrite])

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
  // Budget phase 3. The server REFUSED the shift on the budget (a blocking BUDGET_FORECAST_OVER, which is a Coordinator under a hard limit); "Emergency or safety" answers that refusal and nothing else,
  // and only once its description is a real one. Every other blocking finding still stops the save.
  const refusedOnBudget = emergencyOffered(findings)
  const emergencyActive = refusedOnBudget && budgetChoice === 'emergency'
  const emergencyReady = emergencyActive && canSubmit(budgetChoice, emergencyDescription)
  const stillBlocking = emergencyActive ? blockingFindings.filter(f => f.code !== BUDGET_FINDING_CODES.forecastOver) : blockingFindings
  const saveWithheld = stillBlocking.length > 0 || (refusedOnBudget && !emergencyReady)
  // The standing sentence under a Blocking finding is said in the budget's own words when the budget is the ONLY thing blocking; any other blocking finding keeps the roster's generic sentence.
  const blockingAnswered = emergencyActive && stillBlocking.length === 0
  const blockingSentence = blockingFindings.length > 0 && blockingFindings.every(f => f.code === BUDGET_FINDING_CODES.forecastOver) ? BUDGET_REFUSAL_SENTENCE : undefined
  const refusalShown = blockingFindings.length > 0 && !blockingAnswered
  // A reason that only the budget asks for is asked for in the budget's words; when another finding asks too, the generic words cover both.
  const budgetAsksForReason = reasonRequiredFindings.length > 0 && reasonRequiredFindings.every(f => f.code === BUDGET_FINDING_CODES.forecastOver)
  // Said once, in the panel's one polite live summary: where the budget leaves the form, and the "Budget not checked" line, which is in no live region of its own.
  const budgetLive = refusedOnBudget
    ? emergencyReady ? 'Over budget. Save as emergency is on.'
      : emergencyActive ? 'Over budget. Describe the emergency to turn Save on.'
      : 'Over budget. Save is off. Emergency or safety is available below.'
    : null
  const liveNote = [budgetLive, budgetNote].filter(Boolean).join(' ')
  const forecastOver =findings.find(f => f.code === BUDGET_FINDING_CODES.forecastOver && f.budget)
  const figures = forecastOver ? figuresOf(forecastOver) : null
  const isBusy = createShift.isPending || updateShift.isPending
  // Informational only: never read by the save gate above or by the Save button, so it can never block a save.
  const readinessIssues = participantReadiness?.[participantId] ?? existing?.readinessIssues
  // A save's own failure wins; otherwise the dry-run's refusal of exactly what is on screen now (one box, so the same text never shows twice).
  const shownError = error ?? (previewRefusal?.key === candidateKey ? previewRefusal.message : null)
  // The length is said under End time, where the person is looking: by the form's own rule, and by the server's 400 for it (the backstop) from the live check or from a save. Never as the alert at the foot, and a cancel needs no length.
  const serverSaidNoLength = shownError === NO_LENGTH_MESSAGE
  const lengthError = (noLength && status !== 'Cancelled') || serverSaidNoLength ? NO_LENGTH_MESSAGE : undefined
  const footError = serverSaidNoLength ? null : shownError
  // A save's refusal for the length is about the times it was for: changing one ends it.
  const clearLengthRefusal = () => setError(previous => (previous === NO_LENGTH_MESSAGE ? null : previous))

  // Typing a real answer under "a reason is required" ends the complaint at once, not only on the next save.
  function handleOverrideReasonChange(value: string) {
    setOverrideReason(value)
    if (value.trim()) setReasonRequired(false)
  }

  async function handleSave() {
    setError(null)
    if (stillBlocking.length > 0) return
    if (refusedOnBudget && !emergencyReady) {
      setEmergencySubmitted(true)
      return
    }
    // The emergency description IS the reason of an emergency save: it answers any reason-required warning beside the budget one too.
    if (!emergencyActive && reasonRequiredFindings.length > 0 && !overrideReason.trim()) {
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
      overrideReason: emergencyActive ? emergencyDescription.trim() : overrideReason.trim() || null,
      // A code once: two pools both past their funding are two findings with the same code.
      acknowledgedFindingCodes: [...new Set(warningFindings.map(f => f.code))],
      ...(emergencyActive ? { emergency: true } : {}),
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
        // The server's own words when it sent any (e.g. Enforce mode's "Participant is not ready for booking or rostering."),
        // the generic line only when it did not. The form stays as the user left it.
        setError(extractErrorMessage(err, 'Something went wrong saving this shift. Please try again.'))
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
      <SlideOver
        open
        onClose={onClose}
        title={isEdit ? 'Shift details' : 'New shift'}
        dirty={dirty}
        initialFocusRef={initialFocusRef}
        bodyClassName="flex flex-col gap-[var(--field-gap-y)]"
        footerClassName="flex items-center justify-between gap-3"
        footer={canWrite ? (
          <>
            {isEdit ? (
              <Button variant="ghost-danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            ) : <span />}
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isBusy || saveWithheld} aria-describedby={saveWithheld && refusalShown ? refusalId : undefined}>
                {isBusy ? 'Saving…' : emergencyActive ? 'Save as emergency' : reasonRequiredFindings.length > 0 ? 'Save with override' : warningFindings.length > 0 ? 'Save anyway' : 'Save'}
              </Button>
            </div>
          </>
        ) : undefined}
      >
        {budgetMarker && (
          <BudgetEmergencyReviewMarker
            details={{
              kind: budgetMarker,
              // Only an emergency has a review to wait for; one whose review the server could not find reads as pending.
              state: budgetMarker === 'emergency' ? (existing?.budgetReview?.state === 'Reviewed' ? 'reviewed' : 'pending') : undefined,
              reason: existing?.overrideReason,
              recordedAt: existing?.budgetReview?.recordedAt,
              reviewedOn: existing?.budgetReview?.reviewedOn,
              // Whoever completed the review task: an Admin only, because the server lets nobody else close it.
              reviewedBy: existing?.budgetReview?.reviewedBy,
              reviewTaskTitle: existing?.budgetReview?.reviewTaskTitle,
            } satisfies EmergencyReviewDetails}
          />
        )}

        <div data-shift-field="participant" ref={participantFieldRef}>
          <FormField label="Participant" required>
            <Dropdown
              variant="form"
              value={participantId}
              // A save's refusal ("not ready") is about the participant it was for: picking another one clears it.
              onChange={id => { setParticipantId(id); setError(null) }}
              disabled={!canWrite || isEdit}
              searchable
              label="Select a participant"
              items={participantOptions}
            />
          </FormField>
          <ReadinessNote issues={readinessIssues} className="mt-1.5" />
        </div>

        <div data-shift-field="staff" ref={staffFieldRef}>
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
            <input type="time" value={startTime} disabled={!canWrite} onChange={e => { setStartTime(e.target.value); clearLengthRefusal() }} />
          </FormField>
          <FormField label="End time" required error={lengthError}>
            <input type="time" value={endTime} disabled={!canWrite} onChange={e => { setEndTime(e.target.value); clearLengthRefusal() }} />
          </FormField>
        </div>

        <FormField label="Ends the next day" layout="checkbox">
          <input type="checkbox" checked={endsNextDay} disabled={!canWrite} onChange={e => { setEndsNextDay(e.target.checked); clearLengthRefusal() }} />
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

        {/* Plan builder phase D: a shift made from an agreement's pattern says which agreement, read only (the shifts of one revision and the next sit on the board on the same days). The shift itself says so (the server puts the pattern's source on it): no read of the pattern. */}
        {existing?.fromAgreement && (
          <p className="text-sm text-[var(--color-muted-foreground)]">{existing.sourceDraftVersion !== undefined ? `From agreement v${existing.sourceDraftVersion}` : 'From an agreement'}</p>
        )}

        {/* Plan builder phase D: what the agreement asked of a worker for this shift (copied from its pattern). Information: nothing checks it against the worker yet. */}
        {existing?.requirements && requirementLabels(existing.requirements).length > 0 && (
          <FormField label="Asks for" hint="From the agreement. Shown, not checked against the worker yet.">
            <RequirementChips requirements={existing.requirements} />
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

        {/* The finding, the one-line refusal and the way through are one block, in that order, so it can be brought into view together; the figures behind them come last. */}
        <div ref={gateBlockRef} className="flex flex-col gap-[var(--field-gap-y)]">
          <RosterGateFields
            findings={findings}
            overrideReason={overrideReason}
            onOverrideReasonChange={handleOverrideReasonChange}
            reasonRequired={reasonRequired}
            forceVisible={!!existing?.overrideReason && !budgetMarker}
            disabled={!canWrite}
            blockingAnswered={blockingAnswered}
            blockingMessage={blockingSentence}
            blockingMessageId={refusalId}
            reasonCopy={budgetAsksForReason ? BUDGET_REASON_COPY : undefined}
            liveNote={liveNote}
            answered={emergencyReady ? { codes: [BUDGET_FINDING_CODES.forecastOver], label: 'Booking as an emergency' } : undefined}
          />

          <BudgetOverrideReasonFields
            findings={findings}
            choice={budgetChoice}
            reason={emergencyDescription}
            submitted={emergencySubmitted}
            pending={isBusy}
            disabled={!canWrite}
            onChoiceChange={setBudgetChoice}
            onReasonChange={setEmergencyDescription}
          />
        </div>

        {figures && (
          <details className="group text-sm">
            {/* A tap-sized row on touch, with its own chevron: the native marker goes when the summary becomes a flex box. */}
            <summary className={`flex ${TAP_FLOOR} cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-[var(--color-muted-foreground)] [&::-webkit-details-marker]:hidden`}>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
              Budget figures
            </summary>
            <BudgetFindingDetails figures={figures} sentence={false} className="mt-2" />
          </details>
        )}

        {/* Not a finding and never a block: a shift the estimator cannot price has nothing to check, and a quiet line says so rather than letting no warning read as an all clear. */}
        {budgetNote && <p className="text-[13px] text-[var(--color-muted-foreground)]">{budgetNote}</p>}

        {footError && (
          <div role="alert" className="rounded-[var(--radius-sm)] bg-error-container px-3 py-2 text-sm text-destructive">
            {footError}
          </div>
        )}
      </SlideOver>

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
