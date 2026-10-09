import type {
  ShiftBreakDto,
  PortalDoseSlotDto,
  PortalDoseOutcomeDto,
  PortalShiftRoutineDto,
} from './shift-package'
import type { SupportRatio, SleepoverType, ShiftStatus, CompatibilityLevel, RosterFindingSeverity, RosterComplianceLevel, IncidentSeverity, IncidentStatus } from './enums'
import type { UnavailabilityKind } from './leave'
import type { PlanBlockRequirements } from './plan-pricing'
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
  /** The figures a budget finding (`BUDGET_*`) was worked out from, so a screen prints them and does no sum of its own. Omitted on every other finding. */
  budget?: BudgetFindingFiguresDto
}

/** The figures behind a budget finding: one pool in one funding period with the shift counted in. Dollars; the dates are calendar dates. */
export interface BudgetFindingFiguresDto {
  poolName: string
  periodStart: string
  periodEnd: string
  available: number
  used: number
  /** What the period has left after what is used; negative once it is over. */
  remaining: number
  /** Used plus booked ahead, with this shift counted. */
  forecast: number
  /** The estimate of the shift itself, priced the way ODIP will claim it. */
  shiftCost: number
  /** How far the forecast is past what is available; zero when it is not. */
  overBy: number
  /** What the period had booked ahead BEFORE this shift, so used + booked ahead + this shift is the forecast and the screen needs no sum of its own. */
  bookedAhead: number
  /** How many of the period's shifts could not be priced (a sleepover, a group shift, no rate): they are $0 in every figure above, so the figures are not the whole period. */
  unpricedShiftCount: number
}

/**
 * One pool in one funding period that an action takes past its funding: the shifts a pattern has just made, the shifts approving an agreement would make, or a trip booking just confirmed. A warning
 * only, in every mode: the action has happened, or will, whatever it says. The server works every figure out.
 */
export interface BudgetWarningDto {
  poolName: string
  periodStart: string
  periodEnd: string
  available: number
  used: number
  forecast: number
  /** What the action itself adds to this pool in this period. */
  added: number
  overBy: number
  /** How many shifts (or bookings) the action puts in this pool and period. */
  count: number
  /** The warning in a sentence: "These 8 shifts take Core (flexible) to $8,640.00 of $8,000.00 for 1 Oct – 31 Dec 2026, $640.00 over." */
  message: string
  /** Whose budget this is, for a trip booking: the bulk confirm of several bookings lists each line with its participant. Absent for shifts. */
  participantName?: string
}

/** Where the Admin's review of an emergency or safety booking past the budget stands. There is no "approved": it saves at once and is reviewed afterwards. */
export type BudgetReviewState = 'Pending' | 'Reviewed'

export interface BudgetReviewDto {
  state: BudgetReviewState
  /** When the server recorded the emergency booking: the moment its review task was raised. */
  recordedAt?: string
  reviewTaskTitle?: string
  /** The provider's calendar date the review task was completed on; absent while it is pending. */
  reviewedOn?: string
  /** The Admin who completed the review; absent while it is pending or when nobody is recorded. */
  reviewedBy?: string
}

// ── Shift ─────────────────────────────────────────────────
export interface ShiftDto {
  id: string
  participantId: string
  participantName: string
  /** Who has the shift. ABSENT for an unfilled shift: the server leaves a null out of the JSON (WhenWritingNull), so on the wire it is never `null`. Ask `isUnfilledShift(shift)` (pages/rostering/lib/roster), not `=== null`. */
  staffId?: string | null
  staffName?: string | null
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
  /** The finding codes the server stored when it saved this shift. The over-budget marker is read from these (`markerForAcknowledgedCodes`): `BUDGET_EMERGENCY` for an emergency or safety booking, `BUDGET_FORECAST_OVER` for one an Admin pushed past the budget with a written reason. Omitted when none. */
  acknowledgedFindingCodes?: string[]
  /** The Admin review of an emergency or safety booking past the budget; omitted for every other shift. */
  budgetReview?: BudgetReviewDto
  findings: RosterFindingDto[]
  /** True when this shift's assigned staff member has approved leave covering it — set after the
   * fact (leave approved after the assignment was made), so it's not necessarily reflected in
   * `findings` (those are computed at assign-time). Renders as a distinct "On leave" hole on the
   * board rather than a normal filled chip. */
  assigneeOnApprovedLeave: boolean
  /** True when the pattern this shift was generated from was made by an agreement revision; omitted for any other shift. With `sourceDraftVersion` it is what the shift panel says ("From agreement v2"): no read of the pattern is needed. */
  fromAgreement?: boolean
  /** The version of that revision. */
  sourceDraftVersion?: number
  /** What is still missing for this shift's participant (e.g. "Intake not complete"), shown verbatim as a
   * quiet warning. Omitted by the server when there is nothing missing. Never blocks a save in Warn mode. */
  readinessIssues?: string[]
  /** What the shift asks of a worker (gender, a driver, skills), copied from the pattern it was generated from: shown as chips, informational (nothing checks it yet). Absent when it asks for nothing. */
  requirements?: PlanBlockRequirements
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
    /** Provider-local WALL-CLOCK value, no zone: the digits are the answer. Read with lib/wallClock, never parseApiDate (DESIGN.md, "Time on the wire"). */
    incidentDateTime: string
  }[]
  // ── Shift package ──
  /** Breaks taken during this completion, oldest first. */
  breaks: ShiftBreakDto[]
  /** Whole minutes spent on breaks (a running break counts up to now). */
  breakMinutes: number
  /** Whole minutes worked: actual start to actual end (or now while in progress) minus breaks. Never negative. Billing stays on
   * ROSTERED hours — this is a record, not a billing input. */
  netWorkedMinutes: number
  /** The handover note the worker left for the next worker at Finish; null when none was written. */
  handoverText: string | null
  /** The worker confirmed "nothing to hand over". */
  nothingToHandOver: boolean
  /** The worker confirmed "nothing to note" instead of writing a shift note. */
  nothingToNoteConfirmed: boolean
}

