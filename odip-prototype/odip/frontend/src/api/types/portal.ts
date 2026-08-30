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
} from './enums'
import type { ParticipantRoutineDto } from './routines'

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
  medications: PortalMedicationSummaryDto[]
}

// ── Witness approvals ────────────────────────────────────

export interface PortalWitnessRequestDto {
  id: string
  participantId: string
  participantName: string
  medicationId: string
  medicationName: string
  strength: string | null
  doseDescription: string
  doseGiven: string | null
  recordedByName: string
  administeredAt: string | null
  administeredAtTimeZone: string | null
  witnessStatus: WitnessStatus
  witnessRespondedAt: string | null
  createdAt: string
}
