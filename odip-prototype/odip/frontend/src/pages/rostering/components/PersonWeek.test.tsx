import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { RosterBoardDto } from '@/api/types'
import { PersonWeek } from './PersonWeek'
import { ShiftChip } from './ShiftChip'
import { makeParticipantBoard, makeParticipantRow, makeShift, makeStaffBoard, makeStaffRow, makeUnfilledShift } from '../test-fixtures'

const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }))
vi.mock('@/api/client', () => ({ apiGet: mockApiGet, apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), apiPostRaw: vi.fn() }))

// Spec 2026-10-28: one person's roster week on their profile, the board's own row stood up as a week.
const NOV = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
const noop = () => {}

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
const dayItem = (name: RegExp) => screen.getByRole('heading', { name }).closest('li')!

beforeEach(() => mockApiGet.mockReset())

describe('PersonWeek: read-only chips', () => {
  it('canWrite={false} removes every write affordance', async () => {
    const unfilled = makeUnfilledShift({ id: 'open-1', participantId: 'p1', participantName: 'Mia Chen', serviceDate: '2026-11-03', status: 'Draft' })
    const filled = shiftOn({ id: 'sh2', serviceDate: '2026-11-04', status: 'Draft' })
    // Not vacuous: the same shift in a writable chip has its menu.
    const { unmount } = render(<MemoryRouter><ShiftChip shift={filled} canWrite draggable context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} /></MemoryRouter>)
    expect(document.querySelector('[aria-haspopup]')).not.toBeNull()
    unmount()

    mockApiGet.mockResolvedValue(participantWeek({ shifts: [unfilled, filled] }))
    renderWeek('participant')
    await screen.findByText('Needs staff')

    const chips = screen.getAllByRole('list').filter(l => l.tagName === 'UL').flatMap(l => within(l).queryAllByRole('listitem'))
    expect(chips).toHaveLength(2)
    for (const chip of chips) expect(within(chip).getAllByRole('button')).toHaveLength(1)
    expect(document.querySelector('[aria-haspopup]')).toBeNull()
    expect(screen.queryByRole('button', { name: /drag|move|add staff|delete|unassign/i })).toBeNull()
  })

  it('clicking a shift goes to /rostering?date=<week>&shift=<id>', async () => {
    const user = userEvent.setup()
    mockApiGet.mockResolvedValue(staffWeek({ shifts: [shiftOn({})] }))
    const { router } = renderWeek('staff')
    await screen.findByRole('link', { name: 'Mia Chen' })

    await user.click(document.querySelector('[data-shift-open="sh1"]')!)

    expect(router.state.location.pathname).toBe('/rostering')
    expect(router.state.location.search).toBe('?date=2026-11-02&shift=sh1')
  })

  it("staff week: labels link to the participant's week", async () => {
    mockApiGet.mockResolvedValue(staffWeek({ shifts: [shiftOn({})] }))
    renderWeek('staff')
    expect(await screen.findByRole('link', { name: 'Mia Chen' })).toHaveAttribute('href', '/participants/p1?tab=people&section=week&week=2026-11-02')
  })

  it("participant week: labels link to the worker's week; unfilled reads Needs staff", async () => {
    mockApiGet.mockResolvedValue(participantWeek({ shifts: [shiftOn({}), makeUnfilledShift({ id: 'open-1', participantId: 'p1', serviceDate: '2026-11-05' })] }))
    renderWeek('participant')
    expect(await screen.findByRole('link', { name: 'Sam Lee' })).toHaveAttribute('href', '/staff/s1?tab=week&week=2026-11-02')
    expect(screen.getByText('Needs staff')).toBeInTheDocument()
  })

  it('shifts sort by start time within a day', async () => {
    mockApiGet.mockResolvedValue(staffWeek({ shifts: [
      shiftOn({ id: 'late', startTime: '13:00:00', endTime: '15:00:00', participantName: 'Ben Ito', participantId: 'p2' }),
      shiftOn({ id: 'early', startTime: '09:00:00', endTime: '11:00:00' }),
    ] }))
    renderWeek('staff')
    await screen.findByRole('link', { name: 'Ben Ito' })
    const opens = [...document.querySelectorAll('[data-shift-open]')].map(e => e.getAttribute('data-shift-open'))
    expect(opens).toEqual(['early', 'late'])
  })
})

