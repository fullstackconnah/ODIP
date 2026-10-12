import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import BookingsTab from './BookingsTab'
import type { TripDetailDto } from '@/api/types/trips'
import type { BookingListDto } from '@/api/types/bookings'

// TRIPS-8: a status, insurance or payment change the server refuses says why, in one banner above the roster that the next success clears.

const { patchMutate } = vi.hoisted(() => ({ patchMutate: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useCreateBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useUpdateBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  usePatchBooking: () => ({ mutate: patchMutate, isPending: false, isError: false }),
  useDeleteBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCancelBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useDownloadClientOverviewPdf: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  PAYMENT_STATUS_ITEMS: [{ value: 'NotInvoiced', label: 'Not Invoiced' }, { value: 'Invoiced', label: 'Invoiced' }],
  PAYMENT_STATUS_COLORS: { NotInvoiced: 'bg-neutral-100 text-neutral-600' },
}))

const trip = { id: 'trip-1', maxParticipants: 10, staffAssignedCount: 0, staffRequired: null, calculatedStaffRequired: 0 } as unknown as TripDetailDto

const booking: BookingListDto = {
  id: 'booking-1', tripInstanceId: 'trip-1', tripName: 'Coastal weekend', participantId: 'participant-1', participantName: 'Sophie Brown', bookingStatus: 'Held', bookingDate: '2026-10-12',
  wheelchairRequired: false, highSupportRequired: false, nightSupportRequired: false, hasRestrictivePracticeFlag: false, supportRatioOverride: null, actionRequired: false, insuranceStatus: 'None', paymentStatus: 'NotInvoiced',
}

const refused = { response: { status: 400, data: { message: 'This booking is locked.' } } }
type Callbacks = { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }
const refuse = () => patchMutate.mockImplementation((_v: unknown, o?: Callbacks) => o?.onError?.(refused))
const accept = () => patchMutate.mockImplementation((_v: unknown, o?: Callbacks) => o?.onSuccess?.({ data: {} }))

beforeEach(() => patchMutate.mockReset())

function renderTab() {
  return render(
    <MemoryRouter>
      <BookingsTab tripId="trip-1" trip={trip} bookings={[booking]} participants={[]} canWrite isReadOnly={false} />
    </MemoryRouter>,
  )
}

const pick = async (user: ReturnType<typeof userEvent.setup>, from: RegExp, to: string) => {
  await user.click(screen.getByRole('button', { name: from }))
  await user.click(await screen.findByRole('option', { name: to }))
}

describe('BookingsTab — a refused inline change', () => {
  it.each([
    ['status', /^Held/, 'Confirmed'],
    ['insurance', /^None/, 'Pending'],
    ['payment', /^Not Invoiced/, 'Invoiced'],
  ])('shows the server message when the %s change fails', async (_what, from, to) => {
    const user = userEvent.setup()
    refuse()
    renderTab()
    await pick(user, from, to)

    expect(screen.getByText(/Couldn't update Sophie Brown's booking\./)).toBeInTheDocument()
    expect(screen.getByText(/This booking is locked\./)).toBeInTheDocument()
  })

  it('clears the banner on the next change that succeeds', async () => {
    const user = userEvent.setup()
    refuse()
    renderTab()
    await pick(user, /^Held/, 'Confirmed')
    accept()
    await pick(user, /^None/, 'Pending')

    expect(screen.queryByText(/This booking is locked\./)).not.toBeInTheDocument()
  })
})
