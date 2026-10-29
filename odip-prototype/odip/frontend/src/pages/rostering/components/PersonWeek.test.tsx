import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { RosterBoardDto } from '@/api/types'
import { PersonWeek } from './PersonWeek'
import { makeParticipantBoard, makeParticipantRow, makeShift, makeStaffBoard, makeStaffRow, makeUnfilledShift } from '../test-fixtures'

const { mockApiGet, mockApiPostRaw } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockApiPostRaw: vi.fn() }))
vi.mock('@/api/client', () => ({ apiGet: mockApiGet, apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), apiPostRaw: mockApiPostRaw }))

// Spec 2026-10-28: one person's roster week on their profile, the board's own row stood up as a week.
const NOV = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
const EMPTY_LINE = 'Nothing rostered this week. Choose a time on the grid to add a shift.'

const staffWeek = (row: Parameters<typeof makeStaffRow>[0] = {}): RosterBoardDto =>
  makeStaffBoard({ weekStart: NOV[0], days: NOV, staffRows: [makeStaffRow({ staffId: 's1', fullName: 'Sam Lee', ...row })] })
const participantWeek = (row: Parameters<typeof makeParticipantRow>[0] = {}): RosterBoardDto =>
  makeParticipantBoard({ weekStart: NOV[0], days: NOV, participantRows: [makeParticipantRow({ participantId: 'p1', fullName: 'Mia Chen', ...row })] })
const shiftOn = (overrides: Parameters<typeof makeShift>[0]) =>
  makeShift({ id: 'sh1', participantId: 'p1', participantName: 'Mia Chen', staffId: 's1', staffName: 'Sam Lee', serviceDate: '2026-11-03', ...overrides })

function renderWeek(kind: 'staff' | 'participant', entry?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/staff/:id', element: <PersonWeek kind="staff" personId="s1" name="Sam Lee" headingLevel={2} /> },
    { path: '/participants/:id', element: <PersonWeek kind="participant" personId="p1" name="Mia Chen" headingLevel={4} /> },
    { path: '/rostering', element: <p>The board</p> },
  ], { initialEntries: [entry ?? (kind === 'staff' ? '/staff/s1?tab=week&week=2026-11-04' : '/participants/p1?tab=people&section=week&week=2026-11-04')] })
  return { ...render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>), router }
}
const params = (router: ReturnType<typeof renderWeek>['router']) => new URLSearchParams(router.state.location.search)
// The board by week (an unlisted week is an empty staff week); every other GET, the panel's own, is an empty list.
const serve = (boards: Record<string, RosterBoardDto>) => (path: string, q: { weekStart: string }) =>
  Promise.resolve(path === '/rostering/board' ? (boards[q.weekStart] ?? staffWeek()) : [])

beforeEach(() => {
  mockApiGet.mockReset()
  mockApiPostRaw.mockReset()
  mockApiPostRaw.mockResolvedValue({ data: [], message: null })
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
})

afterEach(() => {
  localStorage.removeItem('odip_user')
  vi.restoreAllMocks()
})

