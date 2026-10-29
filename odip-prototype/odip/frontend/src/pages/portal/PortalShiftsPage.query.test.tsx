import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PortalShiftsPage from './PortalShiftsPage'
import type { PortalShiftSummaryDto } from '@/api/types'

// Real QueryClient and real useMyShifts: only the network call is faked, so these count actual requests.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@/api/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGet }))

const shift = (id: string, serviceDate: string, over: Partial<PortalShiftSummaryDto> = {}): PortalShiftSummaryDto => ({
  id, participantId: 'p1', participantName: 'Mia Chen', serviceDate, startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false,
  durationHours: 8, ratio: 'OneToOne', nightType: 'None', status: 'Published', notes: null, returnCount: 0, ...over,
})

let shifts: PortalShiftSummaryDto[] = []
const shiftCalls = () => apiGet.mock.calls.filter(c => c[0] === '/portal/my-shifts').map(c => c[1] as { from: string; to: string })

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><PortalShiftsPage /></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  apiGet.mockReset().mockImplementation(async (url: string, params?: { from?: string; to?: string }) => {
    if (url === '/portal/my-shifts') return { shifts: shifts.filter(s => s.serviceDate >= params!.from! && s.serviceDate <= params!.to!), tripAssignments: [], timeZoneId: 'Australia/Sydney' }
    if (url.startsWith('/portal/shifts/')) return { breaks: [], medicationsDue: [], handover: null, timeZoneId: 'Australia/Sydney' }
    return []
  })
  sessionStorage.clear()
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(() => vi.useRealTimers())

describe('PortalShiftsPage requests', () => {
  it('asks for shifts once on the current week', async () => {
    vi.setSystemTime(new Date('2026-08-19T10:00:00+10:00'))
    shifts = [shift('s1', '2026-08-19')]
    renderPage()
    await screen.findByText('Mia Chen')
    expect(shiftCalls()).toHaveLength(1)
  })

  it('still finds a Sunday overnight in progress on Monday morning, in the same single request', async () => {
    vi.setSystemTime(new Date('2026-08-24T10:00:00+10:00'))
    shifts = [shift('s1', '2026-08-23', { status: 'InProgress', endsNextDay: true, startTime: '22:00:00', endTime: '07:00:00' })]
    renderPage()
    expect(await screen.findByText('On shift now')).toBeInTheDocument()
    expect(shiftCalls()).toHaveLength(1)
    expect(shiftCalls()[0].from <= '2026-08-23').toBe(true)
  })

  it('adds one request per browsed week, and none for a current-shift lookup', async () => {
    vi.setSystemTime(new Date('2026-08-19T10:00:00+10:00'))
    shifts = [shift('s1', '2026-08-12')]
    renderPage()
    await waitFor(() => expect(shiftCalls()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    await screen.findByText('Mia Chen')
    expect(shiftCalls()).toEqual([{ from: '2026-08-17', to: '2026-08-23' }, { from: '2026-08-10', to: '2026-08-16' }])
  })
})

describe('PortalShiftsPage provider clock', () => {
  it('reads "this week" and "today" in the provider zone, not the phone zone', async () => {
    // Sunday 20:00 UTC is already Monday 06:00 in Sydney.
    vi.setSystemTime(new Date('2026-08-23T20:00:00Z'))
    shifts = [shift('s1', '2026-08-24', { status: 'Completed' })]
    renderPage()
    await waitFor(() => expect(shiftCalls().length).toBeGreaterThan(0))
    await new Promise(done => setTimeout(done, 50))   // let the first answer in: it carries the provider zone
    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    const day = await screen.findByRole('heading', { level: 3 })
    expect(day).toHaveTextContent('Today')
  })
})
