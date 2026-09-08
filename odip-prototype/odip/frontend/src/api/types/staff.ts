import type { Position, UserRole, AvailabilityType, AssignmentStatus, SleepoverType } from './enums'

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
  startDateTime: string
  endDateTime: string
  availabilityType: AvailabilityType
  isRecurring: boolean
  recurrenceNotes: string | null
  notes: string | null
}

export interface CreateStaffAvailabilityDto {
  staffId: string
  startDateTime: string
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
