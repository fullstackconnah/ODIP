import type { ReservationStatus } from './enums'

export interface ReservationDto {
  id: string
  tripInstanceId: string
  tripName: string | null
  accommodationPropertyId: string
  propertyName: string | null
  requestSentDate: string | null
  dateBooked: string | null
  dateConfirmed: string | null
  checkInDate: string
  checkOutDate: string
  bedroomsReserved: number | null
  bedsReserved: number | null
  cost: number | null
  confirmationReference: string | null
  reservationStatus: ReservationStatus
  comments: string | null
  cancellationReason: string | null
  hasOverlapConflict: boolean
}

export interface CreateReservationDto {
  tripInstanceId: string
  accommodationPropertyId: string
  requestSentDate?: string
  checkInDate: string
  checkOutDate: string
  bedroomsReserved?: number
  bedsReserved?: number
  cost?: number
  comments?: string
  reservationStatus?: ReservationStatus
}

export interface UpdateReservationDto extends CreateReservationDto {
  dateBooked?: string
  dateConfirmed?: string
  confirmationReference?: string
  cancellationReason?: string
}
