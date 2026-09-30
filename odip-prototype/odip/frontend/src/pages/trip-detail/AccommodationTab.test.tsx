import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReservationDto } from '@/api/types/reservations'
import type { AccommodationListDto } from '@/api/types/accommodation'
import type { TripDetailDto } from '@/api/types/trips'
import { reservationCountsLabel, reservedOfAvailable } from './reservationCounts'

const { properties, mutation } = vi.hoisted(() => ({
  properties: [] as unknown[],
  mutation: () => ({ mutate: () => undefined, mutateAsync: () => Promise.resolve(undefined), isPending: false, isError: false }),
}))

vi.mock('@/api/hooks', () => ({
  useAccommodation: () => ({ data: properties }),
  useCreateAccommodation: mutation,
  useCreateReservation: mutation,
  useUpdateReservation: mutation,
  useDeleteReservation: mutation,
  useCancelReservation: mutation,
}))

import AccommodationTab from './AccommodationTab'

const property = (over: Partial<AccommodationListDto> = {}): AccommodationListDto => ({
  id: 'ap1', propertyName: 'Sunshine Beach Retreat', location: 'Noosa', region: null, address: null, suburb: null, state: null, postcode: null,
  isFullyModified: false, isSemiModified: false, isWheelchairAccessible: false, bedroomCount: 4, bedCount: 8, maxCapacity: 10, isActive: true, ...over,
})

const reservation = (over: Partial<ReservationDto> = {}): ReservationDto => ({
  id: 'r1', tripInstanceId: 't1', tripName: 'Beach Escape', accommodationPropertyId: 'ap1', propertyName: 'Sunshine Beach Retreat',
  requestSentDate: null, dateBooked: null, dateConfirmed: null, checkInDate: '2026-10-10', checkOutDate: '2026-10-14',
  bedroomsReserved: null, bedsReserved: null, cost: null, confirmationReference: null, reservationStatus: 'Requested', comments: null,
  cancellationReason: null, hasOverlapConflict: false, ...over,
})

describe('reservedOfAvailable', () => {
  it('shows reserved of the property total, keeping an unrecorded reserved count as a dash', () => {
    expect(reservedOfAvailable(2, 4)).toBe('2 of 4')
    expect(reservedOfAvailable(null, 4)).toBe('— of 4')
    expect(reservedOfAvailable(0, 4)).toBe('0 of 4') // zero reserved is a recorded number, not "unknown"
  })

  it('leaves the total off when the property does not have one, and is a dash when neither side is known', () => {
    expect(reservedOfAvailable(2, null)).toBe('2')
    expect(reservedOfAvailable(2, undefined)).toBe('2')
    expect(reservedOfAvailable(null, null)).toBe('—')
    expect(reservedOfAvailable(undefined, 0)).toBe('—')
  })
})

describe('reservationCountsLabel', () => {
  it('never reads the property\'s counts as reserved: an unfilled reservation at a 4-bedroom / 8-bed property is not "4 / 8"', () => {
    expect(reservationCountsLabel(reservation(), property())).toBe('— of 4 / — of 8 (max 10)')
  })

  it('keeps the property total beside a partial reservation', () => {
    expect(reservationCountsLabel(reservation({ bedroomsReserved: 2, bedsReserved: 4 }), property())).toBe('2 of 4 / 4 of 8 (max 10)')
    expect(reservationCountsLabel(reservation({ bedroomsReserved: 2 }), property({ maxCapacity: null }))).toBe('2 of 4 / — of 8')
  })

  it('is a dash when there is nothing to say, and drops the totals of a property that has none', () => {
    expect(reservationCountsLabel(reservation(), undefined)).toBe('—')
    expect(reservationCountsLabel(reservation(), property({ bedroomCount: null, bedCount: null, maxCapacity: null }))).toBe('—')
    expect(reservationCountsLabel(reservation({ bedroomsReserved: 3, bedsReserved: 6 }), property({ bedroomCount: null, bedCount: null, maxCapacity: null }))).toBe('3 / 6')
  })
})

describe('AccommodationTab — Bedrooms / Beds column and row actions', () => {
  const trip = { startDate: '2026-10-10T00:00:00', endDate: '2026-10-14T00:00:00' } as TripDetailDto

  function renderTab(reservations: ReservationDto[]) {
    properties.length = 0
    properties.push(property())
    return render(
      <MemoryRouter>
        <AccommodationTab tripId="t1" trip={trip} accommodation={reservations} canWrite />
      </MemoryRouter>,
    )
  }

  const rowOf = (name: string) => screen.getAllByRole('row').find(r => within(r).queryByText(name))!

  it('shows what each reservation reserved out of what the property has, never the property\'s counts as reserved', () => {
    renderTab([
      reservation({ id: 'r-none', propertyName: 'Nothing reserved yet' }),
      reservation({ id: 'r-part', propertyName: 'Half booked', bedroomsReserved: 2, bedsReserved: 4 }),
    ])
    expect(within(rowOf('Nothing reserved yet')).getByText('— of 4 / — of 8 (max 10)')).toBeInTheDocument()
    expect(within(rowOf('Half booked')).getByText('2 of 4 / 4 of 8 (max 10)')).toBeInTheDocument()
    // The old merged rendering of an unfilled reservation.
    expect(screen.queryByText('4 / 8 (max 10)')).not.toBeInTheDocument()
  })

  it('renders "Remove reservation" as a destructive ghost button (red at rest and on hover), not a ghost that loses its colour', () => {
    renderTab([reservation()])
    const remove = screen.getByRole('button', { name: 'Remove reservation' })
    expect(remove).toHaveClass('text-[var(--color-destructive)]', 'hover:text-[var(--color-destructive)]', 'hover:bg-[var(--color-error-container)]')
    expect(remove).not.toHaveClass('text-[var(--color-muted-foreground)]')
    expect(remove).not.toHaveClass('hover:text-[var(--color-primary)]')
  })
})
