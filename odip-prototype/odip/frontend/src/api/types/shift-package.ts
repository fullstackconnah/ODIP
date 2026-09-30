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
 * ("Not recorded"). NEVER carries the NDIS number, plan, funding or full diagnoses (the need-to-know rule).
 */
export interface PortalAtAGlanceDto {
  allergies: PortalAllergiesDto
  diet: PortalDietDto
  communication: PortalCommunicationDto
  behaviour: PortalBehaviourDto
  hidpa: PortalHidpaDto
  address: PortalAddressDto
}

/** One emergency contact, first call first. `mobile`/`phone` are nullable independently. */
export interface PortalEmergencyContactDto {
  id: string
  name: string
  relationship: string | null
  phone: string | null
  mobile: string | null
  isPrimary: boolean
  /** 1 = first call; null when no order was recorded (sorted after the ranked ones). */
  priorityOrder: number | null
}

// ── Doses ───────────────────────────────────────────────────

/** `Overdue` = unrecorded and more than 60 minutes past its provider-local time. */
export type PortalDoseState = 'Due' | 'Overdue' | 'Recorded'

/** A recorded outcome for a dose. `Missed` is also how "not given this shift" is recorded, with its reason. */
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
}

// ── Handover ────────────────────────────────────────────────

/** The latest handover for the participant, as the next worker sees it. The read state is the CALLER's. */
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
  /** 409 on recording a dose — the slot already has a record; `data` is that record (an AdministrationDto). */
  administrationAlreadyRecorded: 'ADMINISTRATION_ALREADY_RECORDED',
  /** 400 — the idempotency key was used for a different medication. */
  idempotencyKeyReused: 'ADMINISTRATION_IDEMPOTENCY_KEY_REUSED',
  /** 422 — `scheduledAt` is not one of the dose slots due in the shift window. */
  doseSlotNotDue: 'DOSE_SLOT_NOT_DUE',
  /** 409 — the medication is not Active. */
  medicationNotActive: 'MEDICATION_NOT_ACTIVE',
} as const
export type ShiftPackageErrorCode = typeof SHIFT_PACKAGE_ERROR_CODES[keyof typeof SHIFT_PACKAGE_ERROR_CODES]
