import type {
  MedicationAdministrationStatus,
  MedicationForm,
  MedicationRoute,
  MedicationSupportLevel,
  RoutineCategory,
  WitnessStatus,
} from './enums'

// ══════════════════════════════════════════════════════════════
// SHIFT PACKAGE (PR 1: backend + API contract). The pieces the portal shift detail
// (`PortalShiftDetailDto`) and the coordinator's completion review (`ShiftCompletionReviewDto`)
// share. Mirrors backend Odip.Application/DTOs/PortalDTOs.cs and ShiftCompletionDTOs.cs.
//
// Conventions:
//  - A wall-clock time with no zone suffix ("2026-09-13T09:00:00", dose `scheduledAt`, routine
//    `occursAt`) is in the PROVIDER's time zone (`PortalShiftDetailDto.timeZoneId`) — do NOT run it
//    through parseApiDate (which would read it as UTC). Every instant in the shift-package DTOs
//    ("startedAt", "endedAt", "administeredAt", "recordedAt", "submittedAt", "readAt", "lastDoseAt",
//    "nextAvailableAt") is UTC ISO-8601 with a trailing Z. (Other, older timestamps in the portal and
//    completion DTOs, e.g. `completion.actualStart`, may arrive without a Z — keep using parseApiDate there.)
//  - Missing data is an explicit `null` — render "Not recorded", never a blank.
// ══════════════════════════════════════════════════════════════

// ── Breaks ──────────────────────────────────────────────────

/** One break inside a shift. `minutes` is whole minutes: for a running break, the time so far. */
export interface ShiftBreakDto {
  id: string
  /** UTC instant. */
  startedAt: string
  /** UTC instant; null while the break is running. */
  endedAt: string | null
  isRunning: boolean
  minutes: number
  /** Set when the times were edited after the break was created. */
  editedAt: string | null
  createdByUserId: string
}

/**
 * PUT portal/shifts/{id}/breaks/{breakId} body — corrected times as UTC instants. `endedAt: null` keeps a
 * RUNNING break running; an ended break must keep an end. Only while the shift is in progress.
 */
export interface EditShiftBreakDto {
  startedAt: string
  endedAt: string | null
}

// ── At a glance (need-to-know) ──────────────────────────────

export interface PortalAllergiesDto {
  detail: string | null
  /** Tri-state: true = anaphylaxis risk, false = recorded as no risk, null = not recorded. Never coerce null to false. */
  isAnaphylaxisRisk: boolean | null
  managementNotes: string | null
}

export interface PortalDietDto {
  chokingRiskDetail: string | null
  pegRegimeDetail: string | null
  modifiedDietDetail: string | null
  mealAssistanceDetail: string | null
  /** How medication is best given alongside food. */
  medicationTricks: string | null
}

export interface PortalCommunicationDto {
  expressiveSkills: string | null
  receptiveSkills: string | null
  readingAbility: string | null
  aids: string | null
}

export interface PortalBehaviourDto {
  triggers: string | null
  earlyWarningSigns: string | null
  deEscalationStrategies: string | null
  whatNotToDo: string | null
  whatHelpsMeCalmDown: string | null
}

/** HIDPA flags. A flag that is not set is false — the underlying data has no "not recorded" state for these. */
export interface PortalHidpaDto {
  epilepsy: boolean
  enteralFeeding: boolean
  dysphagia: boolean
}

export interface PortalAddressDto {
  street: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
}

/**
 * The critical care facts, in fixed groups. Every group is always present; any field inside may be null
 * ("Not recorded"). NEVER carries the NDIS number, plan, funding or the structured diagnoses (the need-to-know rule).
 * (The older `PortalParticipantSummaryDto.medicalSummary` is coordinator-written free text and is unchanged.)
 */
export interface PortalAtAGlanceDto {
  allergies: PortalAllergiesDto
  diet: PortalDietDto
  communication: PortalCommunicationDto
  behaviour: PortalBehaviourDto
  hidpa: PortalHidpaDto
  /** The participant's address; `null` when the shift withholds sensitive information (its status, or a Published shift more than 48 hours out: `PortalShiftDetailDto.sensitiveInfoWithheldReason`). */
  address: PortalAddressDto | null
}

