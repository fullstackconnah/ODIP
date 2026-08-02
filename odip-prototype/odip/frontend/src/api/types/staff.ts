import type { StaffRole, AvailabilityType, AssignmentStatus, SleepoverType } from './enums'

export interface StaffListDto {
  id: string
  firstName: string
  lastName: string
  fullName: string
  role: StaffRole
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
  hasExpiredQualifications: boolean
  notes: string | null
}

export type StaffDetailDto = StaffListDto

export interface CreateStaffDto {
  firstName: string
  lastName: string
  role: StaffRole
  email?: string
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
}

export interface UpdateStaffAssignmentDto extends CreateStaffAssignmentDto {
  status: AssignmentStatus
}
