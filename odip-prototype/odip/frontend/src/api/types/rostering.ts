import type { SupportRatio, SleepoverType, ShiftStatus, CompatibilityLevel, RosterFindingSeverity, RosterComplianceLevel } from './enums'

// ── Roster Finding ───────────────────────────────────────
export interface RosterFindingDto {
  code: string
  severity: RosterFindingSeverity
  message: string
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
  availabilityType: string
  notes: string | null
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

export interface RosterExceptionDto {
  shiftId: string | null
  participantName: string
  serviceDate: string
  finding: RosterFindingDto
}

export interface RosterBoardDto {
  weekStart: string
  days: string[]
  rows: RosterStaffRowDto[]
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
