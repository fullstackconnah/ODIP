import type {
  SupportRatio,
  SleepoverType,
  ShiftStatus,
  AssignmentStatus,
  OvernightSupportType,
  MedicationType,
  MedicationSupportLevel,
  DrugSchedule,
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

export interface PortalShiftsResponseDto {
  /** False when the caller's account has no linked Staff record — shifts/tripAssignments are always empty in that case. */
  isLinked: boolean
  staffId: string | null
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