/** One person to call, first call first: the participant's Emergency Contacts, or - when they have none - their Next of Kin. `mobile`/`phone` are nullable independently. */
export interface PortalEmergencyContactDto {
  id: string
  name: string
  relationship: string | null
  phone: string | null
  mobile: string | null
  isPrimary: boolean
  /** 1 = first call; null when no order was recorded (sorted after the ranked ones). */
  priorityOrder: number | null
  /** The contact role this entry comes from. A participant with NO Emergency Contact role falls back to their Next of Kin roles, so this is
   * `'NextOfKin'` for every entry of such a list (never a mix). */
  roleType: 'EmergencyContact' | 'NextOfKin'
  /** Plain-language role: "Emergency contact" or "Next of kin" (distinct from `relationship`, the free-text "Mother"). Show it so the worker
   * knows when they are calling next of kin rather than a nominated emergency contact. */
  roleLabel: string
}

// ── Doses ───────────────────────────────────────────────────

/** `Overdue` = unrecorded and more than 60 minutes past its provider-local time. */
export type PortalDoseState = 'Due' | 'Overdue' | 'Recorded'

/** A recorded outcome for a dose. `Missed` is how "not given" is recorded, with its reason; it is not a hand-over. */
export interface PortalDoseOutcomeDto {
  administrationId: string
  status: MedicationAdministrationStatus
  recordedByName: string
  /** UTC instant the dose was given (Administered records). */
  administeredAt: string | null
  administeredAtTimeZone: string | null
  /** UTC instant the record was made. */
  recordedAt: string
  reason: string | null
  doseGiven: string | null
  notes: string | null
  /** True when the recorder did not hold a current Medication Competency (provider Warn mode): accepted, and flagged for the coordinator. */
  recordedWithoutCompetency: boolean
}

export interface PortalDoseWitnessDto {
  /** High-risk medication: an administered dose needs a staff witness. */
  required: boolean
  /** Sign-off state of the recorded dose; null while nothing is recorded. */
  status: WitnessStatus | null
  witnessName: string | null
  requestedAt: string | null
  respondedAt: string | null
}

/** One scheduled dose due in the shift's rostered window. */
export interface PortalDoseSlotDto {
  medicationId: string
  medicationName: string
  strength: string | null
  doseDescription: string
  form: MedicationForm
  route: MedicationRoute
  directions: string | null
  supportLevel: MedicationSupportLevel
  isHighRisk: boolean
  /** Provider-local wall clock, no zone suffix — echo it back unchanged as `scheduledAt` when recording the dose. */
  scheduledAt: string
  /** "08:00". */
  scheduledTime: string
  state: PortalDoseState
  /** Convenience: `state === 'Overdue'`. */
  isOverdue: boolean
  outcome: PortalDoseOutcomeDto | null
  witness: PortalDoseWitnessDto
}

/** An "as needed" medication: no schedule, so no slots. */
export interface PortalPrnDto {
  medicationId: string
  medicationName: string
  strength: string | null
  doseDescription: string
  form: MedicationForm
  route: MedicationRoute
  directions: string | null
  supportLevel: MedicationSupportLevel
  isHighRisk: boolean
  indication: string | null
  maxDosesPer24h: number | null
  minIntervalMinutes: number | null
  dosesInLast24h: number
  /** UTC instant of the most recent administered dose. */
  lastDoseAt: string | null
  /** The maximum in any rolling 24 hours has been reached (another dose needs an acknowledged limit breach). */
  maxDosesReached: boolean
  /** UTC instant the minimum interval since the last dose elapses; null when there is no interval or it already has. */
  nextAvailableAt: string | null
  /** The newest administered dose still awaiting its outcome — for `POST medications/administrations/{id}/outcome`. */
  outcomePendingAdministrationId: string | null
}

