import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BookingsTab from './BookingsTab'
import type { TripDetailDto } from '@/api/types/trips'
import type { BookingListDto } from '@/api/types/bookings'

// TRIPS-8 through the real usePatchBooking: TanStack keeps only the LATEST mutate() call's callbacks, so each change must
// read its own promise, or a refusal on one row is lost when another row changes before it settles, and a bulk edit hangs.

const { apiPatchRaw } = vi.hoisted(() => ({ apiPatchRaw: vi.fn() }))
vi.mock('@/api/client', async () => ({ ...(await vi.importActual<typeof import('@/api/client')>('@/api/client')), apiPatchRaw }))

const trip = { id: 'trip-1', maxParticipants: 10, staffAssignedCount: 0, staffRequired: null, calculatedStaffRequired: 0 } as unknown as TripDetailDto
const row = (id: string, participantName: string): BookingListDto => ({
  id, tripInstanceId: 'trip-1', tripName: 'Coastal weekend', participantId: `p-${id}`, participantName, bookingStatus: 'Held', bookingDate: '2026-10-12',
  wheelchairRequired: false, highSupportRequired: false, nightSupportRequired: false, hasRestrictivePracticeFlag: false, supportRatioOverride: null, actionRequired: false, insuranceStatus: 'None', paymentStatus: 'NotInvoiced',
})
const bookings = [row('b1', 'Sophie Brown'), row('b2', 'Noah Reid')]
const refused = { response: { status: 409, data: { message: 'This booking is locked.' } } }

type Pending = Record<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>

/** One pending answer per PATCH, settled by the test in whatever order it likes. */
function deferredPatches(): Pending {
  const pending: Pending = {}
  apiPatchRaw.mockImplementation((url: string) => new Promise((resolve, reject) => { pending[url] = { resolve, reject } }))
  return pending
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BookingsTab tripId="trip-1" trip={trip} bookings={bookings} participants={[]} canWrite isReadOnly={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

beforeEach(() => { apiPatchRaw.mockReset() })

describe('BookingsTab — overlapping and bulk changes, through the real mutation', () => {
  it('shows a refusal on one row even when another row changed before it was answered', async () => {
    const user = userEvent.setup()
    const pending = deferredPatches()
    renderTab()

    await user.click(within(rowOf('Sophie Brown')).getByRole('button', { name: /^None/ }))
    await user.click(await screen.findByRole('option', { name: 'Pending' }))
    await user.click(within(rowOf('Noah Reid')).getByRole('button', { name: /^Not Invoiced/ }))
    await user.click(await screen.findByRole('option', { name: 'Paid' }))

    await act(async () => { pending['/bookings/b1'].reject(refused) })
    await act(async () => { pending['/bookings/b2'].resolve({ success: true, data: {} }) })

    expect(screen.getByText(/Couldn't update Sophie Brown's booking\./)).toBeInTheDocument()
    expect(screen.getByText(/This booking is locked\./)).toBeInTheDocument()
  })

  it('settles a bulk change of two rows: one refusal is reported and the selection clears', async () => {
    const user = userEvent.setup()
    const pending = deferredPatches()
    renderTab()

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    await user.click(screen.getAllByRole('button', { name: /2 rows/ }).at(-1)!)
    await user.click(await screen.findByRole('option', { name: 'Paid' }))

    await act(async () => { pending['/bookings/b1'].resolve({ success: true, data: {} }) })
    await act(async () => { pending['/bookings/b2'].reject(refused) })

    expect(screen.getByText(/Couldn't update 1 booking\./)).toBeInTheDocument()
    expect(screen.getByText(/This booking is locked\./)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select all rows' })).not.toBeChecked()
  })
})