describe('PersonWeek: the week', () => {
  afterEach(() => vi.useRealTimers())

  it('previous, next and This week write week= with replace', async () => {
    const user = userEvent.setup()
    mockApiGet.mockResolvedValue(staffWeek({ shifts: [shiftOn({})] }))
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

  it('empty days say No shifts; today is marked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 4, 12, 0))
    mockApiGet.mockResolvedValue(staffWeek({ shifts: [shiftOn({})] }))
    renderWeek('staff')
    await screen.findByRole('link', { name: 'Mia Chen' })

    expect(within(dayItem(/^Monday 2 November$/)).getByText('No shifts')).toBeInTheDocument()
    expect(within(dayItem(/^Tuesday 3 November$/)).queryByText('No shifts')).toBeNull()
    const today = dayItem(/^Wednesday 4 November, today$/)
    expect(today).toHaveAttribute('aria-current', 'date')
    expect(screen.getByRole('heading', { name: /^Wednesday 4 November, today$/ }).tagName).toBe('H3')
  })

  it('bars render in the lane, once per bar', async () => {
    const trip = { tripInstanceId: 't1', tripCode: 'T-1', tripName: 'Coast trip', startDate: '2026-11-03', endDate: '2026-11-05', isDriver: false }
    mockApiGet.mockResolvedValue(staffWeek({ shifts: [shiftOn({})], tripBars: [trip] }))
    renderWeek('staff')
    const lane = await screen.findByRole('list', { name: 'Leave and trips' })
    expect(within(lane).getAllByRole('link', { name: /Coast trip/ })).toHaveLength(1)
  })

  it('a week with only a trip shows the week, not Nothing rostered', async () => {
    const trip = { tripInstanceId: 't1', tripCode: 'T-1', tripName: 'Coast trip', startDate: '2026-11-03', endDate: '2026-11-03', isDriver: false }
    mockApiGet.mockResolvedValue(participantWeek({ tripBars: [trip] }))
    renderWeek('participant')
    expect(await screen.findByRole('list', { name: 'Leave and trips' })).toBeInTheDocument()
    expect(screen.queryByText('Nothing rostered this week')).toBeNull()
    expect(screen.getAllByText('No shifts').length).toBe(7)
  })

  it('whole empty week shows Nothing rostered this week', async () => {
    mockApiGet.mockResolvedValue(staffWeek())
    renderWeek('staff')
    expect(await screen.findByText('Nothing rostered this week')).toBeInTheDocument()
    expect(screen.getByText('Sam has no shifts this week. Shifts added on the roster board show here.')).toBeInTheDocument()
    for (const link of screen.getAllByRole('link', { name: 'Open in roster' })) expect(link).toHaveAttribute('href', '/rostering?date=2026-11-02')
  })

  it('no row: Not on the roster (staff and participant)', async () => {
    mockApiGet.mockResolvedValue(makeStaffBoard({ weekStart: NOV[0], days: NOV, staffRows: [] }))
    const { unmount } = renderWeek('staff')
    expect(await screen.findByText('Not on the roster')).toBeInTheDocument()
    expect(screen.getByText('Only active staff appear on the roster.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing rostered this week')).toBeNull()
    unmount()

    mockApiGet.mockResolvedValue(makeParticipantBoard({ weekStart: NOV[0], days: NOV, participantRows: [] }))
    renderWeek('participant')
    expect(await screen.findByText('Only active participants appear on the roster.')).toBeInTheDocument()
  })

  it('placeholder week dims and keeps its own day headers', async () => {
    const user = userEvent.setup()
    mockApiGet.mockResolvedValueOnce(staffWeek({ shifts: [shiftOn({})] })).mockReturnValueOnce(new Promise(() => {}))
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

    mockApiGet.mockResolvedValue(staffWeek({ shifts: [shiftOn({})] }))
    await user.click(retry)
    expect(await screen.findByRole('link', { name: 'Mia Chen' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(params(router).get('week')).toBe('2026-11-09')
  })
})

describe('PersonWeek: extras', () => {
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
