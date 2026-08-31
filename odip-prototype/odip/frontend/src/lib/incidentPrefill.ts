// INC-03: shared shape for the "drop into a draft incident" hand-off from the MAR flow
// (RecordAdministrationModal) to the incident create form (IncidentCreatePage). Nothing is
// persisted server-side here — this is purely router-state prefill data. If the coordinator/
// support worker never submits the incident form, nothing exists (no ghost drafts).
import { ADMIN_STATUS_LABELS, INCIDENT_TRIGGER_OUTCOMES } from '@/api/types/medications'
import type { MedicationAdministrationStatus } from '@/api/types/enums'
import { parseApiDate, formatWithTimeZone, formatDateAu } from '@/lib/utils'
import type { RestrictivePracticeDto } from '@/api/types/restrictive-practices'
import { formatFlaggedCategoryList, incidentTypeForFlaggedCategories, type ShiftNoteFlagCategory } from '@/lib/shiftNoteKeywords'
import { formatShiftRange, formatDayAccessibleName } from '@/pages/rostering/lib/roster'
import type { IncidentType } from '@/api/types/enums'

export interface MarIncidentPrefillState {
  source: 'mar-administration'
  outcome: MedicationAdministrationStatus
  participantId: string
  participantName: string
  medicationName: string
  strength?: string | null
  doseDescription?: string | null
  scheduledAt?: string | null
  administeredAt?: string | null
  administeredAtTimeZone?: string | null
  recordedByName?: string | null
  recordedByUserId?: string | null
  /** The reason recorded on the MAR entry (why the dose was refused/withheld/missed/wrong). */
  reason?: string | null
  /** MED-03: for a WrongMedication outcome, what was actually given instead. */
  notes?: string | null
  /** INC-01 linkage — only ever set when the MAR context has an active trip to derive it from. */
  tripInstanceId?: string | null
}

/** Whether a MAR outcome is one of the auto-incident triggers (MED-03/INC-03 controller ruling:
 * refused/withheld/missed/wrong-medication). */
export function isIncidentTriggerOutcome(status: MedicationAdministrationStatus): boolean {
  return (INCIDENT_TRIGGER_OUTCOMES as readonly MedicationAdministrationStatus[]).includes(status)
}

/** Narrows an unknown value (react-router location.state) down to a MAR incident prefill. */
export function isMarIncidentPrefillState(state: unknown): state is MarIncidentPrefillState {
  return !!state && typeof state === 'object' && (state as { source?: unknown }).source === 'mar-administration'
}

function toDatetimeLocalValue(iso: string, timeZone: string | null | undefined): string {
  const date = parseApiDate(iso)
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date)
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00'
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
  } catch {
    return iso.slice(0, 16)
  }
}

const OUTCOME_VERB: Record<MedicationAdministrationStatus, string> = {
  Administered: 'administered',
  Refused: 'refused',
  Withheld: 'withheld',
  Missed: 'missed',
  WrongMedication: 'given the wrong medication',
}

/** Generates a description skeleton from what the MAR flow already knows — the coordinator
 * still reviews/edits it before submitting, this just saves re-typing what's already on record. */
export function buildIncidentDescriptionSkeleton(p: MarIncidentPrefillState): string {
  const med = `${p.medicationName}${p.strength ? ` ${p.strength}` : ''}${p.doseDescription ? ` (${p.doseDescription})` : ''}`
  const when = p.administeredAt
    ? formatWithTimeZone(p.administeredAt, p.administeredAtTimeZone, { dateStyle: 'medium', timeStyle: 'short' })
    : p.scheduledAt
      ? `scheduled for ${formatWithTimeZone(p.scheduledAt, p.administeredAtTimeZone, { dateStyle: 'medium', timeStyle: 'short' })}`
      : null

  const lines = [
    `${p.participantName} was ${OUTCOME_VERB[p.outcome]} — ${med}${when ? ` (${when})` : ''}.`,
  ]
  if (p.outcome === 'WrongMedication' && p.notes) {
    lines.push(`Given instead: ${p.notes}.`)
  }
  if (p.reason) {
    lines.push(`Reason recorded on the MAR: ${p.reason}.`)
  }
  if (p.recordedByName) {
    lines.push(`Recorded by ${p.recordedByName}.`)
  }
  lines.push('', '[Add further detail about what happened, immediate response and follow-up above.]')
  return lines.join('\n')
}

export function buildIncidentTitleSkeleton(p: MarIncidentPrefillState): string {
  return `${ADMIN_STATUS_LABELS[p.outcome]} — ${p.medicationName} (${p.participantName})`
}

/** Best-effort incidentDateTime for the datetime-local field — prefers the actual administered
 * instant (rendered in the zone it was captured in), falling back to the scheduled time, then now. */
export function buildIncidentDateTime(p: MarIncidentPrefillState): string {
  const iso = p.administeredAt ?? p.scheduledAt
  if (!iso) return new Date().toISOString().slice(0, 16)
  return toDatetimeLocalValue(iso, p.administeredAtTimeZone)
}

