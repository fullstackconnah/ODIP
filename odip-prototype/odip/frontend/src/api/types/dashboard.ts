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


/** GET /dashboard/setup: what the dashboard's Get set up card reads (counts for one organisation, never rows). */
export interface SetupStatusDto {
  staffCount: number
  participantCount: number
  participantsWithPlanCount: number
  /** Monday of the first week with a shift past Draft; null while nothing has been published. */
  firstPublishedWeekStart: string | null
  hasInvoice: boolean
  employmentHeroAvailable: boolean
}
