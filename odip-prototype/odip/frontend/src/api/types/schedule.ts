import type { TripStatus, StaffRole, VehicleType, AssignmentStatus, VehicleAssignmentStatus } from './enums'
import type { StaffAvailabilityDto } from './staff'

export interface ScheduleOverviewDto {
  trips: ScheduleTripDto[]
  staff: ScheduleStaffDto[]
  vehicles: ScheduleVehicleDto[]
}

export interface ScheduleTripDto {
  id: string
  tripName: string
  tripCode: string | null
  destination: string | null
  region: string | null
  startDate: string
  endDate: string
  durationDays: number
  status: TripStatus
  maxParticipants: number | null
  currentParticipantCount: number
  minStaffRequired: number | null
  staffRequired: number | null
  staffAssignedCount: number
  vehicleAssignedCount: number
  leadCoordinatorName: string | null
  preferenceMatchCount: number
}

export interface TripPreferenceDto {
  tripId: string
  participantCount: number
}

export interface ScheduleStaffDto {
  id: string
  firstName: string
  lastName: string
  fullName: string
  role: StaffRole
  region: string | null
  isDriverEligible: boolean
  isFirstAidQualified: boolean
  isMedicationCompetent: boolean
  isManualHandlingCompetent: boolean
  isOvernightEligible: boolean
  tripStatuses: ScheduleStaffTripStatusDto[]
  availability: StaffAvailabilityDto[]
  preferredForTrips: TripPreferenceDto[]
}

export interface ScheduleStaffTripStatusDto {
  tripId: string
  status: string
  assignmentRole: string | null
  assignmentStatus: AssignmentStatus | null
  assignmentId: string | null
}

export interface ScheduleVehicleDto {
  id: string
  vehicleName: string
  registration: string | null
  vehicleType: VehicleType
  totalSeats: number
  wheelchairPositions: number
  isInternal: boolean
  tripStatuses: ScheduleVehicleTripStatusDto[]
}

export interface ScheduleVehicleTripStatusDto {
  tripId: string
  status: string
  assignmentStatus: VehicleAssignmentStatus | null
}
