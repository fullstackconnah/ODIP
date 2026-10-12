import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BookingsPage from './BookingsPage'
import type { BookingListDto } from '@/api/types/bookings'

// TRIPS-8 through the real usePatchBooking: a refusal on one row survives another row changing before it was answered.

const { apiPatchRaw, rows } = vi.hoisted(() => ({ apiPatchRaw: vi.fn(), rows: [] as unknown[] }))
vi.mock('@/api/client', async () => ({ ...(await vi.importActual<typeof import('@/api/client')>('@/api/client')), apiPatchRaw }))
vi.mock('@/api/hooks', async () => ({
  ...(await vi.importActual<typeof import('@/api/hooks')>('@/api/hooks')),
  useBookings: () => ({ data: Object.assign([...rows], { totalCount: rows.length }), isLoading: false, isError: false, refetch: vi.fn() }),
}))

const row = (id: string, participantName: string) => ({
  id, tripInstanceId: 'trip-1', tripName: 'Coastal weekend', participantId: `p-${id}`, participantName, bookingStatus: 'Held', bookingDate: '2026-10-12',
  wheelchairRequired: false, highSupportRequired: false, nightSupportRequired: false,
}) as unknown as BookingListDto

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  apiPatchRaw.mockReset()
  rows.splice(0, rows.length, row('b1', 'Sophie Brown'), row('b2', 'Noah Reid'))
})
afterEach(() => localStorage.clear())

describe('BookingsPage — overlapping status changes, through the real mutation', () => {
  it('shows the refusal of the first change after a second one started', async () => {
    const user = userEvent.setup()
    const pending: Record<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }> = {}
    apiPatchRaw.mockImplementation((url: string) => new Promise((resolve, reject) => { pending[url] = { resolve, reject } }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter><BookingsPage /></MemoryRouter></QueryClientProvider>)

    const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement
    await user.click(within(rowOf('Sophie Brown')).getByRole('button', { name: /Held/ }))
    await user.click(await screen.findByRole('option', { name: 'Confirmed' }))
    await user.click(within(rowOf('Noah Reid')).getByRole('button', { name: /Held/ }))
    await user.click(await screen.findByRole('option', { name: 'Waitlist' }))

    await act(async () => { pending['/bookings/b1'].reject({ response: { status: 400, data: { message: 'This trip is full.' } } }) })
    await act(async () => { pending['/bookings/b2'].resolve({ success: true, data: {} }) })

    expect(screen.getByText(/Couldn't update Sophie Brown's booking\./)).toBeInTheDocument()
    expect(screen.getByText(/This trip is full\./)).toBeInTheDocument()
  })
})
