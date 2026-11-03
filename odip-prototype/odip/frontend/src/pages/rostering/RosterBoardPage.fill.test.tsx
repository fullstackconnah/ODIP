import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RosterBoardPage from './RosterBoardPage'
import { makeParticipantBoard, makeParticipantRow, makeShift } from './test-fixtures'
import type { RosterBoardDto, RosterFillDto, ShiftDto } from '@/api/types'

// The fill chart on the board page (shape brief 2026-10-31): who sees it, and that choosing a week goes through the leave guard.
const h = vi.hoisted(() => ({ board: vi.fn(), fill: vi.fn() }))

vi.mock('@/api/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks')>('@/api/hooks')
  return {
    ...actual,
    useRosterBoard: h.board,
    useRosterFill: h.fill,
    useAssignShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useMoveStaff: () => ({ mutateAsync: vi.fn(), isPending: false }),
    usePublishWeek: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useStartWeek: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useSetRegular: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCreateShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useParticipants: () => ({ data: [] }),
    useStaff: () => ({ data: [], isLoading: false }),
    useParticipantRoutines: () => ({ data: [] }),
    useCompatibility: () => ({ data: [] }),
    useRosterShiftNotes: () => ({ data: [] }),
    useCheckShift: () => ({ mutate: vi.fn(), isPending: false }),
  }
})
vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => false }))

const mondays = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']
const FILL: RosterFillDto = {
  today: '2026-08-18',
  weeks: mondays.map((weekStart, i) => ({ weekStart, shifts: 10, filled: 10 - i % 3, open: i % 3, hoursFilled: 80, hoursOpen: 8, draft: 0 })),
}
const draft = (o: Partial<ShiftDto>) => makeShift({ participantId: 'p-1', participantName: 'Mia Chen', startTime: '09:00:00', endTime: '15:00:00', durationHours: 6, status: 'Draft', ...o })
const board = (shifts: ShiftDto[]): RosterBoardDto =>
  makeParticipantBoard({ weekStarted: true, participantRows: [makeParticipantRow({ participantId: 'p-1', fullName: 'Mia Chen', shifts })] })
const DRAFTS = [draft({ id: 'sam-wed', serviceDate: '2026-08-19', staffId: 'staff-2', staffName: 'Sam Wilson' })]
const PUBLISHED = [draft({ id: 'pub', serviceDate: '2026-08-18', staffId: 'staff-2', staffName: 'Sam Wilson', status: 'Published' })]
const as = (role: string) => localStorage.setItem('odip_user', JSON.stringify({ role }))
const showBoard = (data: RosterBoardDto) => h.board.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn() })

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/rostering', element: <RosterBoardPage /> }], { initialEntries: ['/rostering?date=2026-08-17'] })
  return render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
}
const openFill = () => userEvent.click(screen.getByRole('button', { name: 'Next 8 weeks' }))
const plot = () => screen.getByRole('group', { name: /Shifts filled and open for each of the next 8 weeks/ })
const heading = () => document.getElementById('roster-week-heading')
const lastWeekAsked = () => h.board.mock.calls[h.board.mock.calls.length - 1][0]

beforeEach(() => {
  h.board.mockReset(); h.fill.mockReset()
  h.fill.mockReturnValue({ data: FILL, isLoading: false, isError: false, error: null, refetch: vi.fn() })
  showBoard(board(PUBLISHED))
  localStorage.clear()
  sessionStorage.clear()
})

describe('the fill chart on the Rostering page (Next 8 weeks, roster declutter 2026-11-03)', () => {
  it.each(['SuperAdmin', 'Admin', 'Coordinator'])('%s gets a Next 8 weeks button, and the chart is not on the page until it is pressed', async role => {
    as(role)
    renderPage()
    expect(screen.queryByRole('group', { name: /Shifts filled and open/ })).toBeNull()
    await openFill()
    const panel = screen.getByRole('dialog', { name: 'Next 8 weeks' })
    expect(within(panel).getByRole('group', { name: /Shifts filled and open for each of the next 8 weeks/ })).toBeTruthy()
    expect(within(panel).queryByRole('heading', { name: 'How full the next weeks are' })).toBeNull()
  })

  it('an unstarted week shows the Start card, and the fill chart stays behind its button', () => {
    as('Admin')
    showBoard({ ...board(DRAFTS), weekStarted: false, canStart: true } as RosterBoardDto)
    const { container } = renderPage()
    expect(screen.getByRole('region', { name: "This week hasn't been started" })).toBeTruthy()
    expect(screen.queryByRole('group', { name: /Shifts filled and open/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Next 8 weeks' })).toBeTruthy()
    expect(container.querySelector('[inert]')).toBeNull()
  })

  it.each(['SupportWorker', 'ReadOnly'])('%s has no Next 8 weeks button', role => {
    as(role)
    renderPage()
    expect(screen.queryByRole('button', { name: 'Next 8 weeks' })).toBeNull()
  })

  it('choosing a week with nothing to publish closes the panel and moves the board there', async () => {
    as('Admin')
    renderPage()
    await openFill()
    const p = plot()
    p.focus()
    fireEvent.keyDown(p, { key: 'ArrowRight' })
    fireEvent.keyDown(p, { key: 'Enter' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Next 8 weeks' })).toBeNull()
    expect(lastWeekAsked()).toBe('2026-08-24')
  })

  it('choosing a week with publishable drafts asks first; Stay keeps the week and returns focus to Next 8 weeks, Leave moves', async () => {
    as('Admin')
    showBoard(board(DRAFTS))
    renderPage()
    const week = heading()?.textContent
    await openFill()
    const p = plot()
    p.focus()
    fireEvent.keyDown(p, { key: 'ArrowRight' })
    fireEvent.keyDown(p, { key: 'Enter' })
    const dialog = screen.getByRole('alertdialog', { name: 'Leave without publishing?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stay' }))
    expect(heading()?.textContent).toBe(week)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next 8 weeks' })).toHaveFocus())

    await openFill()
    fireEvent.keyDown(plot(), { key: 'ArrowRight' })
    fireEvent.keyDown(plot(), { key: 'Enter' })
    await userEvent.click(screen.getByRole('button', { name: 'Leave without publishing' }))
    expect(lastWeekAsked()).toBe('2026-08-24')
  })
})
