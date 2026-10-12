import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import BookingsPage from './BookingsPage'
import type { BookingListDto } from '@/api/types/bookings'

// TRIPS-8: a status change the server refuses says why, in one banner above the list that the next success clears. Plus the list's own load states.

const { patchMutate, list } = vi.hoisted(() => ({ patchMutate: vi.fn(), list: { value: {} as Record<string, unknown> } }))

vi.mock('@/api/hooks', () => ({
  useBookings: () => list.value,
  usePatchBooking: () => ({ mutate: patchMutate, isPending: false }),
}))

const booking = {
  id: 'booking-1', tripInstanceId: 'trip-1', tripName: 'Coastal weekend', participantId: 'participant-1', participantName: 'Sophie Brown', bookingStatus: 'Held', bookingDate: '2026-10-12',
  wheelchairRequired: false, highSupportRequired: false, nightSupportRequired: false,
} as unknown as BookingListDto

const refused = { response: { status: 400, data: { message: 'This trip is full.' } } }
type Callbacks = { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void; onSettled?: () => void }
const refuse = () => patchMutate.mockImplementation((_v: unknown, o?: Callbacks) => { o?.onError?.(refused); o?.onSettled?.() })
const accept = () => patchMutate.mockImplementation((_v: unknown, o?: Callbacks) => { o?.onSuccess?.({ data: {} }); o?.onSettled?.() })

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  patchMutate.mockReset()
  list.value = { data: Object.assign([booking], { totalCount: 1 }), isLoading: false, isError: false, refetch: vi.fn() }
})
afterEach(() => localStorage.clear())

const pick = async (user: ReturnType<typeof userEvent.setup>, from: RegExp, to: string) => {
  await user.click(screen.getByRole('button', { name: from }))
  await user.click(await screen.findByRole('option', { name: to }))
}

describe('BookingsPage — a refused status change', () => {
  it('shows the server message, naming the participant', async () => {
    const user = userEvent.setup()
    refuse()
    render(<MemoryRouter><BookingsPage /></MemoryRouter>)
    await pick(user, /Held/, 'Confirmed')

    expect(screen.getByText(/Couldn't update Sophie Brown's booking\./)).toBeInTheDocument()
    expect(screen.getByText(/This trip is full\./)).toBeInTheDocument()
  })

  it('closes the cancel confirm and shows the message when the cancel fails', async () => {
    const user = userEvent.setup()
    refuse()
    render(<MemoryRouter><BookingsPage /></MemoryRouter>)
    await pick(user, /Held/, 'Cancelled')
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel booking' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText(/This trip is full\./)).toBeInTheDocument()
  })

  it('clears the banner on the next change that succeeds', async () => {
    const user = userEvent.setup()
    refuse()
    render(<MemoryRouter><BookingsPage /></MemoryRouter>)
    await pick(user, /Held/, 'Confirmed')
    accept()
    await pick(user, /Held/, 'Waitlist')

    expect(screen.queryByText(/This trip is full\./)).not.toBeInTheDocument()
  })
})

describe('BookingsPage — load states', () => {
  it('keeps the header and offers a retry when the list fails to load', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    list.value = { data: undefined, isLoading: false, isError: true, refetch }
    render(<MemoryRouter><BookingsPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { level: 1, name: 'Bookings' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('says what is loading', () => {
    list.value = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() }
    render(<MemoryRouter><BookingsPage /></MemoryRouter>)

    expect(screen.getByRole('status')).toHaveTextContent('Loading bookings…')
  })
})
