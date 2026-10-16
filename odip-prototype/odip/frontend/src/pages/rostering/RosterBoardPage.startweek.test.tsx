import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent } from '@dnd-kit/core'
import RosterBoardPage from './RosterBoardPage'
import { makeFinding, makeParticipantBoard, makeParticipantRow, makeShift, makeUnfilledShift } from './test-fixtures'
import type { RosterBoardDto, ShiftDto } from '@/api/types'

// Start rostering, the Publish banner, the leave guard and the regular (the brief, 2026-10-16): the page's half.
const h = vi.hoisted(() => ({
  board: vi.fn(), assign: vi.fn(), move: vi.fn(), publish: vi.fn(), create: vi.fn(), start: vi.fn(), setRegular: vi.fn(),
  dnd: { props: null as null | { onDragEnd: (event: DragEndEvent) => void } },
  screen: { belowMd: false },
  staff: [
    { id: 'staff-2', fullName: 'Sam Wilson', isActive: true, region: 'North', hasExpiredQualifications: false },
    { id: 'staff-9', fullName: 'Alex Ng', isActive: true, region: 'South', hasExpiredQualifications: false },
  ],
}))

vi.mock('@/api/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks')>('@/api/hooks')
  return {
    ...actual,
    useRosterBoard: h.board,
    useAssignShift: () => ({ mutateAsync: h.assign, isPending: false }),
    useMoveStaff: () => ({ mutateAsync: h.move, isPending: false }),
    usePublishWeek: () => ({ mutateAsync: h.publish, isPending: false }),
    useStartWeek: () => ({ mutateAsync: h.start, isPending: false }),
    useSetRegular: () => ({ mutateAsync: h.setRegular, isPending: false }),
    useCreateShift: () => ({ mutateAsync: h.create, isPending: false }),
    useUpdateShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useParticipants: () => ({ data: [] }),
    useStaff: () => ({ data: h.staff, isLoading: false }),
    useParticipantRoutines: () => ({ data: [] }),
    useCompatibility: () => ({ data: [] }),
    useRosterShiftNotes: () => ({ data: [] }),
    useCheckShift: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

vi.mock('@dnd-kit/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const { createElement } = await import('react')
  return {
    ...actual,
    DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
      h.dnd.props = props as never
      return createElement(actual.DndContext, props)
    },
  }
})

vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => h.screen.belowMd }))

// The week of Monday 2026-08-17, participant Mia Chen. Four drafts (an open Tuesday, Sam's Wednesday from a pattern, Alex's Friday, Sam's Saturday) and Alex's Published Monday.
const at = (o: Partial<ShiftDto>) => makeShift({ participantId: 'p-1', participantName: 'Mia Chen', startTime: '09:00:00', endTime: '15:00:00', durationHours: 6, status: 'Draft', ...o })
const DRAFTS = [
  makeUnfilledShift({ id: 'open-tue', participantId: 'p-1', participantName: 'Mia Chen', serviceDate: '2026-08-18', startTime: '09:00:00', endTime: '15:00:00', status: 'Draft' }),
  at({ id: 'sam-wed', serviceDate: '2026-08-19', staffId: 'staff-2', staffName: 'Sam Wilson', shiftPatternId: 'pat-wed' }),
  at({ id: 'alex-fri', serviceDate: '2026-08-21', staffId: 'staff-9', staffName: 'Alex Ng' }),
  at({ id: 'sam-sat', serviceDate: '2026-08-22', staffId: 'staff-2', staffName: 'Sam Wilson' }),
  at({ id: 'alex-mon', serviceDate: '2026-08-17', staffId: 'staff-9', staffName: 'Alex Ng', status: 'Published' }),
]
const BLOCKED = at({ id: 'blocked', serviceDate: '2026-08-20', staffId: 'staff-9', staffName: 'Alex Ng', findings: [makeFinding({ code: 'WSC_EXPIRED', severity: 'Blocking' })] })
const board = (shifts: ShiftDto[], extra: Partial<Extract<RosterBoardDto, { groupBy: 'Participant' }>> = {}) =>
  makeParticipantBoard({ weekStarted: true, participantRows: [makeParticipantRow({ participantId: 'p-1', fullName: 'Mia Chen', shifts })], ...extra })
const published = (shifts: ShiftDto[]) => shifts.map(s => ({ ...s, status: 'Published' as const }))
const showBoard = (data: RosterBoardDto) => h.board.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn() })
const asReader = () => localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
const PRIMARY = 'bg-[var(--color-primary)]'

function renderPage(entry = '/rostering?date=2026-08-17', routes: { path: string; element: React.ReactNode }[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/rostering', element: <RosterBoardPage /> }, ...routes], { initialEntries: [entry] })
  return { ...render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>), router }
}

beforeEach(() => {
  for (const fn of [h.board, h.assign, h.move, h.publish, h.create, h.start, h.setRegular]) fn.mockReset()
  showBoard(board(DRAFTS))
  h.dnd.props = null
  h.screen.belowMd = false
  sessionStorage.clear()
  localStorage.clear()
})

describe('the Publish banner', () => {
  it('a started week with drafts: the banner comes first in the notices, counts the drafts, and holds Publish week, the one primary', () => {
    showBoard(board(DRAFTS, { pendingAgreements: [{ participantId: 'p-2', displayName: 'Daniel Osei', draftId: 'd-2', version: 2, canReceiveServices: true }] }))
    renderPage()

    const title = screen.getByText('4 shifts not visible to staff yet')
    expect(title.closest('[role="alert"]')).toBeNull()
    const waiting = screen.getByText(/Shifts from a service agreement appear here/)
    expect(title.compareDocumentPosition(waiting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const banner = title.closest('[class*="color-warning-container"]') as HTMLElement
    expect(within(banner).getByRole('button', { name: 'Publish week' })).toHaveClass(PRIMARY)
    expect(screen.queryByText('4 drafts')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New shift/ })).not.toHaveClass(PRIMARY)
  })

  it('blocked drafts: the banner says so, Publish week sends only the rest, and all-blocked hides the button', async () => {
    const user = userEvent.setup()
    showBoard(board([...DRAFTS, BLOCKED]))
    const { unmount } = renderPage()

    expect(screen.getByText('5 shifts not visible to staff yet')).toBeInTheDocument()
    expect(screen.getByText("1 of them can't be published until the worker changes: a rule that can't be overridden blocks it.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Publish week' }))
    expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publish 4 shifts' })).toBeInTheDocument()
    unmount()

    showBoard(board([BLOCKED]))
    renderPage()
    expect(screen.getByText(/^It can't be published/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish week' })).not.toBeInTheDocument()
  })

  it('a reader sees the banner without Publish week', () => {
    asReader()
    renderPage()
    expect(screen.getByText('4 shifts not visible to staff yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish week' })).not.toBeInTheDocument()
  })

  it('all published: no banner, and the toolbar says "All published"', () => {
    showBoard(board(published(DRAFTS)))
    renderPage()
    expect(screen.queryByText(/not visible to staff yet/)).not.toBeInTheDocument()
    expect(screen.getByText('All published')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New shift/ })).toHaveClass(PRIMARY)
  })

  it('after publishing, focus is on the week heading, never on body', async () => {
    const user = userEvent.setup()
    h.publish.mockResolvedValueOnce({ published: 4, notified: 2, unfilled: 1, skipped: 0 })
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Publish week' }))
    showBoard(board(published(DRAFTS)))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publish 4 shifts' }))

    await waitFor(() => expect(document.getElementById('roster-week-heading')).toHaveFocus())
    expect(screen.queryByText(/not visible to staff yet/)).not.toBeInTheDocument()
  })
})