/** MED-03/INC-03 default severity heuristic — a wrong medication is treated as more serious than
 * a refused/withheld/missed dose by default; the coordinator can still change it before submitting. */
export function suggestedIncidentSeverity(outcome: MedicationAdministrationStatus): 'Medium' | 'High' {
  return outcome === 'WrongMedication' ? 'High' : 'Medium'
}

// ── INC-04 / INC-05: restrictive-practice incident helpers ──────────────────

/**
 * INC-04 client-side preview of the authorised/unauthorised determination — mirrors
 * IncidentsController.DetermineRestrictivePracticeAuthorisationAsync exactly (active entries of
 * the reported type for the involved participant, same tenant-scoped register the picker reads),
 * so the banner on the create form updates live as the coordinator changes the participant or
 * type, before the backend computes and freezes the real value at submit. 'unknown' — not yet
 * determinable — when either the participant or the type hasn't been chosen yet.
 */
export type RpAuthorisationPreview = 'authorised' | 'unauthorised' | 'unknown'

export function previewRpAuthorisation(
  involvedParticipantId: string | undefined | null,
  restrictivePracticeType: string | undefined | null,
  participantActivePractices: Pick<RestrictivePracticeDto, 'type'>[],
): RpAuthorisationPreview {
  if (!involvedParticipantId || !restrictivePracticeType) return 'unknown'
  return participantActivePractices.some(p => p.type === restrictivePracticeType) ? 'authorised' : 'unauthorised'
}

/** INC-05: prepopulation skeleton once the coordinator links a specific register entry — saves
 * re-typing what's already on record, same "skeleton the reporter still edits" idiom as
 * buildIncidentDescriptionSkeleton (INC-03). */
export function buildRpIncidentDescriptionSkeleton(practice: Pick<RestrictivePracticeDto, 'description' | 'reviewDate'>): string {
  const lines = [
    `Linked to the participant's authorised restrictive practice on file: ${practice.description}`,
  ]
  if (practice.reviewDate) {
    lines.push(`(Register entry review due ${formatDateAu(practice.reviewDate)}.)`)
  }
  lines.push('', '[Add further detail about what happened, immediate response and follow-up above.]')
  return lines.join('\n')
}

// ── NOTES-02: shift-note keyword-flagging hand-off ───────────────────────────
// Same "drop into a draft incident, nothing persisted until submitted" prefill idiom as INC-03's
// MAR hand-off above — the portal's ShiftNotesSection banner is this one's only producer.

export interface ShiftNoteIncidentPrefillState {
  source: 'shift-note'
  shiftNoteId: string
  categories: ShiftNoteFlagCategory[]
  participantId: string
  participantName: string
  noteBody: string
  serviceDate: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  /** The signed-in worker viewing this shift — same "reportedByStaffId = staff/User id space" idiom as MarIncidentPrefillState.recordedByUserId. */
  reportedByUserId?: string | null
}

/** Narrows an unknown value (react-router location.state) down to a shift-note incident prefill. */
export function isShiftNoteIncidentPrefillState(state: unknown): state is ShiftNoteIncidentPrefillState {
  return !!state && typeof state === 'object' && (state as { source?: unknown }).source === 'shift-note'
}

export function buildShiftNoteIncidentTitleSkeleton(p: ShiftNoteIncidentPrefillState): string {
  const categoryList = formatFlaggedCategoryList(p.categories)
  return `Shift note flagged ${categoryList} — ${p.participantName}`
}

/** INC-03-style default incident type — see incidentTypeForFlaggedCategories for the priority rule when a note trips more than one category. */
export function suggestedIncidentTypeForShiftNote(p: ShiftNoteIncidentPrefillState): IncidentType {
  return incidentTypeForFlaggedCategories(p.categories)
}

/** Generates a description skeleton carrying the shift context + the flagged note's own text as a seed — the worker/coordinator still reviews/edits it before submitting. */
export function buildShiftNoteIncidentDescriptionSkeleton(p: ShiftNoteIncidentPrefillState): string {
  const categoryList = formatFlaggedCategoryList(p.categories)
  const when = `${formatDayAccessibleName(p.serviceDate)}, ${formatShiftRange(p.startTime, p.endTime, p.endsNextDay)}`
  const lines = [
    `${p.participantName}'s shift note for ${when} mentioned ${categoryList} and may warrant an incident report:`,
    '',
    `"${p.noteBody}"`,
    '',
    '[Add further detail about what happened, immediate response and follow-up above.]',
  ]
  return lines.join('\n')
}

/** Best-effort incidentDateTime for the datetime-local field — the shift's own start time, in the same "no timezone context to correct for" shape as a portal-authored note. */
export function buildShiftNoteIncidentDateTime(p: ShiftNoteIncidentPrefillState): string {
  return `${p.serviceDate}T${p.startTime.slice(0, 5)}`
}
