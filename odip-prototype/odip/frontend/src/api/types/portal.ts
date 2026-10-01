import type {
  SupportRatio,
  SleepoverType,
  ShiftStatus,
  AssignmentStatus,
  OvernightSupportType,
  MedicationType,
  MedicationSupportLevel,
  DrugSchedule,
  WitnessStatus,
  IncidentType,
  IncidentSeverity,
} from './enums'
import type { ParticipantRoutineDto } from './routines'
import type { ParticipantRiskEntryDto } from './risk-entries'
import type { ShiftCompletionDto } from './rostering'
import type {
  ShiftBreakDto,
  PortalHandoverDto,
  PortalHandoverTrailEntryDto,
  PortalFinishBlockerDto,
  PortalAtAGlanceDto,
  PortalEmergencyContactDto,
  PortalDoseSlotDto,
  PortalPrnDto,
  PortalShiftRoutineDto,
} from './shift-package'

// ── My Shifts list ────────────────────────────────────────

export interface PortalShiftSummaryDto {
  id: string
  participantId: string
  participantName: string
  serviceDate: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  durationHours: number
  ratio: SupportRatio
  nightType: SleepoverType
  status: ShiftStatus
  notes: string | null
}

export interface PortalTripAssignmentSummaryDto {
  id: string
  tripInstanceId: string
  tripCode: string | null
  tripName: string
  assignmentStart: string
  assignmentEnd: string
  isDriver: boolean
  status: AssignmentStatus
}

/**
 * Post staff/user unification there is no separate "not linked" state — every User IS its own
 * staff identity — so a caller with no shifts simply gets empty lists here, with no special
 * messaging payload.
 */
export interface PortalShiftsResponseDto {
  shifts: PortalShiftSummaryDto[]
  tripAssignments: PortalTripAssignmentSummaryDto[]
}

// ── Shift detail ──────────────────────────────────────────

export interface PortalParticipantSummaryDto {
  id: string
  fullName: string
  isHighSupport: boolean
  isIntensiveSupport: boolean
  hasRestrictivePracticeFlag: boolean
  supportRatio: SupportRatio
  overnightSupport: OvernightSupportType
  mobilityAidWheelchair: boolean
  mobilityAidWalker: boolean
  mobilitySupportOptions: string[]
  requiresHiLoBed: boolean
  requiresHoist: boolean
  requiresShowerChair: boolean
  requiresCommode: boolean
  requiresStandingMachine: boolean
  mobilityNotes: string | null
  equipmentRequirements: string | null
  transportRequirements: string | null
  medicalSummary: string | null
  behaviourRiskSummary: string | null
}

export interface PortalMedicationSummaryDto {
  id: string
  name: string
  strength: string | null
  doseDescription: string | null
  type: MedicationType
  timesOfDay: string | null
  isHighRisk: boolean
  isPsychotropic: boolean
  isChemicalRestraint: boolean
  drugSchedule: DrugSchedule
  supportLevel: MedicationSupportLevel
  prnIndication: string | null
}

/**
 * NEED-TO-KNOW: the portal returns what a support worker needs to do THIS shift safely — the critical care facts
 * (`atAGlance`), emergency contacts, doses due, routines, risks and the previous worker's handover. It NEVER returns the NDIS
 * number, plan, funding or full diagnoses, and nothing about any participant other than the one on the caller's own shift.
 * Absent data is an explicit null ("Not recorded").
 */
