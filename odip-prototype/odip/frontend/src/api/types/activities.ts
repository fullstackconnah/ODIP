import type { ScheduledActivityStatus, ActivityCategory } from './enums'

export interface TripDayDto {
  id: string
  tripInstanceId: string
  dayNumber: number
  date: string
  dayTitle: string | null
  dayNotes: string | null
  scheduledActivities: ScheduledActivityDto[]
}

export interface UpdateTripDayDto {
  dayTitle?: string
  dayNotes?: string
}

export interface ScheduledActivityDto {
  id: string
  tripDayId: string
  activityId: string | null
  title: string
  startTime: string | null
  endTime: string | null
  location: string | null
  accessibilityNotes: string | null
  notes: string | null
  sortOrder: number
  status: ScheduledActivityStatus
  bookingReference: string | null
  providerName: string | null
  providerPhone: string | null
  providerEmail: string | null
  providerWebsite: string | null
  estimatedCost: number | null
  category: ActivityCategory | null
}

export interface CreateScheduledActivityDto {
  activityId?: string
  title: string
  startTime?: string
  endTime?: string
  location?: string
  accessibilityNotes?: string
  notes?: string
  sortOrder: number
  status?: ScheduledActivityStatus
  bookingReference?: string
  providerName?: string
  providerPhone?: string
  providerEmail?: string
  providerWebsite?: string
  estimatedCost?: number
}

export interface UpdateScheduledActivityDto {
  activityId?: string
  title: string
  startTime?: string
  endTime?: string
  location?: string
  accessibilityNotes?: string
  notes?: string
  sortOrder: number
  status: ScheduledActivityStatus
  bookingReference?: string
  providerName?: string
  providerPhone?: string
  providerEmail?: string
  providerWebsite?: string
  estimatedCost?: number
}

export interface ActivityDto {
  id: string
  eventTemplateId: string | null
  activityName: string
  category: ActivityCategory
  location: string | null
  accessibilityNotes: string | null
  suitabilityNotes: string | null
  notes: string | null
  isActive: boolean
}

export interface CreateActivityDto {
  eventTemplateId?: string
  activityName: string
  category: ActivityCategory
  location?: string
  accessibilityNotes?: string
  suitabilityNotes?: string
  notes?: string
  isActive?: boolean
}

export type UpdateActivityDto = CreateActivityDto