describe('PersonWeek: the time grid', () => {
  afterEach(() => vi.useRealTimers())

  it('writer: blocks open the panel and Add shift shows; read-only role: no Add shift and no slot layer', async () => {
    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [shiftOn({})] }) }))
    const { unmount } = renderWeek('staff')
    await screen.findByRole('link', { name: 'Mia Chen' })
    expect(screen.getByRole('button', { name: 'Add shift' })).toBeInTheDocument()
    expect(document.querySelector('[data-minute]')).not.toBeNull()
    unmount()

    // ReadOnly exercises canWrite=false.
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    renderWeek('staff')
    await screen.findByRole('link', { name: 'Mia Chen' })
    expect(screen.queryByRole('button', { name: 'Add shift' })).toBeNull()
    expect(document.querySelector('[data-minute]')).toBeNull()
    expect(document.querySelector('[data-shift-open="sh1"]')).not.toBeNull()
  })

  it('clicking a block opens Shift details in place; the URL stays on the Week tab', async () => {
    const user = userEvent.setup()
    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [shiftOn({})] }) }))
    const { router } = renderWeek('staff')
    await screen.findByRole('link', { name: 'Mia Chen' })

    await user.click(document.querySelector('[data-shift-open="sh1"]')!)

    expect(await screen.findByRole('dialog', { name: 'Shift details' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/staff/s1')
    expect(params(router).get('week')).toBe('2026-11-04')
  })

  it('Escape returns focus to the block', async () => {
    const user = userEvent.setup()
    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [shiftOn({})] }) }))
    renderWeek('staff')
    await screen.findByRole('link', { name: 'Mia Chen' })
    const block = document.querySelector<HTMLElement>('[data-shift-open="sh1"]')!
    block.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog', { name: 'Shift details' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(block)
  })

  it("staff week: labels link to the participant's week", async () => {
    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [shiftOn({})] }) }))
    renderWeek('staff')
    expect(await screen.findByRole('link', { name: 'Mia Chen' })).toHaveAttribute('href', '/participants/p1?tab=people&section=week&week=2026-11-02')
  })

  it("participant week: labels link to the worker's week; unfilled reads Needs staff", async () => {
    mockApiGet.mockImplementation(serve({ [NOV[0]]: participantWeek({ shifts: [shiftOn({}), makeUnfilledShift({ id: 'open-1', participantId: 'p1', serviceDate: '2026-11-05' })] }) }))
    renderWeek('participant')
    expect(await screen.findByRole('link', { name: 'Sam Lee' })).toHaveAttribute('href', '/staff/s1?tab=week&week=2026-11-02')
    expect(screen.getByText('Needs staff')).toBeInTheDocument()
  })

  it('blocks in a day are in top order in the DOM', async () => {
    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [
      shiftOn({ id: 'late', startTime: '13:00:00', endTime: '15:00:00', participantName: 'Ben Ito', participantId: 'p2' }),
      shiftOn({ id: 'early', startTime: '09:00:00', endTime: '11:00:00' }),
    ] }) }))
    renderWeek('staff')
    await screen.findByRole('link', { name: 'Ben Ito' })
    const opens = [...document.querySelectorAll('[data-shift-open]')].map(e => e.getAttribute('data-shift-open'))
    expect(opens).toEqual(['early', 'late'])
  })

  it('Add shift opens New shift for today in the shown week, else Monday', async () => {
    const user = userEvent.setup()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 4, 12, 0))
    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [shiftOn({})] }), '2026-11-09': staffWeek({ shifts: [shiftOn({})] }) }))
    renderWeek('staff')
    await screen.findByRole('link', { name: 'Mia Chen' })

    await user.click(screen.getByRole('button', { name: 'Add shift' }))
    expect(await screen.findByRole('dialog', { name: 'New shift' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Service date/)).toHaveValue('2026-11-04')
    expect(screen.getByLabelText(/^Start time/)).toHaveValue('09:00')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Next week' }))
    await user.click(screen.getByRole('button', { name: 'Add shift' }))
    expect(await screen.findByRole('dialog', { name: 'New shift' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Service date/)).toHaveValue('2026-11-09')
  })

  it('a slot click on Thursday 10:00 opens New shift with the date and Start time 10:00', async () => {
    const user = userEvent.setup()
    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [shiftOn({})] }) }))
    renderWeek('staff')
    await screen.findByRole('link', { name: 'Mia Chen' })

    await user.click(document.querySelector('[data-day="2026-11-05"] [data-minute="600"]')!)

    expect(await screen.findByRole('dialog', { name: 'New shift' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Service date/)).toHaveValue('2026-11-05')
    expect(screen.getByLabelText(/^Start time/)).toHaveValue('10:00')
    expect(screen.getByLabelText(/^End time/)).toHaveValue('11:00')
  })

  it("the previous Sunday's overnight draws a from-Sun tail on Monday", async () => {
    const tail = shiftOn({ id: 'tail', serviceDate: '2026-11-01', startTime: '22:00:00', endTime: '06:00:00', endsNextDay: true })
    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [shiftOn({})] }), '2026-10-26': staffWeek({ shifts: [tail] }) }))
    renderWeek('staff')
    expect(await screen.findByText('from Sun')).toBeInTheDocument()
    const monday = document.querySelector('[data-day="2026-11-02"]')!
    expect(monday.querySelector('[data-shift-open="tail"]')).not.toBeNull()
  })

  it('a tail from placeholder data is ignored', async () => {
    const user = userEvent.setup()
    // The week before is on screen as the "previous" read; going back one more week, that read is placeholder data and must not draw a tail.
    const ghost = shiftOn({ id: 'ghost', serviceDate: '2026-10-25', startTime: '22:00:00', endTime: '06:00:00', endsNextDay: true })
    mockApiGet.mockImplementation((path: string, q: { weekStart: string }) => {
      if (path !== '/rostering/board') return Promise.resolve([])
      if (q.weekStart === '2026-10-19') return new Promise(() => {})
      if (q.weekStart === '2026-10-26') return Promise.resolve(staffWeek({ shifts: [ghost] }))
      return Promise.resolve(staffWeek({ shifts: [shiftOn({})] }))
    })
    renderWeek('staff', '/staff/s1?tab=week&week=2026-11-02')
    await screen.findByRole('link', { name: 'Mia Chen' })
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/rostering/board', expect.objectContaining({ weekStart: '2026-10-19' })))
    expect(screen.queryByText('from Sun')).toBeNull()
  })

  it('two requests per view: this week and the previous week', async () => {
    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [shiftOn({})] }) }))
    renderWeek('staff')
    await screen.findByRole('link', { name: 'Mia Chen' })
    expect(mockApiGet).toHaveBeenCalledWith('/rostering/board', expect.objectContaining({ weekStart: '2026-11-02' }))
    expect(mockApiGet).toHaveBeenCalledWith('/rostering/board', expect.objectContaining({ weekStart: '2026-10-26' }))
  })

  it("today's header carries aria-current=date; an empty day column has no blocks", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 4, 12, 0))
    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [shiftOn({})] }) }))
    renderWeek('staff')
    await screen.findByRole('link', { name: 'Mia Chen' })

    const today = screen.getByRole('heading', { name: /^Wednesday 4 November, today$/ })
    expect(today).toHaveAttribute('aria-current', 'date')
    expect(today.tagName).toBe('H3')
    expect(document.querySelector('[data-day="2026-11-02"] [data-shift-open]')).toBeNull()
    expect(document.querySelector('[data-day="2026-11-03"] [data-shift-open]')).not.toBeNull()
  })

  it('day view below 672px: seven tabs, today selected; arrows move; a week change resets to Monday', async () => {
    const user = userEvent.setup()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 4, 12, 0))
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390)
    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [shiftOn({})] }), '2026-11-09': makeStaffBoard({ weekStart: '2026-11-09', days: NOV.map((_, i) => '2026-11-' + String(9 + i).padStart(2, '0')), staffRows: [makeStaffRow({ staffId: 's1', fullName: 'Sam Lee', shifts: [shiftOn({ id: 'sh9', serviceDate: '2026-11-10' })] })] }) }))
    renderWeek('staff')
    await screen.findByRole('link', { name: 'Mia Chen' }).catch(() => null)
    const tabs = await screen.findAllByRole('tab')
    expect(tabs).toHaveLength(7)
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true')
    tabs[2].focus()
    await user.keyboard('{ArrowLeft}')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('[data-day="2026-11-03"] [data-shift-open="sh1"]')).not.toBeNull()
    expect(document.querySelectorAll('[data-day]')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Next week' }))
    await waitFor(() => expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true'))
  })

  it('bars render in the lane, once per bar', async () => {
    const trip = { tripInstanceId: 't1', tripCode: 'T-1', tripName: 'Coast trip', startDate: '2026-11-03', endDate: '2026-11-05', isDriver: false }
    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [shiftOn({})], tripBars: [trip] }) }))
    renderWeek('staff')
    const lane = await screen.findByRole('list', { name: 'Leave and trips' })
    expect(within(lane).getAllByRole('link', { name: /Coast trip/ })).toHaveLength(1)
  })

  it('a week with only a trip shows the grid, the lane and the empty-week line', async () => {
    const trip = { tripInstanceId: 't1', tripCode: 'T-1', tripName: 'Coast trip', startDate: '2026-11-03', endDate: '2026-11-03', isDriver: false }
    mockApiGet.mockImplementation(serve({ [NOV[0]]: participantWeek({ tripBars: [trip] }) }))
    renderWeek('participant')
    expect(await screen.findByRole('list', { name: 'Leave and trips' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Shifts by hour' })).toBeInTheDocument()
    expect(screen.getByText(EMPTY_LINE)).toBeInTheDocument()
  })

  it('an empty week shows the grid and the line; no EmptyState title', async () => {
    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek() }))
    renderWeek('staff')
    expect(await screen.findByText(EMPTY_LINE)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Shifts by hour' })).toBeInTheDocument()
    expect(screen.queryByText('Nothing rostered this week')).toBeNull()
    for (const link of screen.getAllByRole('link', { name: 'Open in roster' })) expect(link).toHaveAttribute('href', '/rostering?date=2026-11-02')
  })
})

