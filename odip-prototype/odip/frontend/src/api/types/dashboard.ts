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

