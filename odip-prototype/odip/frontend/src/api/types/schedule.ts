import type { TripStatus, Position, VehicleType, AssignmentStatus, VehicleAssignmentStatus, AvailabilityType } from './enums'
import type { LeaveStatus, LeaveType } from './leave'

// ── Unified read-only availability (schedule accordion) ────────
// Every one of a staff member's Leave/RecurringUnavailability/legacy StaffAvailability records
// that overlaps the schedule window, already ordered by the backend — see
// AvailabilityList.tsx, the read-only successor to the old per-row editor.

export type ScheduleAvailabilityKind = 'Leave' | 'RecurringRule' | 'Legacy'

export interface ScheduleAvailabilityItemDto {
  id: string
  kind: ScheduleAvailabilityKind
  status: LeaveStatus | null          // 'Pending' | 'Approved' for Leave/RecurringRule; null for Legacy
  leaveType: LeaveType | null         // Leave only
  availabilityType: AvailabilityType | null // Legacy only
  startDate: string                   // 'YYYY-MM-DD' — Leave start | rule effectiveFrom | legacy start date
  endDate: string | null              // Leave end | rule effectiveTo (may be open-ended) | legacy end date
  dayOfWeek: string | null            // RecurringRule only, e.g. 'Monday'
  startTime: string | null            // RecurringRule only, 'HH:mm:ss'
  endTime: string | null
  notes: string | null
}

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
  role: Position
  region: string | null
  isDriverEligible: boolean
  isFirstAidQualified: boolean
  isMedicationCompetent: boolean
  isManualHandlingCompetent: boolean
  isOvernightEligible: boolean
  tripStatuses: ScheduleStaffTripStatusDto[]
  availability: ScheduleAvailabilityItemDto[]
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
