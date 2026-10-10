import type { Position, UserRole, AvailabilityType, AssignmentStatus, SleepoverType, ShiftStatus } from './enums'
import type { ScheduleAvailabilityItemDto } from './schedule'
import type { IncidentListDto } from './incidents'
import type { CompletionQueueItemDto } from './rostering'

// Post staff/user unification, a "staff" record IS a User account — see the design spec §5.
// `role` is the access-control role (Admin/Coordinator/SupportWorker/ReadOnly/SuperAdmin);
// `position` is the separate, display-only staff title. `username` is server-derived (see
// StaffController.Create) and is never an input field on Create/Update.
export interface StaffListDto {
  id: string
  firstName: string
  lastName: string
  fullName: string
  username: string
  role: UserRole
  position: Position
  email: string | null
  mobile: string | null
  region: string | null
  isDriverEligible: boolean
  isFirstAidQualified: boolean
  isMedicationCompetent: boolean
  isManualHandlingCompetent: boolean
  isOvernightEligible: boolean
  isActive: boolean
  firstAidExpiryDate: string | null
  driverLicenceExpiryDate: string | null
  manualHandlingExpiryDate: string | null
  medicationCompetencyExpiryDate: string | null
  workerScreeningNumber: string | null
  workerScreeningExpiryDate: string | null
  hasExpiredQualifications: boolean
  notes: string | null
}

export type StaffDetailDto = StaffListDto

export interface CreateStaffDto {
  firstName: string
  lastName: string
  /** Required — a staff record now IS a real login-capable account. */
  email: string
  /** The admin has checked an address the server asked about (see lib/addressConfirmation.ts). Sent only on the retry that follows that question. */
  addressConfirmed?: boolean
  role: UserRole
  position: Position
  mobile?: string
  region?: string
  isDriverEligible: boolean
  isFirstAidQualified: boolean
  isMedicationCompetent: boolean
  isManualHandlingCompetent: boolean
  isOvernightEligible: boolean
  isActive?: boolean
  notes?: string
  firstAidExpiryDate?: string
  driverLicenceExpiryDate?: string
  manualHandlingExpiryDate?: string
  medicationCompetencyExpiryDate?: string
  workerScreeningNumber?: string
  workerScreeningExpiryDate?: string
}

export type UpdateStaffDto = CreateStaffDto

export interface StaffAvailabilityDto {
  id: string
  staffId: string
  /** A calendar DATE held in a DateTime ("2026-10-03T00:00:00"): read the day with lib/dateOnly, never as an instant. */
  startDateTime: string
  /** A calendar DATE held in a DateTime ("2026-10-03T00:00:00"): read the day with lib/dateOnly, never as an instant. */
  endDateTime: string
  availabilityType: AvailabilityType
  isRecurring: boolean
  recurrenceNotes: string | null
  notes: string | null
}

export interface CreateStaffAvailabilityDto {
  staffId: string
  /** A calendar DATE held in a DateTime ("2026-10-03T00:00:00"): read the day with lib/dateOnly, never as an instant. */
  startDateTime: string
  /** A calendar DATE held in a DateTime ("2026-10-03T00:00:00"): read the day with lib/dateOnly, never as an instant. */
  endDateTime: string
  availabilityType: AvailabilityType
  isRecurring: boolean
  recurrenceNotes?: string
  notes?: string
}

export type UpdateStaffAvailabilityDto = CreateStaffAvailabilityDto

export interface StaffAssignmentDto {
  id: string
  tripInstanceId: string
  tripName: string | null
  staffId: string
  staffName: string | null
  assignmentRole: string | null
  assignmentStart: string
  assignmentEnd: string
  status: AssignmentStatus
  isDriver: boolean
  sleepoverType: SleepoverType
  shiftNotes: string | null
  hasConflict: boolean
  overrideReason: string | null
  acknowledgedFindingCodes: string | null
}

export interface CreateStaffAssignmentDto {
  tripInstanceId: string
  staffId: string
  assignmentRole?: string
  assignmentStart: string
  assignmentEnd: string
  isDriver: boolean
  sleepoverType?: SleepoverType
  shiftNotes?: string
  overrideReason?: string
  acknowledgedFindingCodes?: string[]
}

export interface UpdateStaffAssignmentDto extends CreateStaffAssignmentDto {
  status: AssignmentStatus
}

/** Dry-run input for POST /staff-assignments/check — mirrors CreateStaffAssignmentDto's shape. */
export interface CheckStaffAssignmentDto {
  staffId: string
  tripInstanceId: string
  assignmentStart: string
  assignmentEnd: string
  excludeAssignmentId?: string
}

/** Connection map item 12 — one row of GET /staff/{id}/overview's upcomingShifts (next 14 days). */
export interface StaffOverviewUpcomingShiftDto {
  shiftId: string
  serviceDate: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  participantId: string
  participantName: string
  status: ShiftStatus
}

/** Connection map item 12 — one row of GET /staff/{id}/overview's upcomingTripAssignments. */
export interface StaffOverviewTripAssignmentDto {
  assignmentId: string
  tripInstanceId: string
  tripName: string
  startDate: string
  endDate: string
}

/**
 * Connection map item 12 — GET /staff/{id}/overview, the staff hub's single data source. Mirrors
 * the participant hub's ParticipantDetailDto-plus-sub-resources shape, but pre-joined server-side
 * into one call rather than several tab-scoped hooks — see StaffDetailPage.tsx.
 */
export interface StaffOverviewDto {
  staff: StaffDetailDto
  /** Every Leave/RecurringUnavailability/legacy StaffAvailability row overlapping the next 90
   * days, all kinds — same shape AvailabilityList.tsx already renders. */
  availability: ScheduleAvailabilityItemDto[]
  upcomingShifts: StaffOverviewUpcomingShiftDto[]
  upcomingTripAssignments: StaffOverviewTripAssignmentDto[]
  /** Newest 10 incidents where this staff member is the involved user (not the reporter). */
  recentIncidents: IncidentListDto[]
  /** Last 10 shift completions submitted by this staff member. */
  recentCompletions: CompletionQueueItemDto[]
}

/**
 * The body for PUT /staff/{id}, which replaces the whole record: whatever it leaves out is stored as empty. Build every update from the list row and say only
 * what changes, so the next field added to the type is not wiped by a status click.
 */
export function toUpdateStaffDto(row: StaffListDto, patch: Partial<UpdateStaffDto> = {}): UpdateStaffDto {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email ?? '',
    role: row.role,
    position: row.position,
    mobile: row.mobile ?? undefined,
    region: row.region ?? undefined,
    isDriverEligible: row.isDriverEligible,
    isFirstAidQualified: row.isFirstAidQualified,
    isMedicationCompetent: row.isMedicationCompetent,
    isManualHandlingCompetent: row.isManualHandlingCompetent,
    isOvernightEligible: row.isOvernightEligible,
    isActive: row.isActive,
    notes: row.notes ?? undefined,
    firstAidExpiryDate: row.firstAidExpiryDate ?? undefined,
    driverLicenceExpiryDate: row.driverLicenceExpiryDate ?? undefined,
    manualHandlingExpiryDate: row.manualHandlingExpiryDate ?? undefined,
    medicationCompetencyExpiryDate: row.medicationCompetencyExpiryDate ?? undefined,
    workerScreeningNumber: row.workerScreeningNumber ?? undefined,
    workerScreeningExpiryDate: row.workerScreeningExpiryDate ?? undefined,
    ...patch,
  }
}
