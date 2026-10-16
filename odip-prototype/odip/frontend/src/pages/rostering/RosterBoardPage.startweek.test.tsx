import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent } from '@dnd-kit/core'
import RosterBoardPage from './RosterBoardPage'
import { makeFinding, makeParticipantBoard, makeParticipantRow, makeShift, makeStaffBoard, makeStaffRow, makeUnfilledShift } from './test-fixtures'
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

const UNSTARTED = board([
  at({ id: 'one-off', serviceDate: '2026-08-18', staffId: 'staff-2', staffName: 'Sam Wilson', status: 'Published' }),
  makeUnfilledShift({ id: 'open-one-off', participantId: 'p-1', participantName: 'Mia Chen', serviceDate: '2026-08-19', status: 'Draft' }),
], { weekStarted: false })
const STARTED = board(published(DRAFTS))
const W = { poolName: 'Core', periodStart: '2026-07-01', periodEnd: '2026-09-30', available: 800, used: 0, forecast: 900, added: 900, overBy: 100, count: 5, message: 'These 5 shifts take Core to $900.00 of $800.00, $100.00 over.' }
const RESULT = { weekStart: '2026-08-17', created: 5, assignedToRegulars: 3, regularAway: 1, skipped: [{ participantId: 'p-9', fullName: 'Noah Test' }], budgetWarnings: [{ participantId: 'p-1', fullName: 'Mia Chen', warnings: [W] }] }
const CARD = "This week hasn't been started"
const START = 'Start rostering 17–23 Aug'
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('Start rostering', () => {
  beforeEach(() => showBoard(UNSTARTED))

  it('an unstarted week: the Start card over a faded, inert grid, with no strip, no drag and no hint', () => {
    const { container } = renderPage()
    const card = screen.getByRole('region', { name: CARD })
    expect(card).toHaveTextContent("Adds the week's scheduled shifts from approved agreements, with the regular on each one where they're free. Staff see nothing until you publish.")
    expect(card).toHaveTextContent('2 shifts already in this week stay as they are.')
    const start = within(card).getByRole('button', { name: START })
    expect(start).toHaveClass(PRIMARY, 'h-[calc(var(--control-h)+4px)]')
    const inert = container.querySelector('[inert]')
    expect(inert).toHaveAttribute('aria-hidden', 'true')
    expect(inert?.querySelector('[data-shift-chip="one-off"]')).not.toBeNull()
    expect(screen.queryByPlaceholderText('Find staff')).not.toBeInTheDocument()
    expect(h.dnd.props).toBeNull()
    expect(screen.queryByText('Nothing rostered this week')).not.toBeInTheDocument()
    expect(screen.queryByText(/not visible to staff yet/)).not.toBeInTheDocument()
    expect(screen.queryByText('All published')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New shift/ })).not.toHaveClass(PRIMARY)
  })

  it('the Staff view shows the card too, with no strip and no drag', () => {
    sessionStorage.setItem('odip.roster.boardView', 'staff')
    showBoard({ ...makeStaffBoard({ unfilled: [], staffRows: [makeStaffRow({ staffId: 'staff-2', fullName: 'Sam Wilson' })] }), weekStarted: false } as RosterBoardDto)
    renderPage()
    expect(within(screen.getByRole('region', { name: CARD })).getByRole('button', { name: START })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Find staff')).not.toBeInTheDocument()
    expect(h.dnd.props).toBeNull()
  })

  it("no card while the week loads, or when the board doesn't say weekStarted", () => {
    h.board.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    const { unmount } = renderPage()
    expect(screen.queryByRole('region', { name: CARD })).not.toBeInTheDocument()
    unmount()
    showBoard(makeParticipantBoard({ participantRows: [makeParticipantRow({ participantId: 'p-1', fullName: 'Mia Chen', shifts: DRAFTS })] }))
    renderPage()
    expect(screen.queryByRole('region', { name: CARD })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Find staff')).toBeInTheDocument()
  })

  it('a reader is told who starts a week, with no button and no primary action', () => {
    asReader()
    renderPage()
    expect(screen.getByRole('region', { name: CARD })).toHaveTextContent("A coordinator starts each week's rostering.")
    expect(screen.queryByRole('button', { name: /^Start rostering/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button').filter(b => b.classList.contains(PRIMARY) && !b.closest('[role="dialog"],[role="alertdialog"]'))).toEqual([])
  })

  it('Start posts the week, says Starting… while out, then shows what it made and its budget warnings, and moves focus there', async () => {
    const user = userEvent.setup()
    const answer = deferred<typeof RESULT>()
    h.start.mockReturnValueOnce(answer.promise)
    renderPage()

    await user.click(screen.getByRole('button', { name: START }))
    expect(h.start).toHaveBeenCalledWith('2026-08-17')
    const busy = screen.getByRole('button', { name: 'Starting…' })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).toHaveFocus()
    expect(screen.getByRole('region', { name: CARD })).toHaveAttribute('aria-busy', 'true')

    showBoard(STARTED)
    await act(async () => { answer.resolve(RESULT) })
    const title = await screen.findByText('Started 17–23 Aug: 5 shifts added')
    expect(screen.getByText('3 have their regular on them. 1 is open because the regular is away. 1 needs staff: no regular is set. Skipped 1 participant not ready for rostering: Noah Test.')).toBeInTheDocument()
    expect(screen.getByText('Over budget')).toBeInTheDocument()
    expect(screen.getByText(W.message)).toBeInTheDocument()
    expect(screen.getByText('This is a warning only. The shifts were made.')).toBeInTheDocument()
    await waitFor(() => expect(title.closest('[tabindex="-1"]')).toHaveFocus())
    expect(document.activeElement).not.toBe(document.body)
    expect(screen.queryByRole('region', { name: CARD })).not.toBeInTheDocument()
  })

  it('nothing to make: "Started 17–23 Aug" and why', async () => {
    const user = userEvent.setup()
    h.start.mockImplementationOnce(async () => { showBoard(STARTED); return { ...RESULT, created: 0, assignedToRegulars: 0, regularAway: 0, skipped: [], budgetWarnings: undefined } })
    renderPage()
    await user.click(screen.getByRole('button', { name: START }))
    expect(await screen.findByText('Started 17–23 Aug')).toBeInTheDocument()
    expect(screen.getByText('No approved agreement has a shift in this week.')).toBeInTheDocument()
  })

  it('already started by someone else: the info notice, never the error, and focus on it', async () => {
    const user = userEvent.setup()
    h.start.mockImplementationOnce(async () => {
      showBoard(STARTED)
      throw { response: { status: 409, data: { success: false, errors: ['This week has already been started.'], code: 'roster-week-started' } } }
    })
    renderPage()
    await user.click(screen.getByRole('button', { name: START }))

    const title = await screen.findByText('This week was already started')
    expect(screen.getByText("Someone started it a moment ago, so nothing was added twice. The board shows what's on the roster now.")).toBeInTheDocument()
    expect(screen.queryByText('This week has already been started.')).not.toBeInTheDocument()
    expect(document.querySelector('[role="alert"]')).toBeNull()
    await waitFor(() => expect(title.closest('[tabindex="-1"]')).toHaveFocus())
  })

  it("busy or any other refusal: the server's words in the error Callout, and focus stays on the button", async () => {
    const user = userEvent.setup()
    h.start.mockRejectedValueOnce({ response: { status: 409, data: { success: false, errors: ['Another change to the roster is still running.'] } } })
    renderPage()
    await user.click(screen.getByRole('button', { name: START }))

    expect((await screen.findByText('Another change to the roster is still running.')).closest('[role="alert"]')).not.toBeNull()
    const start = screen.getByRole('button', { name: START })
    expect(start).toHaveFocus()
    expect(start).not.toHaveAttribute('aria-disabled')

    h.start.mockRejectedValueOnce(new Error('network'))
    await user.click(start)
    expect(await screen.findByText('Something went wrong starting this week. Please try again.')).toBeInTheDocument()
  })

  it('a late answer, for a week no longer shown, sets no notice and moves no focus: it is only announced', async () => {
    const user = userEvent.setup()
    const answer = deferred<typeof RESULT>()
    h.start.mockReturnValueOnce(answer.promise)
    renderPage()

    await user.click(screen.getByRole('button', { name: START }))
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    await act(async () => { answer.resolve(RESULT) })

    const said = await screen.findAllByText('Started 17–23 Aug: 5 shifts added')
    expect(said).toHaveLength(1)
    expect(said[0]).toHaveClass('sr-only')
    expect(screen.getByRole('button', { name: 'Next week' })).toHaveFocus()
  })

  it("a week's notices go with it: Dismiss clears them, and so does a move to another week", async () => {
    const user = userEvent.setup()
    h.start.mockImplementation(async () => { showBoard(STARTED); return RESULT })
    const { unmount } = renderPage()
    await user.click(screen.getByRole('button', { name: START }))
    await screen.findByText('Started 17–23 Aug: 5 shifts added')
    await user.click(screen.getByRole('button', { name: 'Dismiss notice' }))
    expect(screen.queryByText('Started 17–23 Aug: 5 shifts added')).not.toBeInTheDocument()
    expect(screen.queryByText(W.message)).not.toBeInTheDocument()
    unmount()

    showBoard(UNSTARTED)
    renderPage()
    await user.click(screen.getByRole('button', { name: START }))
    await screen.findByText('Started 17–23 Aug: 5 shifts added')
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(screen.queryByText(/^Started/)).not.toBeInTheDocument()
  })
})
