import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BookingsPage from './BookingsPage'
import type { BookingListDto } from '@/api/types/bookings'

const base = { tripInstanceId: 'trip-1', tripName: 'Coastal weekend', participantId: 'participant-1', bookingStatus: 'Confirmed', bookingDate: '2026-10-12' }
const bookings = [
  { ...base, id: 'b1', participantName: 'Sophie Brown', wheelchairRequired: true, highSupportRequired: false, nightSupportRequired: true },
  { ...base, id: 'b2', participantName: 'Liam Okafor', wheelchairRequired: false, highSupportRequired: false, nightSupportRequired: false },
] as unknown as BookingListDto[]

vi.mock('@/api/hooks', () => ({
  useBookings: () => ({ data: Object.assign([...bookings], { totalCount: 2 }), isLoading: false, isError: false }),
  usePatchBooking: () => ({ mutate: vi.fn(), isPending: false }),
}))

// Platform review VISUAL-1 (Bookings, phone): WC, High and Night printed as bare words whether true or not, so a booking with none read
// the same as one with all three. One Needs cell shows only what is needed, as chips.
describe('BookingsPage — needs and the phone card', () => {
  it('shows only the needs a booking has, as chips, and nothing for a booking with none', () => {
    render(<MemoryRouter><BookingsPage /></MemoryRouter>)

    const sophie = screen.getByRole('link', { name: 'Sophie Brown' }).closest('tr') as HTMLElement
    const needs = within(sophie).getByRole('list', { name: 'Needs' })
    expect(within(needs).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Wheelchair', 'Night support'])
    const liam = screen.getByRole('link', { name: 'Liam Okafor' }).closest('tr') as HTMLElement
    expect(within(liam).queryByRole('list', { name: 'Needs' })).not.toBeInTheDocument()
    for (const name of ['WC', 'High', 'Night']) expect(screen.queryByRole('columnheader', { name }), name).not.toBeInTheDocument()
  })

  it('makes the participant the card title with the status beside it, and trip, date and needs one muted line', () => {
    render(<MemoryRouter><BookingsPage /></MemoryRouter>)

    const sophie = screen.getByRole('link', { name: 'Sophie Brown' })
    expect(sophie.closest('td')).toHaveAttribute('data-card', 'primary')
    const row = sophie.closest('tr') as HTMLElement
    expect(within(row).getByRole('button', { name: /Confirmed/ }).closest('td')).toHaveAttribute('data-card', 'status')
    expect(within(row).getByRole('link', { name: 'Coastal weekend' }).closest('td')).toHaveAttribute('data-card', 'meta')
    expect(within(row).getByText('12/10/2026').closest('td')).toHaveAttribute('data-card', 'meta')
    expect(within(row).getByRole('list', { name: 'Needs' }).closest('td')).toHaveAttribute('data-card', 'meta')
  })
})