describe('PersonWeek: the week', () => {
  it('previous, next and This week write week= with replace', async () => {
    const user = userEvent.setup()
    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [shiftOn({})] }), '2026-11-09': staffWeek({ shifts: [shiftOn({})] }) }))
    const { router } = renderWeek('staff', '/staff/s1?tab=week&week=2026-11-05')
    expect(screen.getByRole('heading', { name: '2 – 8 Nov 2026' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(params(router).get('week')).toBe('2026-11-09')
    expect(params(router).get('tab')).toBe('week')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.getByRole('heading', { name: '9 – 15 Nov 2026' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Showing 9 – 15 Nov 2026')

    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(params(router).get('week')).toBe('2026-11-02')

    await user.click(screen.getByRole('button', { name: 'This week' }))
    expect(params(router).has('week')).toBe(false)
    expect(params(router).get('tab')).toBe('week')
  })

  it('no row: Not on the roster (staff and participant)', async () => {
    mockApiGet.mockImplementation(serve({ [NOV[0]]: makeStaffBoard({ weekStart: NOV[0], days: NOV, staffRows: [] }) }))
    const { unmount } = renderWeek('staff')
    expect(await screen.findByText('Not on the roster')).toBeInTheDocument()
    expect(screen.getByText('Only active staff appear on the roster.')).toBeInTheDocument()
    expect(screen.queryByText(EMPTY_LINE)).toBeNull()
    unmount()

    mockApiGet.mockImplementation(serve({ [NOV[0]]: makeParticipantBoard({ weekStart: NOV[0], days: NOV, participantRows: [] }) }))
    renderWeek('participant')
    expect(await screen.findByText('Only active participants appear on the roster.')).toBeInTheDocument()
  })

  it('placeholder week dims and keeps its own day headers', async () => {
    const user = userEvent.setup()
    mockApiGet.mockImplementation((path: string, q: { weekStart: string }) => {
      if (path !== '/rostering/board') return Promise.resolve([])
      if (q.weekStart === '2026-11-09') return new Promise(() => {})
      return Promise.resolve(staffWeek({ shifts: [shiftOn({})] }))
    })
    renderWeek('staff')
    await screen.findByRole('link', { name: 'Mia Chen' })

    await user.click(screen.getByRole('button', { name: 'Next week' }))

    expect(screen.getByRole('region', { name: '9 – 15 Nov 2026' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('heading', { name: /^Tuesday 3 November/ })).toBeInTheDocument()
    expect(screen.queryByText('Not on the roster')).toBeNull()
  })

  it('loading: busy, announced, header buttons live', async () => {
    let answer!: (board: RosterBoardDto) => void
    mockApiGet.mockReturnValue(new Promise<RosterBoardDto>(resolve => { answer = resolve }))
    renderWeek('staff')
    expect(screen.getByRole('region', { name: '2 – 8 Nov 2026' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading roster week…')).toBeInTheDocument()
    for (const name of ['Previous week', 'This week', 'Next week']) expect(screen.getByRole('button', { name })).toBeInTheDocument()

    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [shiftOn({})] }) }))
    answer(staffWeek({ shifts: [shiftOn({})] }))
    expect(await screen.findByRole('link', { name: 'Mia Chen' })).toBeInTheDocument()
    expect(screen.queryByText('Loading roster week…')).toBeNull()
  })

  it('error: PageState with retry, header still live', async () => {
    const user = userEvent.setup()
    mockApiGet.mockRejectedValueOnce(new Error('down'))
    const { router } = renderWeek('staff')
    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByText(/Couldn.t load this roster week/)).toBeInTheDocument()

    mockApiGet.mockImplementation(serve({ [NOV[0]]: staffWeek({ shifts: [shiftOn({})] }) }))
    await user.click(retry)
    expect(await screen.findByRole('link', { name: 'Mia Chen' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(params(router).get('week')).toBe('2026-11-09')
  })
})

describe('PersonWeek: extras', () => {
  // Roster week shots (SHAPE §8.5): a trip bar is a control-height link under a coarse pointer (44px), and stays 24px on a mouse.
  it('trip bars grow to the control height under a coarse pointer', async () => {
    const trip = { tripInstanceId: 't1', tripCode: 'T-1', tripName: 'Coast trip', startDate: '2026-11-03', endDate: '2026-11-05', isDriver: false }
    mockApiGet.mockResolvedValue(staffWeek({ shifts: [shiftOn({})], tripBars: [trip] }))
    renderWeek('staff')
    const lane = await screen.findByRole('list', { name: 'Leave and trips' })
    expect(within(lane).getByRole('link', { name: /Coast trip/ })).toHaveClass('h-[var(--control-h-sm)]', 'pointer-coarse:h-[var(--control-h)]')
  })

  // A recurring window is regular unavailability, not leave: the lane keeps the time-proportional sliver, and the day view reads it as a full-width line in the chip's own time format.
  const rule = { startDate: '2026-11-03', endDate: '2026-11-03', availabilityType: 'Leave', notes: null, kind: 'PendingRecurringRule' as const, startTime: '06:00:00', endTime: '08:00:00' }

  it('a partial-day recurring unavailability keeps its sliver in the lane', async () => {
    mockApiGet.mockResolvedValue(staffWeek({ shifts: [shiftOn({})], leave: [rule] }))
    renderWeek('staff')
    const lane = await screen.findByRole('list', { name: 'Leave and trips' })
    expect(within(lane).getByText('06:00–08:00 (pending)').parentElement).toHaveStyle({ left: '25%' })
  })

  it('the day view reads a partial-day recurring unavailability in words', async () => {
    const user = userEvent.setup()
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390)
    mockApiGet.mockResolvedValue(staffWeek({ shifts: [shiftOn({})], leave: [rule] }))
    renderWeek('staff')
    await user.click(await screen.findByRole('tab', { name: /^Tuesday 3 November/ }))
    const words = await screen.findByText('Unavailable 6am–8am (pending)')
    expect(words.parentElement).not.toHaveAttribute('style', expect.stringContaining('left'))
    expect(words.parentElement).toHaveClass('border-dashed')
  })

  // The over-target fill is the "Over target" ink, which clears 3:1 on the input track in both themes; the plain warning amber was 1.66:1 in light.
  it('over target fills the meter with the warning ink', async () => {
    mockApiGet.mockResolvedValue(staffWeek({ shifts: [shiftOn({})], rosteredHours: 40, targetHours: 38 }))
    renderWeek('staff')
    await screen.findByText('Over target')
    expect(document.querySelector('[aria-hidden="true"].bg-input > div')).toHaveClass('bg-[var(--color-on-warning-container)]')
  })

  it('staff hours: meter, over target and no target', async () => {
    mockApiGet.mockResolvedValue(staffWeek({ shifts: [shiftOn({})], rosteredHours: 18, targetHours: 38 }))
    const { unmount } = renderWeek('staff')
    expect(await screen.findByText('18 / 38 h')).toBeInTheDocument()
    expect(screen.queryByText('Over target')).toBeNull()
    unmount()

    mockApiGet.mockResolvedValue(staffWeek({ shifts: [shiftOn({})], rosteredHours: 40, targetHours: 38 }))
    const second = renderWeek('staff')
    expect(await screen.findByText('Over target')).toBeInTheDocument()
    second.unmount()

    mockApiGet.mockResolvedValue(staffWeek({ shifts: [shiftOn({})], rosteredHours: 18, targetHours: 0 }))
    renderWeek('staff')
    expect(await screen.findByText('18 h rostered')).toBeInTheDocument()
    expect(screen.queryByText(/\/ 0 h/)).toBeNull()
  })

  it('participant week has no hours line', async () => {
    mockApiGet.mockResolvedValue(participantWeek({ shifts: [shiftOn({})] }))
    renderWeek('participant')
    await screen.findByRole('link', { name: 'Sam Lee' })
    expect(screen.queryByText('Hours')).toBeNull()
  })

  it('Open in roster carries the participant filter; the request names only the participant', async () => {
    mockApiGet.mockResolvedValue(participantWeek({ shifts: [shiftOn({})] }))
    renderWeek('participant')
    await screen.findByRole('link', { name: 'Sam Lee' })
    expect(screen.getByRole('link', { name: 'Open in roster' })).toHaveAttribute('href', '/rostering?date=2026-11-02&participant=p1')
    expect(mockApiGet).toHaveBeenCalledWith('/rostering/board', { weekStart: '2026-11-02', groupBy: 'participant', participantId: 'p1' })
    // The participant tab sits under an sr-only h3, so its span is an h4 and its days h5 (lead amendment 4).
    expect(screen.getByRole('heading', { name: '2 – 8 Nov 2026' }).tagName).toBe('H4')
    expect(screen.getByRole('heading', { name: /^Tuesday 3 November/ }).tagName).toBe('H5')
  })
})
