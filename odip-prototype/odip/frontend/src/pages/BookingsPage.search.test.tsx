import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BookingsPage from './BookingsPage'
import type { BookingListDto } from '@/api/types/bookings'

const { mockUseBookings } = vi.hoisted(() => ({ mockUseBookings: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useBookings: mockUseBookings,
  usePatchBooking: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const booking = {
  id: 'booking-1', tripInstanceId: 'trip-1', tripName: 'Coastal weekend', participantId: 'participant-1', participantName: 'Sophie Brown',
  bookingStatus: 'Confirmed', bookingDate: '2026-10-12', wheelchairRequired: false, highSupportRequired: false, nightSupportRequired: false,
} as unknown as BookingListDto
const list = (rows: BookingListDto[], totalCount = rows.length) => ({ data: Object.assign(rows, { totalCount }), isLoading: false, isError: false })

beforeEach(() => {
  mockUseBookings.mockReset()
})

// VISUAL-1 V4: the only list with no search. The list is paged on the server, so the search is a server parameter, in the PageHeader.
describe('BookingsPage — search', () => {
  it('asks the server for the search from page 1, and says when nothing matches', () => {
    mockUseBookings.mockReturnValue(list([booking], 120))
    render(<MemoryRouter><BookingsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(mockUseBookings).toHaveBeenLastCalledWith({ page: '2', pageSize: '50' })

    mockUseBookings.mockReturnValue(list([]))
    fireEvent.change(screen.getByPlaceholderText('Search participants or trips...'), { target: { value: ' sophie ' } })

    expect(mockUseBookings).toHaveBeenLastCalledWith({ page: '1', pageSize: '50', search: 'sophie' })
    expect(screen.getByText('No results for your search')).toBeInTheDocument()
    expect(screen.queryByText('No bookings yet')).not.toBeInTheDocument()
  })
})
