import { describe, expect, it } from 'vitest'
import { toUpdateReservationDto, type ReservationDto } from './reservations'

// UpdateReservation is a full-replace PUT: whatever the body leaves out is stored as empty. The hand-built bodies left out the booked and confirmed dates,
// so "Cancel reservation" ("keeps the record for history") erased them.

const stored: ReservationDto = {
  id: 'r1', tripInstanceId: 't1', tripName: 'Beach Escape', accommodationPropertyId: 'ap1', propertyName: 'Sunshine Beach Retreat',
  requestSentDate: '2026-08-20', dateBooked: '2026-09-01', dateConfirmed: '2026-09-05', checkInDate: '2026-10-10', checkOutDate: '2026-10-14',
  bedroomsReserved: 2, bedsReserved: 4, cost: 1200, confirmationReference: 'ABC123', reservationStatus: 'Confirmed', comments: 'Late arrival',
  cancellationReason: 'Weather', hasOverlapConflict: false,
}

describe('toUpdateReservationDto', () => {
  it('carries every stored field, so changing the status cannot erase a date or a reference', () => {
    expect(toUpdateReservationDto(stored, { reservationStatus: 'Cancelled' })).toEqual({
      tripInstanceId: 't1', accommodationPropertyId: 'ap1', requestSentDate: '2026-08-20', dateBooked: '2026-09-01', dateConfirmed: '2026-09-05',
      checkInDate: '2026-10-10', checkOutDate: '2026-10-14', bedroomsReserved: 2, bedsReserved: 4, cost: 1200, confirmationReference: 'ABC123',
      reservationStatus: 'Cancelled', comments: 'Late arrival', cancellationReason: 'Weather',
    })
  })

  it('leaves out what is empty on the record, and lets the patch set or clear a field', () => {
    const blank = { ...stored, dateBooked: null, cost: null, comments: null }

    const dto = toUpdateReservationDto(blank, { cost: 90, dateConfirmed: undefined })

    expect(dto.dateBooked).toBeUndefined()
    expect(dto.cost).toBe(90)
    expect(dto.dateConfirmed).toBeUndefined()
    expect(dto).not.toHaveProperty('tripName')
    expect(dto).not.toHaveProperty('hasOverlapConflict')
  })
})
