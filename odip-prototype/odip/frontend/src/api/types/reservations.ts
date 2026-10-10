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

/**
 * The body for PUT /reservations/{id}, which replaces the whole record: whatever it leaves out is stored as empty. Build every update from the reservation
 * itself and say only what changes, so a status change cannot erase a date or a reference.
 */
export function toUpdateReservationDto(r: ReservationDto, patch: Partial<UpdateReservationDto> = {}): UpdateReservationDto {
  return {
    tripInstanceId: r.tripInstanceId,
    accommodationPropertyId: r.accommodationPropertyId,
    requestSentDate: r.requestSentDate ?? undefined,
    checkInDate: r.checkInDate,
    checkOutDate: r.checkOutDate,
    bedroomsReserved: r.bedroomsReserved ?? undefined,
    bedsReserved: r.bedsReserved ?? undefined,
    cost: r.cost ?? undefined,
    reservationStatus: r.reservationStatus,
    comments: r.comments ?? undefined,
    dateBooked: r.dateBooked ?? undefined,
    dateConfirmed: r.dateConfirmed ?? undefined,
    confirmationReference: r.confirmationReference ?? undefined,
    cancellationReason: r.cancellationReason ?? undefined,
    ...patch,
  }
}
