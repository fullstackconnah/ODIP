import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import BookingsTab from './BookingsTab'
import type { TripDetailDto } from '@/api/types/trips'
import type { BookingListDto } from '@/api/types/bookings'
import type { ParticipantListDto } from '@/api/types/participants'
import { BUDGET_WARNINGS_TITLE } from '@/components/BudgetWarnings'
import { SERVER_PERIOD, asWritten } from '@/test/fixtures/budgets'

// Confirming a booking on a trip says what it does to the participant's budget (budget phase 3): in the response of the write that confirms it, shown as a warning that can be dismissed. It never blocks.

const { createMutate, updateMutate, patchMutate } = vi.hoisted(() => ({ createMutate: vi.fn(), updateMutate: vi.fn(), patchMutate: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useCreateBooking: () => ({ mutate: createMutate, isPending: false, isError: false }),
  useUpdateBooking: () => ({ mutate: updateMutate, isPending: false, isError: false }),
  usePatchBooking: () => ({ mutate: patchMutate, isPending: false, isError: false }),
  useDeleteBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCancelBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useDownloadClientOverviewPdf: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  PAYMENT_STATUS_ITEMS: [{ value: 'NotInvoiced', label: 'Not Invoiced' }],
  PAYMENT_STATUS_COLORS: { NotInvoiced: 'bg-neutral-100 text-neutral-600' },
}))

const trip = { id: 'trip-1', maxParticipants: 10, staffAssignedCount: 0, minStaffRequired: null, calculatedStaffRequired: 0 } as unknown as TripDetailDto

const booking: BookingListDto = {
  id: 'booking-1', tripInstanceId: 'trip-1', tripName: 'Coastal weekend', participantId: 'participant-1', participantName: 'Sophie Brown', bookingStatus: 'Held', bookingDate: '2026-10-12',
  wheelchairRequired: false, highSupportRequired: false, nightSupportRequired: false, hasRestrictivePracticeFlag: false, supportRatioOverride: null, actionRequired: false, insuranceStatus: 'None', paymentStatus: 'NotInvoiced',
}

const participant = { id: 'participant-2', fullName: 'Noah Reid', isActive: true } as unknown as ParticipantListDto

const warning = {
  poolName: 'Core (flexible)', periodStart: '2026-10-01', periodEnd: '2026-12-31', available: 1000, used: 0, forecast: 1440, added: 1440, overBy: 440, count: 1,
  message: `This booking takes Core (flexible) to $1,440.00 of $1,000.00 for ${SERVER_PERIOD}.`,
}

type Callbacks = { onSuccess?: (response: unknown) => void }
const answerWith = (mutate: typeof patchMutate, response: unknown) => mutate.mockImplementation((_vars: unknown, opts?: Callbacks) => opts?.onSuccess?.(response))

function renderTab() {
  return render(
    <MemoryRouter>
      <BookingsTab tripId="trip-1" trip={trip} bookings={[booking]} participants={[participant]} canWrite isReadOnly={false} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  createMutate.mockReset()
  updateMutate.mockReset()
  patchMutate.mockReset()
})

describe('BookingsTab — the budget warning of a booking just confirmed', () => {
  it('shows the server’s warning when the row’s status is changed to Confirmed, and says the booking is confirmed', async () => {
    const user = userEvent.setup()
    answerWith(patchMutate, { data: { participantName: 'Sophie Brown', bookingStatus: 'Confirmed', budgetWarnings: [warning] } })
    renderTab()

    await user.click(screen.getByRole('button', { name: /Held/ }))
    await user.click(await screen.findByRole('option', { name: 'Confirmed' }))

    expect(patchMutate).toHaveBeenCalledWith({ id: 'booking-1', data: { bookingStatus: 'Confirmed' } }, expect.objectContaining({ onSuccess: expect.any(Function) }))
    expect(screen.getByText(`This booking takes Core (flexible) to $1,440.00 of $1,000.00 for ${SERVER_PERIOD}.`, { normalizer: asWritten })).toBeInTheDocument()
    expect(screen.getByText('This is a warning only. Sophie Brown’s booking is confirmed.')).toBeInTheDocument()
  })

  it('shows the warning of a booking added as Confirmed, after the form has closed', async () => {
    const user = userEvent.setup()
    answerWith(createMutate, { data: { participantName: 'Noah Reid', bookingStatus: 'Confirmed', budgetWarnings: [warning] } })
    renderTab()

    await user.click(screen.getByRole('button', { name: /Add Participant/ }))
    await user.click(screen.getByRole('combobox', { name: /Participant/ }))
    await user.click(await screen.findByRole('option', { name: 'Noah Reid' }))
    await user.click(screen.getByLabelText('Booking Status'))
    await user.click(await screen.findByRole('option', { name: 'Confirmed' }))
    await user.click(screen.getByRole('button', { name: 'Add Booking' }))

    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({ participantId: 'participant-2', tripInstanceId: 'trip-1', bookingStatus: 'Confirmed' }), expect.anything())
    expect(screen.queryByText('Add Participant to Trip')).not.toBeInTheDocument()
    expect(screen.getByText('This is a warning only. Noah Reid’s booking is confirmed.')).toBeInTheDocument()
  })

  it('shows nothing when the server sent no warning, and can be dismissed when it did', async () => {
    const user = userEvent.setup()
    answerWith(patchMutate, { data: { participantName: 'Sophie Brown', bookingStatus: 'Confirmed' } })
    renderTab()
    await user.click(screen.getByRole('button', { name: /Held/ }))
    await user.click(await screen.findByRole('option', { name: 'Confirmed' }))
    expect(screen.queryByText(BUDGET_WARNINGS_TITLE)).not.toBeInTheDocument()

    answerWith(patchMutate, { data: { participantName: 'Sophie Brown', bookingStatus: 'Confirmed', budgetWarnings: [warning] } })
    await user.click(screen.getByRole('button', { name: /Held/ }))
    await user.click(await screen.findByRole('option', { name: 'Confirmed' }))
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByText(BUDGET_WARNINGS_TITLE)).not.toBeInTheDocument()
  })
})
