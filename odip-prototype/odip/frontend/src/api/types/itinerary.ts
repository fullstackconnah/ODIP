import type { TripStatus, SupportRatio, ReservationStatus, VehicleType, VehicleAssignmentStatus, AssignmentStatus, SleepoverType, ActivityCategory, ScheduledActivityStatus } from './enums'

export interface ItineraryDto {
  tripId: string
  tripName: string
  tripCode: string | null
  destination: string | null
  region: string | null
  startDate: string
  endDate: string
  durationDays: number
  status: TripStatus
  leadCoordinatorName: string | null
  notes: string | null
  participantCount: number
  staffCount: number
  totalEstimatedCost: number
  participants: ItineraryParticipantDto[]
  accommodation: ItineraryAccommodationDto[]
  vehicles: ItineraryVehicleDto[]
  staff: ItineraryStaffDto[]
  days: ItineraryDayDto[]
}

export interface ItineraryParticipantDto {
  id: string
  name: string
  wheelchairRequired: boolean
  highSupportRequired: boolean
  nightSupportRequired: boolean
  supportRatio: SupportRatio | null
  mobilityNotes: string | null
  medicalSummary: string | null
}

export interface ItineraryAccommodationDto {
  propertyName: string
  address: string | null
  suburb: string | null
  state: string | null
  phone: string | null
  checkInDate: string
  checkOutDate: string
  bedroomsReserved: number | null
  bedsReserved: number | null
  confirmationReference: string | null
  reservationStatus: ReservationStatus
  cost: number | null
  comments: string | null
}

export interface ItineraryVehicleDto {
  vehicleName: string
  registration: string | null
  vehicleType: VehicleType
  totalSeats: number
  wheelchairPositions: number
  driverName: string | null
  status: VehicleAssignmentStatus
  pickupTravelNotes: string | null
}

export interface ItineraryStaffDto {
  name: string
  role: string | null
  email: string | null
  mobile: string | null
  assignmentStart: string
  assignmentEnd: string
  isDriver: boolean
  sleepoverType: SleepoverType
  status: AssignmentStatus
}

export interface ItineraryDayDto {
  dayNumber: number
  date: string
  dayTitle: string | null
  dayNotes: string | null
  activities: ItineraryActivityDto[]
  accommodationEvents: ItineraryDayAccommodationEventDto[]
  staffOnDuty: string[]
}

export interface ItineraryActivityDto {
  title: string
  startTime: string | null
  endTime: string | null
  location: string | null
  category: ActivityCategory | null
  status: ScheduledActivityStatus
  accessibilityNotes: string | null
  notes: string | null
  bookingReference: string | null
  providerName: string | null
  providerPhone: string | null
  estimatedCost: number | null
}

export interface ItineraryDayAccommodationEventDto {
  eventType: string
  propertyName: string
  address: string | null
  confirmationReference: string | null
}
