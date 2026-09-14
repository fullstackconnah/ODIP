import type { SupportRatio, SleepoverType, ShiftStatus, CompatibilityLevel, RosterFindingSeverity, RosterComplianceLevel, IncidentSeverity, IncidentStatus } from './enums'
import type { UnavailabilityKind } from './leave'
import type { ShiftNoteFlagCategory } from '@/lib/shiftNoteKeywords'

// ── Roster Finding ───────────────────────────────────────
export interface RosterFindingDto {
  code: string
  severity: RosterFindingSeverity
  message: string
  /** True when a Warning finding requires a non-empty overrideReason before it can be saved
   * (e.g. STAFF_ON_LEAVE); false when it's a soft warning acknowledged with no reason (e.g.
   * STAFF_LEAVE_PENDING). Always false on a Blocking finding — Blocking can never be overridden. */
  requiresReason: boolean
}

// ── Shift ─────────────────────────────────────────────────
export interface ShiftDto {
  id: string
  participantId: string
  participantName: string
  staffId: string | null
  staffName: string | null
  serviceDate: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  durationHours: number
  ratio: SupportRatio
  nightType: SleepoverType
  status: ShiftStatus
  shiftPatternId: string | null
  notes: string | null
  overrideReason: string | null
  findings: RosterFindingDto[]
  /** True when this shift's assigned staff member has approved leave covering it — set after the
   * fact (leave approved after the assignment was made), so it's not necessarily reflected in
   * `findings` (those are computed at assign-time). Renders as a distinct "On leave" hole on the
   * board rather than a normal filled chip. */
  assigneeOnApprovedLeave: boolean
}

// ── Shift Notes (NOTES-01) — shared shape read by both the portal (own-shift
// create/read/author-edit) and the roster slide-over (coordinator-facing read-only list) ──
export interface ShiftNoteDto {
  id: string
  shiftId: string
  authorUserId: string
  authorName: string
  body: string
  createdAt: string
  updatedAt: string
  // NOTES-02: category names (e.g. "Falls", "Medication") the server's keyword scanner matched
  // in `body` as of the last save. Empty when nothing matched. See ShiftNoteFlagCategory on the
  // backend and frontend/src/lib/shiftNoteKeywords.ts for the mirrored category set.
  flaggedCategories: string[]
  // NOTES-02: when the author dismissed the "file an incident report?" prompt for the CURRENT
  // flaggedCategories value. Null while unflagged or not yet acknowledged.
  flagsAcknowledgedAt: string | null
  // Connection map item 4: the incident this note led to, once one has been filed via the
  // "File incident report" hand-off (INC-03/NOTES-02 prefill). Null until then.
  incidentId: string | null
}

// ── Flagged shift notes queue (connection map item 4) — coordinator-facing list of flagged
// shift notes across all shifts, used to close the "flagged note → incident" loop. Distinct
// shape from ShiftNoteDto: this is a cross-shift projection (no full note body — an excerpt —
// but carries participant/staff names and the shift date the roster slide-over would otherwise
// require a join to get). ──
export interface FlaggedShiftNoteDto {
  shiftNoteId: string
  shiftId: string
  /** YYYY-MM-DD */
  shiftDate: string
  participantId: string
  participantName: string
  staffId: string | null
  staffName: string | null
  /** Same ShiftNoteKeywordVocabulary.ToCategoryNames-produced shape as ShiftNoteDto's own
   * flaggedCategories — a real string[], not the raw [Flags] enum. */
  flaggedCategories: ShiftNoteFlagCategory[]
  excerpt: string
  createdAt: string
  incidentId: string | null
  /** "HH:mm:ss" — the shift's own schedule, so IncidentsPage's "File incident" hand-off can
   * carry the real time range instead of a fake 00:00–23:59 full-day placeholder (connection
   * map seam follow-up; mirrors ShiftDto.startTime/endTime). */
  startTime: string
  /** "HH:mm:ss" — see startTime. */
  endTime: string
  /** See ShiftDto.endsNextDay — whether the shift's endTime rolls past midnight. */
  endsNextDay: boolean
}

// ── Shift Completion (design spec §2) — Portal (start/finish) and Rostering (completions
// list/detail/approve/return) share this shape. NOTE: as of the connection-map work, no
// frontend consumer of this type exists yet — see the connection-map item 4 report for why;
// this is the data contract only, added ahead of the review UI that will render `incidents`. ──
export type ShiftCompletionReviewOutcome = 'Approved' | 'Returned'

export interface ShiftCompletionDto {
  id: string
  shiftId: string
  actualStart: string
  actualEnd: string | null
  timeZoneId: string
  geolocationDeclined: boolean
  startWasManual: boolean
  submittedByUserId: string
  submittedByName: string
  startedAt: string
  submittedAt: string | null
  reviewedByUserId: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  reviewOutcome: ShiftCompletionReviewOutcome | null
  returnReason: string | null
  varianceMinutesStart: number
  varianceMinutesEnd: number
  isOutlierVariance: boolean
  varianceReviewMinutes: number
  shiftReturnCount: number
  /** Connection map item 4: incidents raised during this shift, surfaced above the approve/
   * return actions on the (not-yet-built) completion review component. */
  incidents: {
    id: string
    title: string
    severity: IncidentSeverity
    status: IncidentStatus
    incidentDateTime: string
  }[]
}

// ── Shift Completion review queue (design spec §2/§4) ────
export interface CompletionQueueItemDto {
  shiftId: string
  completionId: string
  participantName: string
  staffName: string
  serviceDate: string
  rosteredStart: string
  rosteredEnd: string
  actualStart: string
  actualEnd: string | null
  varianceMinutesStart: number
  varianceMinutesEnd: number
  status: ShiftStatus
  timeZoneId: string
  isOutlierVariance: boolean
  varianceReviewMinutes: number
  returnCount: number
}

