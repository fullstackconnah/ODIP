import type { TripListDto } from './trips'
import type { TaskDto } from './tasks'

export interface DashboardSummaryDto {
  upcomingTripCount: number
  activeParticipantCount: number
  outstandingTaskCount: number
  overdueTaskCount: number
  conflictCount: number
  tripsMissingAccommodation: number
  tripsMissingVehicles: number
  tripsMissingStaff: number
  openIncidentCount: number
  qscOverdueCount: number
  upcomingTrips: TripListDto[]
  overdueTasks: TaskDto[]
}

// ── Support Worker Dashboard ──

export interface DashboardAssignmentDto {
  assignmentId: string
  tripInstanceId: string
  tripName: string
  destination: string | null
  region: string | null
  startDate: string
  endDate: string
  durationDays: number
  tripStatus: string
  assignmentStatus: string
  assignmentRole: string | null
  isDriver: boolean
  sleepoverType: string | null
  shiftNotes: string | null
  group: string
  daysUntilStart: number
}

export interface QualificationItemDto {
  name: string
  status: string
  expiryDate: string | null
  daysUntilExpiry: number | null
}

export interface StaffDashboardDto {
  staffId: string
  fullName: string
  upcomingTripCount: number
  activeAssignmentCount: number
  nextTripCountdownDays: number | null
  activeTrip: DashboardAssignmentDto | null
  assignments: DashboardAssignmentDto[]
  qualifications: QualificationItemDto[]
}
