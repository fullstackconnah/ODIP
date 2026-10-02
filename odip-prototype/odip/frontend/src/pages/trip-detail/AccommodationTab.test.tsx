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

// R2-01 / R2-08: the Property cell (name, address, badges, comments) has no width of its own, and unwrapped it made this table 1275px wide
// with a one-line address and ~2000px with a two-sentence comment, pushing Ref and the row actions off-screen at 1280-1536. jsdom does no
// layout (the Playwright overflow audit measures it), so this pins the budget: the Property column wraps and its address line
// contributes nothing to the minimum width, and the two least useful columns give way below 1536px.
describe('AccommodationTab — column budget', () => {
  const trip = { startDate: '2026-10-10T00:00:00', endDate: '2026-10-14T00:00:00' } as TripDetailDto

  function renderTab(reservations: ReservationDto[]) {
    properties.length = 0
    properties.push(property({ address: '12 Beachfront Parade', suburb: 'Sunshine Beach' }))
    return render(
      <MemoryRouter>
        <AccommodationTab tripId="t1" trip={trip} accommodation={reservations} canWrite />
      </MemoryRouter>,
    )
  }

  it('lets the Property cell wrap (so a long comment stays under the property instead of widening the table) and caps its width', () => {
    renderTab([reservation({ comments: 'Ground floor rooms required for wheelchair users. Please call the manager on arrival.' })])
    const cell = screen.getByText(/Ground floor rooms required/).closest('td')!
    expect(cell.className).not.toContain('whitespace-nowrap')
    expect(screen.getByText(/Ground floor rooms required/).closest('div')).toHaveClass('md:max-w-[26rem]')
    // Every other body cell in the row still never wraps.
    const others = [...cell.parentElement!.querySelectorAll('td')].filter(td => td !== cell)
    expect(others.length).toBeGreaterThan(0)
    for (const td of others) expect(td.className).toContain('md:whitespace-nowrap')
  })

  it('takes the truncated address line out of the minimum width (w-0 + min-w-full) so it cannot pin the column at its cap', () => {
    renderTab([reservation()])
    const address = screen.getByText(/Noosa/)
    expect(address).toHaveClass('truncate', 'md:w-0', 'md:min-w-full')
  })

  // L3-04: Nights and Ref (the booking number a coordinator quotes to a venue) used to be deleted below 1536px.
  it('keeps Nights and Ref at every width, and caps Ref', () => {
    renderTab([reservation({ confirmationReference: 'CONF-88123' })])
    expect(screen.getByText('CONF-88123')).toHaveStyle('--cell-max: 8rem')
    for (const name of ['Property', 'Status', 'Check-in', 'Check-out', 'Nights', 'Cost', 'Bedrooms / Beds', 'Ref']) {
      expect(screen.getByRole('columnheader', { name }).className, name).not.toMatch(/hidden/)
    }
  })
})