/** POST rostering/shifts/{id}/completion/return body — reason is required server-side (400
 * SHIFT_RETURN_REASON_REQUIRED on blank). */
export interface ReturnCompletionDto {
  reason: string
}

/** POST rostering/completions/approve-batch body — 1-100 shift ids (400 SHIFT_BATCH_SIZE_INVALID
 * outside that range). */
export interface ApproveBatchDto {
  shiftIds: string[]
}

/** Per-item outcome from a batch approve — code/message are null on success. */
export interface ApproveBatchResultDto {
  shiftId: string
  approved: boolean
  code: string | null
  message: string | null
}

// ── Trip / Leave bars (read-only board material) ─────────
export interface TripBarDto {
  tripInstanceId: string
  tripCode: string
  tripName: string
  startDate: string
  endDate: string
  isDriver: boolean
}

export interface LeaveBarDto {
  startDate: string
  endDate: string
  availabilityType: string | null
  notes: string | null
  /** Which of the leave/unavailability/legacy sources this bar represents — drives LeaveBar's styling. */
  kind: UnavailabilityKind
  /** "HH:mm:ss" (TimeOnly). Populated only when kind === 'RecurringRule' — every other kind has
   * these null, since a date-range leave/legacy row has no time-of-day component. Drives
   * LeaveBar's partial-day rendering (Task 4). */
  startTime: string | null
  endTime: string | null
}

// ── Roster Board ──────────────────────────────────────────
export interface RosterStaffRowDto {
  staffId: string
  fullName: string
  role: string
  compliance: RosterComplianceLevel
  complianceNotes: string[]
  rosteredHours: number
  targetHours: number
  shifts: ShiftDto[]
  tripBars: TripBarDto[]
  leave: LeaveBarDto[]
}

export interface RosterParticipantRowDto {
  participantId: string
  fullName: string
  supportRatio: SupportRatio
  overnightSupport: SleepoverType
  hasRestrictivePractice: boolean
  shifts: ShiftDto[]          // includes unfilled ones (staffId null)
  tripBars: TripBarDto[]
  scheduledHours: number
  daysWithoutCover: number    // days in the week with no shift and no trip
}

export interface RosterExceptionDto {
  shiftId: string | null
  participantName: string
  serviceDate: string
  finding: RosterFindingDto
}

/**
 * Discriminated on `groupBy`. Participant view is the default — every active participant gets a
 * row whether or not they have shifts, and an unfilled shift lives inline on its participant's
 * row rather than in a separate lane. Staff view keeps the pass-1 shape: staff rows plus the
 * dedicated Unfilled lane, which is where over-allocation/double-booking findings are visible.
 */
export type RosterBoardDto =
  | {
      groupBy: 'Participant'
      weekStart: string
      days: string[]
      participantRows: RosterParticipantRowDto[]
      exceptions: RosterExceptionDto[]
    }
  | {
      groupBy: 'Staff'
      weekStart: string
      days: string[]
      staffRows: RosterStaffRowDto[]
      unfilled: ShiftDto[]
      exceptions: RosterExceptionDto[]
    }

// ── Write bodies ──────────────────────────────────────────
export interface CreateShiftDto {
  participantId: string
  staffId: string | null
  serviceDate: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  ratio: SupportRatio
  nightType: SleepoverType
  /**
   * PP-8: the backend's UpdateShiftDto.Status defaults to Draft when the field is absent from
   * the request body — without this, every edit silently reset a Published/Completed shift back
   * to Draft. Create ignores this (the backend hardcodes Status = Draft on create), so its value
   * here is inert but kept required so callers can't accidentally omit it on Update.
   */
  status: ShiftStatus
  shiftPatternId?: string | null
  notes?: string | null
  overrideReason: string | null
  acknowledgedFindingCodes: string[]
}

export type UpdateShiftDto = CreateShiftDto

export interface AssignShiftDto {
  staffId: string | null
  overrideReason: string | null
  acknowledgedFindingCodes: string[]
}

/** Dry-run candidate for POST /shifts/check — no writes, no override fields. */
export interface CheckShiftDto {
  id?: string
  participantId: string
  staffId: string | null
  serviceDate: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  ratio: SupportRatio
  nightType: SleepoverType
}

// ── Shift Pattern ─────────────────────────────────────────
export interface ShiftPatternDto {
  id: string
  participantId: string
  participantName: string
  defaultStaffId: string | null
  defaultStaffName: string | null
  dayOfWeek: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  ratio: SupportRatio
  nightType: SleepoverType
  effectiveFrom: string
  effectiveTo: string | null
  isActive: boolean
  notes: string | null
}

export interface CreateShiftPatternDto {
  participantId: string
  defaultStaffId?: string | null
  dayOfWeek: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  ratio: SupportRatio
  nightType: SleepoverType
  effectiveFrom: string
  effectiveTo?: string | null
  isActive?: boolean
  notes?: string | null
}

export type UpdateShiftPatternDto = CreateShiftPatternDto

/** Response of `POST /patterns/{id}/generate` — counts, not the generated shifts themselves. */
export interface GeneratePatternResultDto {
  created: number
  skipped: number
}

// ── Staff / Participant compatibility ────────────────────
export interface CompatibilityRowDto {
  staffId: string
  staffName: string
  participantId: string
  participantName: string
  level: CompatibilityLevel
  reason: string | null
  updatedAt: string
}

export interface UpsertCompatibilityDto {
  staffId: string
  participantId: string
  level: CompatibilityLevel
  reason?: string | null
}
