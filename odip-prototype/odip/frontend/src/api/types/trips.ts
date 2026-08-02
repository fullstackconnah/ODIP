import type { TripStatus } from './enums'

export interface TripListDto {
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
  waitlistCount: number
  leadCoordinatorName: string | null
}

export interface TripDetailDto extends TripListDto {
  eventTemplateId: string | null
  eventTemplateName: string | null
  oopDueDate: string
  bookingCutoffDate: string | null
  leadCoordinatorId: string | null
  minParticipants: number | null
  requiredWheelchairCapacity: number | null
  requiredBeds: number | null
  requiredBedrooms: number | null
  minStaffRequired: number | null
  calculatedStaffRequired: number
  notes: string | null
  highSupportCount: number
  wheelchairCount: number
  overnightSupportCount: number
  staffAssignedCount: number
  outstandingTaskCount: number
  insuranceConfirmedCount: number
  insuranceOutstandingCount: number
  activeHoursPerDay: number
  departureTime: string | null
  returnTime: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateTripDto {
  tripName: string
  tripCode?: string
  eventTemplateId?: string
  destination?: string
  region?: string
  startDate: string
  durationDays: number
  bookingCutoffDate?: string
  leadCoordinatorId?: string
  minParticipants?: number
  maxParticipants?: number
  requiredWheelchairCapacity?: number
  requiredBeds?: number
  requiredBedrooms?: number
  minStaffRequired?: number
  notes?: string
}

export interface UpdateTripDto extends CreateTripDto {
  status: TripStatus
  departureTime?: string
  returnTime?: string
}

export interface PatchTripDto {
  status?: TripStatus
}
