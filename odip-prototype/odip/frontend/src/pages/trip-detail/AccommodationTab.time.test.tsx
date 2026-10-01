import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReservationDto } from '@/api/types/reservations'
import type { TripDetailDto } from '@/api/types/trips'
import { restoreZone, setZone } from '@/test/timeZone'

const { mutation } = vi.hoisted(() => ({
  mutation: () => ({ mutate: () => undefined, mutateAsync: () => Promise.resolve(undefined), isPending: false, isError: false }),
}))

vi.mock('@/api/hooks', () => ({
  useAccommodation: () => ({ data: [] }),
  useCreateAccommodation: mutation,
  useCreateReservation: mutation,
  useUpdateReservation: mutation,
  useDeleteReservation: mutation,
  useCancelReservation: mutation,
}))

import AccommodationTab from './AccommodationTab'

afterEach(restoreZone)

const stay = (checkInDate: string, checkOutDate: string, id = `r-${checkInDate}`): ReservationDto => ({
  id, tripInstanceId: 't1', tripName: 'Beach Escape', accommodationPropertyId: 'ap1', propertyName: 'Sunshine Beach Retreat',
  requestSentDate: null, dateBooked: null, dateConfirmed: null, checkInDate, checkOutDate, bedroomsReserved: null, bedsReserved: null,
  cost: null, confirmationReference: null, reservationStatus: 'Confirmed', comments: null, cancellationReason: null, hasOverlapConflict: false,
})

function coverageLine(startDate: string, endDate: string, stays: ReservationDto[]): string {
  const trip = { startDate, endDate } as TripDetailDto
  render(
    <MemoryRouter>
      <AccommodationTab tripId="t1" trip={trip} accommodation={stays} canWrite />
    </MemoryRouter>,
  )
  return screen.getByText(/nights covered/).textContent ?? ''
}

// L4-03 = L3-05. Trip and stay dates are DateOnly ("2026-10-01"). The walk stepped with setDate (local calendar) and keyed each night with
// toISOString (the UTC date), so once a step crossed the Sydney clock change (Sun 4 Oct 02:00) every later night was keyed one day early:
// the trip's last night was never tested, and the 3rd was counted twice. A gap showed as covered ("All 7 nights covered") or as two gaps.
// Whole days are integers; the answer must not depend on the zone or the date.
describe.each(['Australia/Sydney', 'UTC', 'Australia/Brisbane', 'Australia/Lord_Howe', 'America/New_York'])('Stay Timeline coverage in %s', zone => {
  it('reports the LAST night uncovered (trip 1-8 Oct, stay 1-7 Oct): 6 / 7', () => {
    if (!setZone(zone)) return
    expect(coverageLine('2026-10-01', '2026-10-08', [stay('2026-10-01', '2026-10-07')])).toBe('6 / 7 nights covered')
  })

  it('reports two uncovered nights as two (trip 3-8 Oct, stay 3-6 Oct): 3 / 5', () => {
    if (!setZone(zone)) return
    expect(coverageLine('2026-10-03', '2026-10-08', [stay('2026-10-03', '2026-10-06')])).toBe('3 / 5 nights covered')
  })

  it('reports a single gap on the 3rd as one gap (stays 1-3 and 4-8 Oct): 6 / 7', () => {
    if (!setZone(zone)) return
    expect(coverageLine('2026-10-01', '2026-10-08', [stay('2026-10-01', '2026-10-03'), stay('2026-10-04', '2026-10-08')])).toBe('6 / 7 nights covered')
  })

  it('says all nights covered only when they are (trip 1-8 Oct, stay 1-8 Oct)', () => {
    if (!setZone(zone)) return
    expect(coverageLine('2026-10-01', '2026-10-08', [stay('2026-10-01', '2026-10-08')])).toBe('All 7 nights covered')
  })

  it('is right across the other clock change too (trip 1-8 Apr 2027, stay 1-7 Apr)', () => {
    if (!setZone(zone)) return
    expect(coverageLine('2027-04-01', '2027-04-08', [stay('2027-04-01', '2027-04-07')])).toBe('6 / 7 nights covered')
  })

  it('still reads a trip given as a date-time (the shape the older fixtures use)', () => {
    if (!setZone(zone)) return
    expect(coverageLine('2026-10-01T00:00:00', '2026-10-08T00:00:00', [stay('2026-10-01', '2026-10-07')])).toBe('6 / 7 nights covered')
  })
})
