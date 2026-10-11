import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BookingsPage from './BookingsPage'
import type { BookingListDto } from '@/api/types/bookings'

const booking = {
  id: 'booking-1', tripInstanceId: 'trip-1', tripName: 'Coastal weekend', participantId: 'participant-1', participantName: 'Sophie Brown',
  bookingStatus: 'NoLongerAttending', bookingDate: '2026-10-12', wheelchairRequired: false, highSupportRequired: false, nightSupportRequired: false,
} as unknown as BookingListDto

vi.mock('@/api/hooks', () => ({
  useBookings: () => ({ data: Object.assign([booking], { totalCount: 1 }), isLoading: false, isError: false }),
  usePatchBooking: () => ({ mutate: vi.fn(), isPending: false }),
}))

afterEach(() => localStorage.clear())

// Owner decision 2026-10-12: ReadOnly HIDES write controls. The status pill is a PATCH /bookings/:id the server refuses it.
describe('BookingsPage — the status by role', () => {
  it('shows ReadOnly the status as text, not a pill', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    render(<MemoryRouter><BookingsPage /></MemoryRouter>)
    expect(screen.getByText('No Longer Attending')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /No Longer Attending/ })).not.toBeInTheDocument()
  })

  it.each(['Admin', 'Coordinator'])('offers %s the pill', role => {
    localStorage.setItem('odip_user', JSON.stringify({ role }))
    render(<MemoryRouter><BookingsPage /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /No Longer Attending/ })).toBeInTheDocument()
  })
})
