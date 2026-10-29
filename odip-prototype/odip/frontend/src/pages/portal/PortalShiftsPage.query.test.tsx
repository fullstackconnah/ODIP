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
    // Each range reaches a day past both ends of its week, so it depends on the browsed week alone.
    expect(shiftCalls()).toEqual([{ from: '2026-08-16', to: '2026-08-24' }, { from: '2026-08-09', to: '2026-08-17' }])
  })
})

describe('PortalShiftsPage provider clock', () => {
  it('reads "this week" and "today" in the provider zone, not the phone zone', async () => {
    // Sunday 20:00 UTC is already Monday 06:00 in Sydney.
    vi.setSystemTime(new Date('2026-08-23T20:00:00Z'))
    shifts = [shift('s1', '2026-08-24', { status: 'Completed' })]
    renderPage()
    const day = await screen.findByRole('heading', { level: 3 })
    expect(day).toHaveTextContent('Today')
  })
})

describe('PortalShiftsPage the saved week offline', () => {
  const setOnline = (value: boolean) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, value })
  afterEach(() => setOnline(true))

  it.each([['Monday', '2026-08-17T12:00:00+10:00'], ['Sunday', '2026-08-23T12:00:00+10:00']])('opens the week saved on Saturday when offline on its %s', async (_day, at) => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
    vi.setSystemTime(new Date('2026-08-22T10:00:00+10:00'))   // a saved copy is good for 48 hours
    shifts = [shift('s1', '2026-08-19')]
    const online = renderPage()
    await screen.findByText('Mia Chen')   // online: the week is saved on this phone
    online.unmount()
    expect(shiftCalls()).toHaveLength(1)

    setOnline(false)
    apiGet.mockRejectedValue(new Error('Network Error'))
    vi.setSystemTime(new Date(at))
    renderPage()
    expect(await screen.findByText('Mia Chen')).toBeInTheDocument()
    expect(screen.queryByText("This week isn't saved on this phone.")).not.toBeInTheDocument()
  })
})

describe('PortalShiftsPage landing week', () => {
  // Sunday 17:00 UTC is Monday 03:00 in Sydney: a UTC or Perth phone is still in last week, the provider is in the next.
  const sundayOvernight = () => shift('s1', '2026-08-23', { status: 'InProgress', endsNextDay: true, startTime: '22:00:00', endTime: '07:00:00' })

  it('settles on the provider week once the first answer names its zone, so the card shows', async () => {
    vi.setSystemTime(new Date('2026-08-23T17:00:00Z'))
    shifts = [sundayOvernight()]
    renderPage()
    expect(await screen.findByText('On shift now')).toBeInTheDocument()
    expect(shiftCalls().at(-1)).toEqual({ from: '2026-08-23', to: '2026-08-31' })
  })

  it('does not move a user who paged before the answer arrived', async () => {
    vi.setSystemTime(new Date('2026-08-23T17:00:00Z'))
    shifts = [sundayOvernight()]
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    const week = screen.getByRole('group', { name: 'Week' }).textContent
    await waitFor(() => expect(shiftCalls().length).toBeGreaterThan(0))
    await new Promise(done => setTimeout(done, 50))   // let the answer in and any snap happen
    expect(screen.getByRole('group', { name: 'Week' }).textContent).toBe(week)
  })
})
