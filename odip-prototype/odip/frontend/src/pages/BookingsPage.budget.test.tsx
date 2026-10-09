import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import BookingsPage from './BookingsPage'
import type { BookingListDto } from '@/api/types/bookings'
import { BUDGET_WARNINGS_TITLE } from '@/components/BudgetWarnings'
import { SERVER_PERIOD, asWritten } from '@/test/fixtures/budgets'

// Confirming a booking from the list says what it does to the participant's budget (budget phase 3), as a warning that can be dismissed. It never blocks: the status change has already gone through.

const { patchMutate, listed } = vi.hoisted(() => ({ patchMutate: vi.fn(), listed: { rows: [] as unknown[] } }))

vi.mock('@/api/hooks', () => ({
  useBookings: () => ({ data: Object.assign([...listed.rows], { totalCount: listed.rows.length }), isLoading: false, isError: false }),
  usePatchBooking: () => ({ mutate: patchMutate, isPending: false }),
}))

const booking: BookingListDto = {
  id: 'booking-1', tripInstanceId: 'trip-1', tripName: 'Coastal weekend', participantId: 'participant-1', participantName: 'Sophie Brown', bookingStatus: 'Held', bookingDate: '2026-10-12',
  wheelchairRequired: false, highSupportRequired: false, nightSupportRequired: false, hasRestrictivePracticeFlag: false, supportRatioOverride: null, actionRequired: false, insuranceStatus: 'None', paymentStatus: 'NotInvoiced',
}

const warning = {
  poolName: 'Core (flexible)', periodStart: '2026-10-01', periodEnd: '2026-12-31', available: 1000, used: 0, forecast: 1440, added: 1440, overBy: 440, count: 1,
  message: `This booking takes Core (flexible) to $1,440.00 of $1,000.00 for ${SERVER_PERIOD}.`,
}

beforeEach(() => {
  patchMutate.mockReset()
  listed.rows = [booking]
})

const confirmFromList = async (response: object | undefined) => {
  const user = userEvent.setup()
  patchMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: (r: unknown) => void }) => opts?.onSuccess?.(response))
  render(<MemoryRouter><BookingsPage /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: /Held/ }))
  await user.click(await screen.findByRole('option', { name: 'Confirmed' }))
  return user
}

describe('BookingsPage — the budget warning of a booking just confirmed', () => {
  it('sends the status change, then shows the server’s warning with the participant named and that the booking is confirmed', async () => {
    await confirmFromList({ data: { participantName: 'Sophie Brown', bookingStatus: 'Confirmed', budgetWarnings: [warning] } })

    expect(patchMutate).toHaveBeenCalledWith({ id: 'booking-1', data: { bookingStatus: 'Confirmed' } }, expect.objectContaining({ onSuccess: expect.any(Function) }))
    expect(screen.getByText(`This booking takes Core (flexible) to $1,440.00 of $1,000.00 for ${SERVER_PERIOD}.`, { normalizer: asWritten })).toBeInTheDocument()
    expect(screen.getByText('This is a warning only. Sophie Brown’s booking is confirmed.')).toBeInTheDocument()
  })

  it('shows nothing when the server sent no warning', async () => {
    await confirmFromList({ data: { participantName: 'Sophie Brown', bookingStatus: 'Confirmed' } })

    expect(screen.queryByText(BUDGET_WARNINGS_TITLE)).not.toBeInTheDocument()
  })

  it('can be dismissed', async () => {
    const user = await confirmFromList({ data: { participantName: 'Sophie Brown', budgetWarnings: [warning] } })

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByText(BUDGET_WARNINGS_TITLE)).not.toBeInTheDocument()
  })

  it('goes away when the next status change starts, so a stale warning never sits beside a different booking', async () => {
    const user = await confirmFromList({ data: { participantName: 'Sophie Brown', budgetWarnings: [warning] } })
    patchMutate.mockImplementation(() => undefined)   // the next change has not been answered yet

    await user.click(screen.getByRole('button', { name: /Held|Confirmed/ }))
    await user.click(await screen.findByRole('option', { name: 'Waitlist' }))

    expect(screen.queryByText(BUDGET_WARNINGS_TITLE)).not.toBeInTheDocument()
  })
})