/** A routine relevant to the shift window (matched on the server; overnight shifts handled). */
export interface PortalShiftRoutineDto {
  id: string
  title: string
  description: string
  category: RoutineCategory
  isCritical: boolean
  /** "HH:mm:ss", or null for an untimed critical routine. */
  startTime: string | null
  endTime: string | null
  /** Provider-local start of the first occurrence inside the window (clipped to the shift's start); null = "Anytime". */
  occursAt: string | null
  /** The occurrence falls on the day AFTER the shift's service date (an overnight shift's early hours). */
  afterMidnight: boolean
  /** The worker ticked this routine done. Persisted on the shift's completion (`POST portal/shifts/{id}/routines/{routineId}/check`). */
  isChecked: boolean
  /** UTC instant it was ticked; `null` when it is not. */
  checkedAt: string | null
  /** Who ticked it; `null` when it is not. */
  checkedByName: string | null
  /**
   * `true` only on the coordinator's review (`GET rostering/shifts/{id}/completion-review`): this tick's routine no longer matches the shift (it was
   * edited out of the window, retired or deleted after the worker ticked it), so the row is listed from what was recorded at the tick - the title and
   * occurrence time as they were. Always `false` on the worker's shift detail and for a routine that still applies.
   */
  fromTickSnapshot: boolean
}

// ── Handover ────────────────────────────────────────────────

/**
 * The latest handover for the participant, as the next worker sees it: from the most recent shift that STARTED BEFORE the caller's
 * own (shift chronology, not the time it was submitted). The read state is the CALLER's.
 */
export interface PortalHandoverDto {
  /** The completion the handover belongs to — send it back as `completionId` when acknowledging. */
  completionId: string
  /** Null when the author wrote none (`nothingToHandOver` says whether they said so explicitly). */
  text: string | null
  nothingToHandOver: boolean
  authorUserId: string
  authorName: string
  /** YYYY-MM-DD: the service date of the shift the handover came from. */
  shiftDate: string
  /** UTC instant the author finished their shift. */
  submittedAt: string
  /** True when there is text to read (a blank or "nothing to hand over" handover needs no acknowledgement). */
  requiresAcknowledgement: boolean
  isRead: boolean
  readAt: string | null
}

/** One holder in the custody trail (the last 3, most recent first, including the handover's author). Name and date only. */
export interface PortalHandoverTrailEntryDto {
  completionId: string
  workerName: string
  /** YYYY-MM-DD */
  shiftDate: string
}

/** POST portal/shifts/{id}/handover/ack body. Optional: omit to acknowledge the latest handover. */
export interface AcknowledgeHandoverDto {
  /** The handover the worker saw; if a newer one has arrived, the call is 409 SHIFT_HANDOVER_CHANGED and nothing is recorded. */
  completionId?: string | null
}

// ── Finish checklist ────────────────────────────────────────

export const FINISH_BLOCKER_CODES = ['DOSE_OUTCOME_MISSING', 'BREAK_RUNNING'] as const
export type FinishBlockerCode = typeof FINISH_BLOCKER_CODES[number]

/**
 * One thing that must be cleared before Finish. A dose blocker appears once the dose's time has arrived and only for a worker who can
 * record doses (`canRecordDoses`); a `BREAK_RUNNING` blocker has `medicationId`, `medicationName` and `scheduledAt` all `null`
 * (tell the two apart by `code`, or by `medicationId === null`).
 */
export interface PortalFinishBlockerDto {
  code: FinishBlockerCode
  message: string
  /** For a dose blocker. */
  medicationId: string | null
  medicationName: string | null
  /** For a dose blocker: the provider-local slot time (no zone suffix). */
  scheduledAt: string | null
}

// ── Error codes (ApiResponse.code) the shift package can return ─────────────

