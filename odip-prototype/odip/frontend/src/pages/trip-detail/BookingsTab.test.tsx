import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import BookingsTab from './BookingsTab'
import type { TripDetailDto } from '@/api/types/trips'
import type { BookingListDto } from '@/api/types/bookings'

// PF-10.6 — primary Client Overview PDF surface (Trip-detail roster). Only
// useDownloadClientOverviewPdf is asserted on directly here; the other hooks this file imports
// from '@/api/hooks' are stubbed inertly since this suite is about the new per-row action, not
// booking CRUD (which has no dedicated existing test file of its own to defer to, but is out of
// scope for PF-10.6).
const { mockDownloadMutate, mockUseDownloadClientOverviewPdf } = vi.hoisted(() => ({
  mockDownloadMutate: vi.fn(),
  mockUseDownloadClientOverviewPdf: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false })),
}))

vi.mock('@/api/hooks', () => ({
  useCreateBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useUpdateBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  usePatchBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useDeleteBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCancelBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useDownloadClientOverviewPdf: mockUseDownloadClientOverviewPdf,
  PAYMENT_STATUS_ITEMS: [
    { value: 'NotInvoiced', label: 'Not Invoiced' },
    { value: 'Invoiced', label: 'Invoiced' },
  ],
  PAYMENT_STATUS_COLORS: { NotInvoiced: 'bg-neutral-100 text-neutral-600', Invoiced: 'bg-blue-100 text-blue-700' },
}))

const trip = { id: 'trip-1', maxParticipants: 10, staffAssignedCount: 0 } as unknown as TripDetailDto

function makeBooking(overrides: Partial<BookingListDto> = {}): BookingListDto {
  return {
    id: 'booking-1', tripInstanceId: 'trip-1', tripName: 'Spring Coastal Trip',
    participantId: 'participant-1', participantName: 'Sophie Brown',
    bookingStatus: 'Confirmed', bookingDate: '2026-10-12', wheelchairRequired: false,
    highSupportRequired: false, nightSupportRequired: false, hasRestrictivePracticeFlag: false,
    supportRatioOverride: null, actionRequired: false, insuranceStatus: 'None', paymentStatus: 'NotInvoiced',
    ...overrides,
  }
}

function renderTab(bookings: BookingListDto[] = [makeBooking()]) {
  return render(
    <MemoryRouter>
      <BookingsTab tripId="trip-1" trip={trip} bookings={bookings} participants={[]} canWrite isReadOnly={false} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockDownloadMutate.mockReset()
  mockUseDownloadClientOverviewPdf.mockReturnValue({ mutate: mockDownloadMutate, isPending: false, isError: false })
})

describe('BookingsTab — PF-10.6 Client Overview PDF per-row action', () => {
  it('renders a Client Overview PDF action for each booking row', () => {
    renderTab()

    expect(screen.getByRole('button', { name: /client overview pdf/i })).toBeInTheDocument()
  })

  it('calls the client overview mutation with the participant id, the trip id, and a filename when clicked', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('button', { name: /client overview pdf/i }))

    expect(mockDownloadMutate).toHaveBeenCalledWith(
      { id: 'participant-1', tripId: 'trip-1', fileName: expect.stringContaining('.pdf') },
      expect.anything(),
    )
  })
})
