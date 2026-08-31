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
