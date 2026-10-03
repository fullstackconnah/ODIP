import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RosterBoardPage from './RosterBoardPage'
import { makeParticipantBoard, makeParticipantRow, makeShift, makeStaffBoard, makeStaffRow } from './test-fixtures'
import type { RosterBoardDto } from '@/api/types'
import { weekStartOf } from './lib/roster'

const { mockUseRosterBoard, mockUseParticipants, mockAssignMutateAsync, mockDeleteMutateAsync } = vi.hoisted(() => ({
  mockUseRosterBoard: vi.fn(),
  mockUseParticipants: vi.fn(),
  mockAssignMutateAsync: vi.fn(),
  mockDeleteMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks')>('@/api/hooks')
  return {
    ...actual,
    useRosterBoard: mockUseRosterBoard,
    useAssignShift: () => ({ mutateAsync: mockAssignMutateAsync, isPending: false }),
    useDeleteShift: () => ({ mutateAsync: mockDeleteMutateAsync, isPending: false }),
    useParticipants: mockUseParticipants,
    useStaff: () => ({ data: [] }),
    // The shift panel (mounted by the page) reads these for the picked participant; stubbed so a test that opens it makes no real request.
    useParticipantRoutines: () => ({ data: [] }),
    useCompatibility: () => ({ data: [] }),
    useRosterShiftNotes: () => ({ data: [] }),
    useCheckShift: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

function renderPage(entry = '/rostering') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <RosterBoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** A board with one filled shift whose assignee has approved leave, plus the matching
 * server-provided ASSIGNEE_ON_LEAVE exception RosteringController.GetBoard now emits for it. */
function makeBoardWithLeaveException(): RosterBoardDto {
  return makeParticipantBoard({
    participantRows: [
      makeParticipantRow({
        participantId: 'p-1',
        fullName: 'Grace Palmer-Hughes',
        shifts: [makeShift({
          id: 'shift-on-leave',
          participantId: 'p-1',
          participantName: 'Grace Palmer-Hughes',
          staffId: 'staff-9',
          staffName: 'Mei Zhang',
          serviceDate: '2026-08-18',
          assigneeOnApprovedLeave: true,
        })],
      }),
    ],
    exceptions: [{
      shiftId: 'shift-on-leave',
      participantName: 'Grace Palmer-Hughes',
      serviceDate: '2026-08-18',
      finding: {
        code: 'ASSIGNEE_ON_LEAVE',
        severity: 'Warning',
        message: 'Mei Zhang is on approved leave on 2026-08-18',
        requiresReason: false,
      },
    }],
  })
}

beforeEach(() => {
  mockUseRosterBoard.mockReset()
  mockUseParticipants.mockReset()
  mockUseParticipants.mockReturnValue({ data: [] })
  mockAssignMutateAsync.mockReset()
  mockDeleteMutateAsync.mockReset()
  localStorage.clear()
})

describe('RosterBoardPage — ASSIGNEE_ON_LEAVE exception comes from the server', () => {
  it('counts the server-provided exception once (not doubled by client synthesis) and shows it in the drawer', async () => {
    const user = userEvent.setup()
    mockUseRosterBoard.mockReturnValue({ data: makeBoardWithLeaveException(), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    const exceptionsButton = screen.getByRole('button', { name: '1 exception' })
    expect(exceptionsButton).toBeInTheDocument()

    await user.click(exceptionsButton)

    expect(screen.getByText('Mei Zhang is on approved leave on 2026-08-18')).toBeInTheDocument()
    // Exactly one entry rendered for the shift — no duplicate synthesised alongside the server one.
    expect(screen.getAllByText('Mei Zhang is on approved leave on 2026-08-18')).toHaveLength(1)
  })

  it('shows zero exceptions when the server sends none, even though a shift is flagged assigneeOnApprovedLeave', () => {
    const board = makeBoardWithLeaveException()
    mockUseRosterBoard.mockReturnValue({
      data: { ...board, exceptions: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()

    expect(screen.getByRole('button', { name: '0 exceptions' })).toBeInTheDocument()
  })
})

describe('RosterBoardPage — load error', () => {
  it('offers Retry as a Button at --control-h, not EmptyState\'s hand-rolled 44px link, and refetches when pressed', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    mockUseRosterBoard.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    const { container } = renderPage()

    expect(screen.getByText('Couldn\'t load the roster board')).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry).toHaveClass('h-[var(--control-h)]', 'rounded-[var(--radius-sm)]')
    // EmptyState's own action slot is where that min-h-[44px] button comes from; it is left unused here.
    expect(container.querySelector('.min-h-\\[44px\\]')).toBeNull()

    await user.click(retry)
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})

// ── The server's refusal of an assign / unassign (readiness Enforce mode) ────────────────────────────────────────────
// Anything that is not the 422 findings protocol used to be swallowed (`if (!findings) return`): a drag, an "Unassign" or an
// "Assign anyway" that the server refused simply did nothing. In Enforce mode the API answers 400
// "Participant is not ready for booking or rostering."; the board has to say so.
const NOT_READY_MESSAGE = 'Participant is not ready for booking or rostering.'
const GENERIC_ASSIGN_ERROR = 'Something went wrong assigning this shift. Please try again.'

/** What axios rejects with for a 400 carrying the API's ApiResponse envelope. */
function badRequest(...errors: string[]) {
  return { response: { status: 400, data: { success: false, errors } } }
}

/** What axios rejects with for the 422 findings protocol (a Warning finding that needs a reason to proceed). */
function warningFindings() {
  return {
    response: {
      status: 422,
      data: {
        success: false,
        data: [{ code: 'RATIO_SHORTFALL', severity: 'Warning', message: 'Ratio not met for this window.', requiresReason: true }],
      },
    },
  }
}

/** A board with one covered shift for Mia Chen, whose chip menu offers Unassign. */
function makeBoardWithFilledShift(): RosterBoardDto {
  return makeParticipantBoard({
    participantRows: [
      makeParticipantRow({
        participantId: 'participant-1',
        fullName: 'Mia Chen',
        daysWithoutCover: 6,
        shifts: [makeShift({ id: 'shift-1', participantId: 'participant-1', participantName: 'Mia Chen', staffId: 'staff-1', staffName: 'Alex Rivera', serviceDate: '2026-08-18' })],
      }),
    ],
  })
}

async function unassignMiasShift(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: "Actions for Mia Chen's shift" }))
  await user.click(screen.getByRole('option', { name: 'Unassign' }))
}

describe('RosterBoardPage — an assign the server refuses is no longer swallowed', () => {
  it('shows the server\'s own message in a dismissible alert, not a generic line, and sent the full body', async () => {
    const user = userEvent.setup()
    mockUseRosterBoard.mockReturnValue({ data: makeBoardWithFilledShift(), isLoading: false, isError: false, refetch: vi.fn() })
    mockAssignMutateAsync.mockRejectedValueOnce(badRequest(NOT_READY_MESSAGE))
    renderPage()

    await unassignMiasShift(user)

    expect(mockAssignMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockAssignMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', data: { staffId: null, overrideReason: null, acknowledgedFindingCodes: [] } })
    const message = await screen.findByText(NOT_READY_MESSAGE)
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(screen.queryByText(GENERIC_ASSIGN_ERROR)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dismiss error' }))
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })

  it('sits above the grid, and the grid is still there', async () => {
    const user = userEvent.setup()
    mockUseRosterBoard.mockReturnValue({ data: makeBoardWithFilledShift(), isLoading: false, isError: false, refetch: vi.fn() })
    mockAssignMutateAsync.mockRejectedValueOnce(badRequest(NOT_READY_MESSAGE))
    renderPage()

    await unassignMiasShift(user)

    const alert = (await screen.findByText(NOT_READY_MESSAGE)).closest('[role="alert"]') as HTMLElement
    const grid = screen.getByRole('link', { name: 'Mia Chen' })
    expect(Boolean(alert.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it.each([
    ['a network failure with no response', new Error('Network Error')],
    ['a 500 with an empty body', { response: { status: 500, data: {} } }],
  ])('falls back to the generic line for %s', async (_label, failure) => {
    const user = userEvent.setup()
    mockUseRosterBoard.mockReturnValue({ data: makeBoardWithFilledShift(), isLoading: false, isError: false, refetch: vi.fn() })
    mockAssignMutateAsync.mockRejectedValueOnce(failure)
    renderPage()

    await unassignMiasShift(user)

    expect(await screen.findByText(GENERIC_ASSIGN_ERROR)).toBeInTheDocument()
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })

  it('is cleared when the next attempt starts, even before it finishes', async () => {
    const user = userEvent.setup()
    mockUseRosterBoard.mockReturnValue({ data: makeBoardWithFilledShift(), isLoading: false, isError: false, refetch: vi.fn() })
    mockAssignMutateAsync
      .mockRejectedValueOnce(badRequest(NOT_READY_MESSAGE))
      .mockReturnValueOnce(new Promise(() => {})) // the retry is still in flight
    renderPage()

    await unassignMiasShift(user)
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()

    await unassignMiasShift(user)

    expect(mockAssignMutateAsync).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })

  it('"Assign anyway": a 400 on the retry closes the dialog and shows the message on the page, with the full override body sent', async () => {
    const user = userEvent.setup()
    mockUseRosterBoard.mockReturnValue({ data: makeBoardWithFilledShift(), isLoading: false, isError: false, refetch: vi.fn() })
    mockAssignMutateAsync
      .mockRejectedValueOnce(warningFindings())
      .mockRejectedValueOnce(badRequest(NOT_READY_MESSAGE))
    renderPage()

    await unassignMiasShift(user)
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Ratio not met for this window.')).toBeInTheDocument()
    await user.type(within(dialog).getByPlaceholderText('Reason for overriding these warnings'), 'Approved by the coordinator')
    await user.click(within(dialog).getByRole('button', { name: 'Assign anyway' }))

    expect(mockAssignMutateAsync).toHaveBeenCalledTimes(2)
    expect(mockAssignMutateAsync).toHaveBeenLastCalledWith({
      id: 'shift-1',
      data: { staffId: null, overrideReason: 'Approved by the coordinator', acknowledgedFindingCodes: ['RATIO_SHORTFALL'] },
    })
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()
    // The overlay would have hidden the message from sight and from assistive tech, so the dialog is gone.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByText(GENERIC_ASSIGN_ERROR)).not.toBeInTheDocument()
  })

  it('leaves the 422 findings protocol alone: Warnings still open the Assign-with-warnings dialog and no error banner', async () => {
    const user = userEvent.setup()
    mockUseRosterBoard.mockReturnValue({ data: makeBoardWithFilledShift(), isLoading: false, isError: false, refetch: vi.fn() })
    mockAssignMutateAsync.mockRejectedValueOnce(warningFindings())
    renderPage()

    await unassignMiasShift(user)

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss error' })).not.toBeInTheDocument()
    expect(screen.queryByText(GENERIC_ASSIGN_ERROR)).not.toBeInTheDocument()
  })

  it('shows no banner when the assign succeeds', async () => {
    const user = userEvent.setup()
    mockUseRosterBoard.mockReturnValue({ data: makeBoardWithFilledShift(), isLoading: false, isError: false, refetch: vi.fn() })
    mockAssignMutateAsync.mockResolvedValueOnce(makeShift({ staffId: null, staffName: null }))
    renderPage()

    await unassignMiasShift(user)

    expect(mockAssignMutateAsync).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Dismiss error' })).not.toBeInTheDocument()
  })
})

// ── Participant readiness (WARN mode) on the board ───────────────────────────────────────────────────────────────────
describe('RosterBoardPage — readiness warnings (never in the way)', () => {
  const ISSUES = ['Intake not complete', 'No signed service agreement']
  const WARNING = 'Not ready: Intake not complete · No signed service agreement'

  it('shows a chip on a participant row whose server data lists issues, and none on a row without', () => {
    mockUseRosterBoard.mockReturnValue({
      data: makeParticipantBoard({
        participantRows: [
          makeParticipantRow({ participantId: 'participant-1', fullName: 'Mia Chen', readinessIssues: ISSUES }),
          makeParticipantRow({ participantId: 'participant-2', fullName: 'Noah Reid' }),
        ],
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()

    const chip = screen.getByText(WARNING)
    expect(chip.closest('[title]')).toHaveAttribute('title', WARNING)
    // On Mia's row header, not Noah's.
    const miaHeader = screen.getByRole('link', { name: 'Mia Chen' }).closest('.sticky') as HTMLElement
    const noahHeader = screen.getByRole('link', { name: 'Noah Reid' }).closest('.sticky') as HTMLElement
    expect(miaHeader).toContainElement(chip)
    expect(noahHeader.textContent).not.toMatch(/not ready/i)
    expect(screen.getAllByText(/not ready/i)).toHaveLength(1)
  })

  it('hands the new-shift panel the readiness issues of the participants list, so the picked participant\'s warning shows and Save stays available', async () => {
    const user = userEvent.setup()
    mockUseRosterBoard.mockReturnValue({
      data: makeParticipantBoard({ participantRows: [makeParticipantRow({ participantId: 'participant-1', fullName: 'Mia Chen' })] }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    mockUseParticipants.mockReturnValue({
      data: [
        { id: 'participant-1', fullName: 'Mia Chen', readinessIssues: ISSUES },
        { id: 'participant-2', fullName: 'Noah Reid' },
      ],
    })
    renderPage()

    await user.click(screen.getAllByRole('button', { name: /^Add a shift for Mia Chen on/ })[0])

    const panel = await screen.findByRole('dialog', { name: 'New shift' })
    expect(within(panel).getByText(WARNING)).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /^save$/i })).toBeEnabled()
  })

  it('shows no warning in the panel for a participant the list says is ready', async () => {
    const user = userEvent.setup()
    mockUseRosterBoard.mockReturnValue({
      data: makeParticipantBoard({ participantRows: [makeParticipantRow({ participantId: 'participant-2', fullName: 'Noah Reid' })] }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    mockUseParticipants.mockReturnValue({
      data: [
        { id: 'participant-1', fullName: 'Mia Chen', readinessIssues: ISSUES },
        { id: 'participant-2', fullName: 'Noah Reid' },
      ],
    })
    renderPage()

    await user.click(screen.getAllByRole('button', { name: /^Add a shift for Noah Reid on/ })[0])

    const panel = await screen.findByRole('dialog', { name: 'New shift' })
    expect(within(panel).queryByText(/not ready/i)).not.toBeInTheDocument()
  })

  it('an open shift whose participant is not in the list falls back to the shift\'s own readinessIssues', async () => {
    const user = userEvent.setup()
    const board = makeParticipantBoard({
      participantRows: [
        makeParticipantRow({
          participantId: 'participant-1',
          fullName: 'Mia Chen',
          shifts: [makeShift({ id: 'shift-1', participantId: 'participant-1', participantName: 'Mia Chen', serviceDate: '2026-08-18', readinessIssues: ['Intake not complete'] })],
        }),
      ],
    })
    mockUseRosterBoard.mockReturnValue({ data: board, isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    await user.click(screen.getByRole('button', { name: "Actions for Mia Chen's shift" }))
    await user.click(screen.getByRole('option', { name: 'Edit' }))

    const panel = await screen.findByRole('dialog', { name: 'Shift details' })
    expect(within(panel).getByText('Not ready: Intake not complete')).toBeInTheDocument()
  })
})

// L5-08: the "Re-cover shift" task the server raises for a shift left uncovered by approved leave links to /rostering?date=YYYY-MM-DD, and the
// board ignored it: it always opened on the current week, so the coordinator landed on a week with nothing about that shift.
describe('RosterBoardPage — ?date= opens the week that contains it', () => {
  beforeEach(() => {
    mockUseRosterBoard.mockReset()
    mockUseRosterBoard.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    mockUseParticipants.mockReturnValue({ data: [] })
  })

  it('asks the server for the Monday-start week of a mid-week ?date=', () => {
    renderPage('/rostering?date=2026-12-16')   // a Wednesday: its week starts Mon 14 Dec

    expect(mockUseRosterBoard).toHaveBeenCalled()
    for (const call of mockUseRosterBoard.mock.calls) expect(call[0]).toBe('2026-12-14')
  })

  it('keeps a ?date= that is already a Monday', () => {
    renderPage('/rostering?date=2026-12-14')

    for (const call of mockUseRosterBoard.mock.calls) expect(call[0]).toBe('2026-12-14')
  })

  it('follows a later change of ?date= on a board that is already open', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createMemoryRouter([{ path: '/rostering', element: <RosterBoardPage /> }], { initialEntries: ['/rostering?date=2026-12-16'] })
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
    expect(mockUseRosterBoard.mock.calls.at(-1)?.[0]).toBe('2026-12-14')

    await act(async () => { await router.navigate('/rostering?date=2027-01-06') })   // a Wednesday: its week starts Mon 4 Jan

    expect(mockUseRosterBoard.mock.calls.at(-1)?.[0]).toBe('2027-01-04')
  })

  it('opens the current week when ?date= is missing, malformed or not a real day', () => {
    const current = weekStartOf(new Date())
    for (const entry of ['/rostering', '/rostering?date=', '/rostering?date=soon', '/rostering?date=2026-02-30', '/rostering?date=2026-13-01']) {
      mockUseRosterBoard.mockClear()
      const { unmount } = renderPage(entry)
      for (const call of mockUseRosterBoard.mock.calls) expect(call[0], entry).toBe(current)
      unmount()
    }
  })
})

// Plan builder phase D: approving an agreement revision links to /rostering?date=<Monday>&participant=<id>&unfilled=1, and the "Review them" link in the confirm dialog to the same without
// unfilled. The board used to read only ?date=; the participant filter and the unfilled-only toggle were local state, so the link opened a board for everybody.
describe('RosterBoardPage — ?participant= and ?unfilled= open the board already filtered', () => {
  const twoParticipants = () => makeParticipantBoard({
    participantRows: [
      makeParticipantRow({ participantId: 'p-1', fullName: 'Amy Ng' }),
      makeParticipantRow({ participantId: 'p-2', fullName: 'Ben Ito' }),
    ],
  })
  const staffBoard = () => makeStaffBoard({
    staffRows: [makeStaffRow({ staffId: 'staff-1', fullName: 'Casey Roe' })],
    unfilled: [
      makeShift({ id: 'open-amy', participantId: 'p-1', participantName: 'Amy Ng', staffId: null, staffName: null }),
      makeShift({ id: 'open-ben', participantId: 'p-2', participantName: 'Ben Ito', staffId: null, staffName: null }),
    ],
  })

  // A name is on screen when the board draws it (the toolbar's filter also says the chosen participant's name, so a name can be there twice).
  const shown = (name: string) => screen.queryAllByText(new RegExp(name)).length > 0

  beforeEach(() => {
    mockUseParticipants.mockReturnValue({ data: [{ id: 'p-1', fullName: 'Amy Ng' }, { id: 'p-2', fullName: 'Ben Ito' }] })
    sessionStorage.clear()
  })

  it('shows only that participant\'s row, and the filter says whose it is', () => {
    mockUseRosterBoard.mockReturnValue({ data: twoParticipants(), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage('/rostering?date=2026-10-14&participant=p-1')

    expect(shown('Amy Ng')).toBe(true)
    expect(shown('Ben Ito')).toBe(false)
    expect(mockUseRosterBoard.mock.calls.at(-1)?.[0]).toBe('2026-10-12')       // and the week is the one the link named
  })

  it('shows every participant when the address names none, or names one the board does not know', () => {
    mockUseRosterBoard.mockReturnValue({ data: twoParticipants(), isLoading: false, isError: false, refetch: vi.fn() })
    const { unmount } = renderPage('/rostering?date=2026-10-14')
    expect(shown('Ben Ito')).toBe(true)
    unmount()

    renderPage('/rostering?participant=')
    expect(shown('Amy Ng')).toBe(true)
    expect(shown('Ben Ito')).toBe(true)
  })

  it('opens the staff board with "Unfilled only" pressed and only that participant\'s open shifts when ?unfilled=1', () => {
    sessionStorage.setItem('odip.roster.boardView', 'staff')
    mockUseRosterBoard.mockReturnValue({ data: staffBoard(), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage('/rostering?date=2026-10-14&participant=p-1&unfilled=1')

    expect(screen.getByRole('button', { name: 'Unfilled only' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Casey Roe')).not.toBeInTheDocument()            // the staff rows are out of the way, the open shifts are the board
    expect(shown('Amy Ng')).toBe(true)
    expect(shown('Ben Ito')).toBe(false)
  })

  it('leaves "Unfilled only" off unless the address asks for it', () => {
    sessionStorage.setItem('odip.roster.boardView', 'staff')
    mockUseRosterBoard.mockReturnValue({ data: staffBoard(), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage('/rostering?date=2026-10-14&participant=p-1')

    expect(screen.getByRole('button', { name: 'Unfilled only' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Casey Roe')).toBeInTheDocument()
  })

  it('follows a later change of the address on a board that is already open, and lets the toolbar own the filters in between', async () => {
    const user = userEvent.setup()
    mockUseRosterBoard.mockReturnValue({ data: twoParticipants(), isLoading: false, isError: false, refetch: vi.fn() })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createMemoryRouter([{ path: '/rostering', element: <RosterBoardPage /> }], { initialEntries: ['/rostering?date=2026-10-14&participant=p-1'] })
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
    expect(shown('Ben Ito')).toBe(false)

    await act(async () => { await router.navigate('/rostering?date=2026-10-14&participant=p-2') })
    expect(shown('Ben Ito')).toBe(true)
    expect(shown('Amy Ng')).toBe(false)

    await user.click(screen.getAllByRole('button').find(button => button.getAttribute('aria-haspopup') === 'listbox')!)     // the toolbar's own filter still works
    await user.click(await screen.findByRole('option', { name: 'All participants' }))
    expect(shown('Amy Ng')).toBe(true)
  })
})