/** Machine-readable `code` values on failed shift-package responses. */
export const SHIFT_PACKAGE_ERROR_CODES = {
  /** 422 on Finish. `data` is the shift detail; `data.finishBlockers` is the list. */
  finishBlocked: 'SHIFT_FINISH_BLOCKED',
  /** 409 — finishing with no notes and no "nothing to note" confirmation (unchanged). */
  noteRequired: 'SHIFT_NOTE_REQUIRED',
  /** 400 on Finish — a handover text AND "nothing to hand over". */
  handoverConflict: 'SHIFT_HANDOVER_CONFLICT',
  /** 409 on handover ack — a newer handover exists; `data` is the refreshed shift. */
  handoverChanged: 'SHIFT_HANDOVER_CHANGED',
  /** 404 on handover ack — nothing to read. */
  handoverNotFound: 'SHIFT_HANDOVER_NOT_FOUND',
  breakAlreadyRunning: 'SHIFT_BREAK_ALREADY_RUNNING',
  breakNotFound: 'SHIFT_BREAK_NOT_FOUND',
  breakBeforeShiftStart: 'SHIFT_BREAK_BEFORE_SHIFT_START',
  breakInFuture: 'SHIFT_BREAK_IN_FUTURE',
  breakEndNotAfterStart: 'SHIFT_BREAK_END_NOT_AFTER_START',
  breakEndRequired: 'SHIFT_BREAK_END_REQUIRED',
  breakOverlap: 'SHIFT_BREAK_OVERLAP',
  /** 409 on a package write when the shift is not in progress (also SHIFT_ALREADY_FINISHED / _COMPLETED / SHIFT_CANCELLED). */
  shiftNotInProgress: 'SHIFT_NOT_IN_PROGRESS',
  /** 403 on recording a dose — the worker has no current Medication Competency. */
  competencyMissing: 'MEDICATION_COMPETENCY_MISSING',
  competencyExpired: 'MEDICATION_COMPETENCY_EXPIRED',
  competencyUnverifiable: 'MEDICATION_COMPETENCY_UNVERIFIABLE',
  /** 409 on recording a dose — the slot already has an ACTIVE record this request cannot supersede (only a record saying the dose was given,
   * Administered or WrongMedication, supersedes Refused, Withheld or Missed records; an Administered or WrongMedication record is never
   * superseded); `data` is the newest active record (an AdministrationDto). */
  administrationAlreadyRecorded: 'ADMINISTRATION_ALREADY_RECORDED',
  /** 409 on recording a dose — another request held this dose's slot lock for more than a few seconds (a stuck request, not a normal double tap,
   * which just waits a moment and then gets the first record). Nothing was written and `data` is null: look at the dose, then try again. */
  administrationSlotBusy: 'ADMINISTRATION_SLOT_BUSY',
  /** 400 — the idempotency key was used for a different medication. */
  idempotencyKeyReused: 'ADMINISTRATION_IDEMPOTENCY_KEY_REUSED',
  /** 404 on ticking or unticking a routine that is not one of the routines matched to the shift's window (`shiftRoutines`). */
  routineNotFound: 'SHIFT_ROUTINE_NOT_FOUND',
  /** 422 — `scheduledAt` is not one of the dose slots due in the shift window. */
  doseSlotNotDue: 'DOSE_SLOT_NOT_DUE',
  /** 422 — an Administered dose was charted more than 60 minutes before its slot (provider-local time). The message says when it can be recorded from. */
  administrationTooEarly: 'ADMINISTRATION_TOO_EARLY',
  /** 422 — `administeredAt` is more than 15 minutes in the future (up to 15 minutes ahead is stored as the server's now), or before the earliest the shift
   * allows: the earlier of the start of any of its completions and an hour before the rostered start (MAR path: before the start of the slot day, or an
   * hour before the slot when that is earlier). */
  administrationTimeOutOfRange: 'ADMINISTRATION_TIME_OUT_OF_RANGE',
  /** 409 — the medication is not Active. */
  medicationNotActive: 'MEDICATION_NOT_ACTIVE',
} as const
export type ShiftPackageErrorCode = typeof SHIFT_PACKAGE_ERROR_CODES[keyof typeof SHIFT_PACKAGE_ERROR_CODES]
