import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { apiClient } from '@/api/client'
import BookingsTab from './BookingsTab'
import type { TripDetailDto } from '@/api/types/trips'
import type { BookingDetailDto, BookingListDto } from '@/api/types/bookings'

// Editing a booking from the trip page sent a PUT built from the LIST row, which lacks the detail-only columns, and the server assigns every column
// of the update DTO: so saving ANY edit erased funding notes, room/transport/equipment/risk notes, the plan-type override, the cancellation reason,
// the insurance details and the booking notes. The REAL hooks run on a REAL QueryClient; only the transport (the axios adapter) is replaced.

const trip = { id: 'trip-1', maxParticipants: 10, staffAssignedCount: 0, staffRequired: null, calculatedStaffRequired: 0 } as unknown as TripDetailDto

const listRow: BookingListDto = {
  id: 'booking-1', tripInstanceId: 'trip-1', tripName: 'Coastal weekend', participantId: 'participant-1', participantName: 'Sophie Brown',
  bookingStatus: 'Held', bookingDate: '2026-10-12', wheelchairRequired: true, highSupportRequired: false, nightSupportRequired: true,
  hasRestrictivePracticeFlag: false, supportRatioOverride: 'OneToTwo', actionRequired: true, insuranceStatus: 'Confirmed', paymentStatus: 'InvoiceSent',
}

const detail: BookingDetailDto = {
  ...listRow,
  planTypeOverride: 'PlanManaged', fundingNotes: 'Core funds first', roomPreference: 'Ground floor', transportNotes: 'Ramp van',
  equipmentNotes: 'Hoist + sling', riskSupportNotes: 'Two staff for transfers', bookingNotes: 'Original note', cancellationReason: 'Family illness',
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
  insuranceProvider: 'Allianz', insurancePolicyNumber: 'POL-12345', insuranceCoverageStart: '2026-10-01', insuranceCoverageEnd: '2026-11-01', isInsuranceValid: true,
}

const original = apiClient.defaults.adapter
let puts: Record<string, unknown>[] = []
let patches: Record<string, unknown>[] = []
let detailFailures = 0
let putFails = false

const reply = (config: InternalAxiosRequestConfig, status: number, body: unknown): AxiosResponse =>
  ({ data: body, status, statusText: String(status), headers: {}, config }) as AxiosResponse

beforeEach(() => {
  puts = []
  patches = []
  detailFailures = 0
  putFails = false
  const adapter: AxiosAdapter = async config => {
    const method = (config.method ?? 'get').toLowerCase()
    if (method === 'get' && config.url?.endsWith('/bookings/booking-1')) {
      if (detailFailures > 0) {
        detailFailures--
        const res = reply(config, 500, { success: false, message: 'boom' })
        throw Object.assign(new Error('Request failed with status code 500'), { isAxiosError: true, response: res, config })
      }
      return reply(config, 200, { success: true, data: detail })
    }
    if (method === 'put' && putFails) {
      const res = reply(config, 500, { success: false, message: 'boom' })
      throw Object.assign(new Error('Request failed with status code 500'), { isAxiosError: true, response: res, config })
    }
    if (method === 'put') {
      puts.push(JSON.parse(config.data as string))
      return reply(config, 200, { success: true, data: detail })
    }
    if (method === 'patch') {
      patches.push(JSON.parse(config.data as string))
      return reply(config, 200, { success: true, data: detail })
    }
    return reply(config, 200, { success: true, data: [] })
  }
  apiClient.defaults.adapter = adapter
})

afterEach(() => { apiClient.defaults.adapter = original })

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BookingsTab tripId="trip-1" trip={trip} bookings={[listRow]} participants={[]} canWrite isReadOnly={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BookingsTab — editing a booking keeps the details the list row does not carry', () => {
  it('changes only the notes and still sends every other stored value', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByTitle('Edit booking'))

    const notes = await screen.findByPlaceholderText('Optional notes...')
    expect(notes).toHaveValue('Original note')
    await user.clear(notes)
    await user.type(notes, 'Changed note')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toMatchObject({
      tripInstanceId: 'trip-1', participantId: 'participant-1', bookingStatus: 'Held', supportRatioOverride: 'OneToTwo',
      wheelchairRequired: true, highSupportRequired: false, nightSupportRequired: true, hasRestrictivePracticeFlag: false,
      paymentStatus: 'InvoiceSent', actionRequired: true, insuranceStatus: 'Confirmed',
      planTypeOverride: 'PlanManaged', fundingNotes: 'Core funds first', roomPreference: 'Ground floor', transportNotes: 'Ramp van',
      equipmentNotes: 'Hoist + sling', riskSupportNotes: 'Two staff for transfers', cancellationReason: 'Family illness',
      insuranceProvider: 'Allianz', insurancePolicyNumber: 'POL-12345', insuranceCoverageStart: '2026-10-01', insuranceCoverageEnd: '2026-11-01',
      bookingNotes: 'Changed note',
    })
  })

  it('a refused save shows the error and keeps what was typed', async () => {
    const user = userEvent.setup()
    putFails = true
    renderTab()
    await user.click(screen.getByTitle('Edit booking'))
    const notes = await screen.findByPlaceholderText('Optional notes...')
    await user.clear(notes)
    await user.type(notes, 'Changed note')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Failed to update booking. Please try again.')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Optional notes...')).toHaveValue('Changed note')
  })

  it('shows the load failure with Try again, never an empty editable form, and recovers on retry', async () => {
    const user = userEvent.setup()
    detailFailures = 1
    renderTab()
    await user.click(screen.getByTitle('Edit booking'))

    expect(await screen.findByText(/Couldn't load this booking/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Optional notes...')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByPlaceholderText('Optional notes...')).toHaveValue('Original note')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('cancelling a booking changes only its status, not a full update built from the list row', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByTitle('Remove from trip'))
    await user.click(await screen.findByRole('button', { name: /Cancel booking/ }))

    await waitFor(() => expect(patches).toEqual([{ bookingStatus: 'Cancelled' }]))
    expect(puts).toHaveLength(0)
  })
})
