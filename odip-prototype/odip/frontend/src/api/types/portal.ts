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
  incidentDateTime: string | null
  witnessStatus: WitnessStatus
  witnessRespondedAt: string | null
  createdAt: string
}