export interface PortalShiftDetailDto {
  id: string
  serviceDate: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  durationHours: number
  ratio: SupportRatio
  nightType: SleepoverType
  status: ShiftStatus
  notes: string | null
  participant: PortalParticipantSummaryDto
  // Reuses the Task 2 routine shape — feed straight into getRelevantRoutines().
  routines: ParticipantRoutineDto[]
  // INTAKE-09. Active risk entries only — unlike routines these are not shift-window filtered,
  // since a risk applies regardless of time of day.
  riskEntries: ParticipantRiskEntryDto[]
  medications: PortalMedicationSummaryDto[]
  // ── Shift completion (design spec §2) ──
  /** The current active ShiftCompletion, or null before Start (or after a Return archives it
   * and the worker hasn't tapped Start again yet). */
  completion: ShiftCompletionDto | null
  returnCount: number
  /** Most recent Returned completion's reason, independent of `completion` (critique P2 — a
   * resubmitting worker needs to see WHY the last submission bounced, not just ReturnCount). Null
   * until the shift has been returned at least once. */
  lastReturnReason: string | null
  // ── Shift package (PR 1) ──
  /** Breaks in the shift's active completion, oldest first (empty before Start). Also on `completion.breaks`. */
  breaks: ShiftBreakDto[]
  /** The latest handover for this participant from a PREVIOUS shift, or null if there has never been one - or when `sensitiveInfoWithheldReason` is set. */
  handover: PortalHandoverDto | null
  /** The last 3 holders (most recent first, including the handover's author): name and shift date only. Empty when the handover is withheld. */
  handoverTrail: PortalHandoverTrailEntryDto[]
  /**
   * What still blocks Finish right now (only while InProgress; empty otherwise): a running break, and the doses that have COME DUE with no
   * outcome - for a worker who can record doses only (`canRecordDoses`). A dose still ahead does not block (it is recorded when it falls due). Finish answers
   * 422 while non-empty, by the same rule.
   */
  finishBlockers: PortalFinishBlockerDto[]
  /** The provider's IANA zone. Wall-clock fields in this DTO (`startTime`, dose `scheduledAt`, routine `occursAt`) are in it. */
  timeZoneId: string
  /** The critical care facts in fixed groups, with explicit nulls for anything not recorded. */
  atAGlance: PortalAtAGlanceDto
  /** Active emergency contacts, first call first. `null` (not an empty list) when the shift withholds sensitive information (its status, or a Published
   * shift more than 48 hours before its rostered start) - see `sensitiveInfoWithheldReason`; an empty list means the participant simply has none. */
  emergencyContacts: PortalEmergencyContactDto[] | null
  /** Scheduled doses due in the shift's rostered window, time order, with state (Due / Overdue / Recorded), outcome and witness
   * status. Overdue is judged in the provider's local time. */
  medicationsDue: PortalDoseSlotDto[]
  /** "As needed" medications (no schedule, so no slots). */
  prn: PortalPrnDto[]
  /** Routines relevant to the shift window, matched on the server (overnight shifts handled), critical first then time order.
   * `routines` still carries every active routine. */
  shiftRoutines: PortalShiftRoutineDto[]
  /**
   * Whether the caller may record doses, per the provider's Medication Competency mode. With a current credential: true. Without one:
   * in ENFORCE mode false (every administration answers 403); in WARN mode (the default) still TRUE - the dose is recorded and FLAGGED
   * (`recordedWithoutCompetency`), and `canRecordDosesReason` is the warning to show.
   */
  canRecordDoses: boolean
  /** Null with a current credential; else the refusal reason (`canRecordDoses` false) or the warning "Medication Competency not current — this record will be flagged" (true). */
  canRecordDosesReason: string | null
  /** MEDICATION_COMPETENCY_MISSING | MEDICATION_COMPETENCY_EXPIRED | MEDICATION_COMPETENCY_UNVERIFIABLE whenever the credential is not current (in both modes); null with a current one. */
  canRecordDosesReasonCode: string | null
  /**
   * NEED-TO-KNOW BY SHIFT STATUS AND TIME. The participant's handover, emergency contacts and address are returned ONLY for a shift the worker is doing
   * (InProgress) or is about to do: a Published shift shows them from 48 hours before its rostered start (so a shift rostered for next month does not).
   * For any other status (PendingReview, Completed, Cancelled, Draft), and for a Published shift further out than that, `handover`, `emergencyContacts`
   * and `atAGlance.address` are `null` (and `handoverTrail` is empty) and this is a plain-language reason to show instead - for a Published shift, from
   * when they will show (provider-local); `null` when nothing is withheld. The other at-a-glance care facts are unaffected. After Finish the returned
   * shift (PendingReview) no longer carries them. Acknowledging a handover that is not shown is 404 SHIFT_HANDOVER_NOT_FOUND.
   */
  sensitiveInfoWithheldReason: string | null
}

// ── Shift completion write bodies (design spec §2) ───────

/** POST portal/shifts/{id}/start body. */
export interface StartShiftDto {
  latitude?: number | null
  longitude?: number | null
  geolocationDeclined: boolean
}

/** POST portal/shifts/{id}/finish body. `actualStart` is supplied only on the manual-start path
 * (Start was skipped) — see the design spec §3; the PR2 UI never sends it (no dedicated control
 * for that path), but the field is modelled for contract completeness. */
export interface FinishShiftDto {
  latitude?: number | null
  longitude?: number | null
  geolocationDeclined: boolean
  actualStart?: string | null
  /** The handover note for the next worker (max 2000 chars). Blank is allowed — it is prompted but optional. The Finish form should set
   * `maxLength={2000}` on its textarea: a longer note is rejected by the framework before the action runs, as a ValidationProblemDetails 400
   * (no `code`; `errors` keyed by field), which `apiErrorMessages` in lib/shiftPackageErrors reads. */
  handoverText?: string | null
  /** "Nothing to hand over", confirmed explicitly. Mutually exclusive with a non-blank `handoverText` (400 SHIFT_HANDOVER_CONFLICT). */
  nothingToHandOver?: boolean
  /** "Nothing to note", confirmed explicitly: lets Finish proceed with no shift notes (otherwise 409 SHIFT_NOTE_REQUIRED). */
  nothingToNote?: boolean
}

// ── Witness approvals ────────────────────────────────────

/**
 * IN-7: a medication administration OR an incident report awaiting (or already given) the
 * caller's staff-witness sign-off, discriminated by `sourceType`. Medication-only and
 * incident-only fields are nullable so a single shape covers both sources — code branching on a
 * row should switch on `sourceType`, not on which fields happen to be non-null.
 */
export interface PortalWitnessRequestDto {
  id: string
  sourceType: 'Medication' | 'Incident'
  participantId: string
  participantName: string
  medicationId: string | null
  medicationName: string | null
  strength: string | null
  doseDescription: string | null
  doseGiven: string | null
  incidentReportId: string | null
  incidentTitle: string | null
  incidentType: IncidentType | null
  incidentSeverity: IncidentSeverity | null
  /** "Recorded by" for a medication row, "Reported by" for an incident row. */
  recordedByName: string
  administeredAt: string | null
  administeredAtTimeZone: string | null
  /** Provider-local WALL-CLOCK value, no zone: the digits are the answer. Read with lib/wallClock, never parseApiDate (DESIGN.md, "Time on the wire"). */
  incidentDateTime: string | null
  witnessStatus: WitnessStatus
  witnessRespondedAt: string | null
  createdAt: string
}