/**
 * GET rostering/shifts/{id}/completion/review — everything a coordinator needs to review one submitted shift in a single
 * call: the completion (times, variance, breaks, net minutes, handover, incidents), every scheduled dose due in the rostered
 * window with its outcome, PRN doses given during the shift, and the shift notes. Approve / Return are unchanged.
 */
export interface ShiftCompletionReviewDto {
  completion: ShiftCompletionDto
  participantName: string
  staffName: string
  /** YYYY-MM-DD */
  serviceDate: string
  /** The provider's IANA zone; scheduled dose times are wall-clock values in it. */
  timeZoneId: string
  /** Scheduled doses in the rostered window, time order. `outcome: null` means nothing was recorded. */
  doses: PortalDoseSlotDto[]
  /** "As needed" (PRN) doses the submitting worker administered between the actual start and end. */
  prnDoses: ReviewPrnDoseDto[]
  notes: ShiftNoteDto[]
  /** The routines matched to the rostered window with the worker's tick state on this completion (`isChecked`, `checkedAt`, `checkedByName`):
   * critical first, then in time order. An unticked routine is one the worker did not tick off. After them come the ticks whose routine no longer
   * matches the shift (edited out of the window, retired or deleted since the worker ticked it), marked `fromTickSnapshot` and shown as they were
   * recorded: always `isChecked`, with the title and time of the tick. */
  routines: PortalShiftRoutineDto[]
}

export interface ReviewPrnDoseDto {
  medicationId: string
  medicationName: string
  strength: string | null
  doseDescription: string
  outcome: PortalDoseOutcomeDto
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
  /** Scheduled doses in the shift's ROSTERED window with no outcome recorded (any outcome counts; a superseded record is history). The review
   * (`GET rostering/shifts/{id}/completion/review`) lists them. */
  dosesWithoutOutcome: number
  /** Total minutes of breaks on the completion (same figure as `ShiftCompletionDto.breakMinutes`). */
  breakMinutes: number
  /** True when the worker never pressed Start and supplied the start time at Finish (the manual-start path). That path skips the dose checklist,
   * so the queue can flag the row next to `dosesWithoutOutcome` without opening the shift. Same flag as `ShiftCompletionDto.startWasManual`. */
  startWasManual: boolean
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
  shifts: ShiftDto[]          // includes unfilled ones (no staffId)
  tripBars: TripBarDto[]
  scheduledHours: number
  daysWithoutCover: number    // days in the week with no shift and no trip
  /** What is still missing for this participant (e.g. "No signed service agreement"), shown verbatim as a
   * quiet warning. Omitted by the server when there is nothing missing. */
  readinessIssues?: string[]
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
  /** Ignored by the server, which never takes a pattern link from a request: it sets the link itself when it generates a shift from a pattern. The roster panel never sends one. */
  shiftPatternId?: string | null
  notes?: string | null
  overrideReason: string | null
  acknowledgedFindingCodes: string[]
  /**
   * "Emergency or safety" (budget phase 3): save past the budget now and have an Admin review it afterwards. The description goes in `overrideReason` (at least 10 characters once trimmed). Only
   * means something when the check found the shift past the budget; the server refuses a description that is too short.
   */
  emergency?: boolean
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
  /** The status the shift would be saved with: a shift about to be cancelled costs nothing and gets no budget finding. Omitted means the shift's own status, or a new Draft. */
  status?: ShiftStatus
}

/** What the dry run answers: the findings, and, when the budget was not checked because the shift cannot be priced, the one informational line that says so (never a finding, never a block). */
export interface ShiftCheckResult {
  findings: RosterFindingDto[]
  /** "Budget not checked: sleepover shifts are not priced yet." Absent when the budget was checked, or there was nothing to check it against. */
  budgetNote?: string
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
  /** The agreement revision whose approval made this pattern (plan builder, phase D); absent for a hand-made or demo pattern. */
  sourceDraftId?: string
  sourceBlockKey?: string
  /** The version of that revision, for "From agreement v2". */
  sourceDraftVersion?: number
  /** Which of the workers a block asks for at once this pattern is (a 2:1 support is slots 1 and 2). */
  workerSlot?: number
  /** What the pattern's shifts ask of a worker, shown as chips; informational. Absent when it asks for nothing or was made by hand. */
  requirements?: PlanBlockRequirements
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
  /** Where the shifts just made take a pool past its funding for a period (budget phase 3), one entry for each pool and period. A warning only: the shifts are made. Omitted when there is nothing to say. */
  budgetWarnings?: BudgetWarningDto[]
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
