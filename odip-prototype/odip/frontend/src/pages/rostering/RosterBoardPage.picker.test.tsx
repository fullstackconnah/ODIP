import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RosterBoardPage from './RosterBoardPage'
import { makeFinding, makeParticipantBoard, makeParticipantRow, makeShift, makeStaffBoard, makeStaffRow, makeUnfilledShift } from './test-fixtures'
import type { ShiftDto } from '@/api/types'

const h = vi.hoisted(() => ({
  board: vi.fn(), assign: vi.fn(), move: vi.fn(),
  screen: { belowMd: false },
  staff: [
    { id: 'staff-2', fullName: 'Sam Wilson', isActive: true, region: 'North', hasExpiredQualifications: false },
    { id: 'staff-9', fullName: 'Alex Ng', isActive: true, region: 'South', hasExpiredQualifications: false },
    { id: 'staff-6', fullName: 'Kim Lee', isActive: true, region: 'North', hasExpiredQualifications: false },
  ],
}))

vi.mock('@/api/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks')>('@/api/hooks')
  return {
    ...actual,
    useRosterBoard: h.board,
    useAssignShift: () => ({ mutateAsync: h.assign, isPending: false }),
    useMoveStaff: () => ({ mutateAsync: h.move, isPending: false }),
    usePublishWeek: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCreateShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => h.screen.belowMd }))

// The week of Monday 2026-08-17. Mia Chen's agreed Needs staff shifts: Tuesday (the one picked from), a Published Thursday, a 2:1 pair on Friday, and a Completed Monday. Sam is on her
// Wednesday and has approved leave on Tuesday. Alex is on Jo Park's Tuesday 8am-5pm. Kim has nothing.
const hole = (o: Partial<ShiftDto>) => makeUnfilledShift({
  participantId: 'p-1', participantName: 'Mia Chen', startTime: '09:00:00', endTime: '15:00:00', durationHours: 6, status: 'Draft', shiftPatternId: 'pat-1', fromAgreement: true, sourceDraftVersion: 1, ...o,
})
const OPEN = hole({ id: 'open', serviceDate: '2026-08-18' })
const OPEN_THU = hole({ id: 'open-thu', serviceDate: '2026-08-20', status: 'Published' })
const PAIR = [hole({ id: 'pair-1', serviceDate: '2026-08-21' }), hole({ id: 'pair-2', serviceDate: '2026-08-21' })]
const DONE = hole({ id: 'done', serviceDate: '2026-08-17', status: 'Completed' })
const SAM_WED = makeShift({ id: 'sam-wed', participantId: 'p-1', participantName: 'Mia Chen', serviceDate: '2026-08-19', startTime: '09:00:00', endTime: '15:00:00', durationHours: 6, staffId: 'staff-2', staffName: 'Sam Wilson', status: 'Draft' })
const JO_TUE = makeShift({ id: 'jo-tue', participantId: 'p-2', participantName: 'Jo Park', serviceDate: '2026-08-18', startTime: '08:00:00', endTime: '17:00:00', durationHours: 9, staffId: 'staff-9', staffName: 'Alex Ng', status: 'Draft' })
const boardWith = (open: ShiftDto) => makeParticipantBoard({
  participantRows: [
    makeParticipantRow({ participantId: 'p-1', fullName: 'Mia Chen', shifts: [DONE, open, SAM_WED, OPEN_THU, ...PAIR] }),
    makeParticipantRow({ participantId: 'p-2', fullName: 'Jo Park', shifts: [JO_TUE] }),
  ],
  staffLeave: [{ staffId: 'staff-2', from: '2026-08-18', to: '2026-08-18', status: 'Approved' }],
})
const BOARD = boardWith(OPEN)
const TUE_PLUS = 'Assign someone to Tuesday 9am to 3pm for Mia'

function renderPage(entry = '/rostering?date=2026-08-17') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = () => <QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[entry]}><RosterBoardPage /></MemoryRouter></QueryClientProvider>
  const result = render(tree())
  // A new element tree, so the page renders again and reads the board hook again (a refetch).
  return { ...result, refetch: () => result.rerender(tree()) }
}
const picker = () => screen.getByRole('dialog', { name: TUE_PLUS })
const option = (name: RegExp) => within(picker()).getByRole('option', { name })
const groupLabels = (dialog: HTMLElement) => within(dialog).getAllByRole('group').map(g => document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent)
const findings422 = (severity: 'Warning' | 'Blocking') => ({
  response: { status: 422, data: { success: false, data: [makeFinding({ code: 'STAFF_ON_LEAVE', severity, requiresReason: severity === 'Warning', message: 'Sam Wilson is on approved leave.' })] } },
})

beforeEach(() => {
  for (const fn of [h.board, h.assign, h.move]) fn.mockReset()
  h.board.mockReturnValue({ data: BOARD, isLoading: false, isError: false, refetch: vi.fn() })
  h.assign.mockResolvedValue(OPEN)
  h.move.mockResolvedValue(OPEN)
  h.screen.belowMd = false
  sessionStorage.clear()
  localStorage.clear()
})

describe('RosterBoardPage: the plus opens the staff picker', () => {
  it('opens one picker from the plus, focus in its search, groups from the whole board, and rings its chip', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: TUE_PLUS }))
    expect(within(picker()).getByRole('combobox', { name: 'Find staff' })).toHaveFocus()
    expect(groupLabels(picker())).toEqual(['Free at this time', 'On another shift at this time', 'On leave that day'])
    expect(option(/^Alex Ng/)).toHaveAccessibleName('Alex Ng, 9 of 38 hours this week, move from Tuesday 8am to 5pm with Jo')
    expect(option(/^Sam Wilson/)).toHaveAccessibleName('Sam Wilson, 6 of 38 hours this week, on leave')
    expect(screen.getByRole('button', { name: TUE_PLUS })).toHaveAttribute('aria-expanded', 'true')
    expect(document.querySelector('[data-shift-chip="open"] [data-shift-box]')).toHaveClass('ring-2')
  })

  it('gives a 2:1 day two pluses, and no plus to a filled or a locked shift', () => {
    renderPage()
    expect(screen.getAllByRole('button', { name: 'Assign someone to Friday 9am to 3pm for Mia' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Assign someone to (Monday|Wednesday)/ })).not.toBeInTheDocument()
  })

  it("opens the same picker from an unfilled chip's Assign to…", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(within(document.querySelector('[data-shift-chip="open"]') as HTMLElement).getByRole('button', { name: /^Actions for/ }))
    await user.click(screen.getByRole('option', { name: 'Assign to…' }))
    expect(picker()).toBeInTheDocument()
    // The menu closes as the picker opens: focus must end in the search, not back on the menu's trigger, or the keyboard route is dead.
    await waitFor(() => expect(within(picker()).getByRole('combobox', { name: 'Find staff' })).toHaveFocus())
  })

  it('gives a reader no plus', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    renderPage()
    expect(screen.queryByRole('button', { name: /^Assign someone/ })).not.toBeInTheDocument()
  })

  it('closes on Escape and gives focus back to the plus', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: TUE_PLUS }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: TUE_PLUS })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: TUE_PLUS })).toHaveFocus()
  })

  it('closes when a refetch shows somebody else filled the shift, and sends nothing (Review Focus 2)', async () => {
    const user = userEvent.setup()
    const { refetch } = renderPage()
    await user.click(screen.getByRole('button', { name: TUE_PLUS }))
    h.board.mockReturnValue({ data: boardWith({ ...OPEN, staffId: 'staff-6', staffName: 'Kim Lee' }), isLoading: false, isError: false, refetch: vi.fn() })
    refetch()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TUE_PLUS })).not.toBeInTheDocument())
    expect(h.assign).not.toHaveBeenCalled()
    expect(h.move).not.toHaveBeenCalled()
  })
})

describe('RosterBoardPage: a pick is a drop without the drag', () => {
  it('assigns a free person with the whole body a drop sends, closes the picker, says so, and focuses the shift', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: TUE_PLUS }))
    await user.click(option(/^Kim Lee/))
    expect(h.assign).toHaveBeenCalledWith({ id: 'open', data: { staffId: 'staff-6', overrideReason: null, acknowledgedFindingCodes: [], expectedStaffId: null } })
    expect(h.move).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: TUE_PLUS })).not.toBeInTheDocument()
    expect(await screen.findByText('Kim Lee assigned to Mia Chen, Tuesday 9am to 3pm.')).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('[data-shift-open="open"]')).toHaveFocus())
  })

  it('moves a person off their overlapping shift in one move-staff request with the whole body', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: TUE_PLUS }))
    await user.click(option(/^Alex Ng/))
    expect(h.move).toHaveBeenCalledWith({ fromShiftId: 'jo-tue', toShiftId: 'open', mode: 'Move', staffId: 'staff-9', expectedToStaffId: null, overrideReason: null, acknowledgedFindingCodes: [] })
    expect(h.assign).not.toHaveBeenCalled()
    expect(await screen.findByText('Alex Ng moved to Mia Chen, Tuesday 9am to 3pm. Tuesday 8am to 5pm now needs staff.')).toBeInTheDocument()
  })

  it("assigns a person on leave like any other, and the server's warnings open today's dialog; Cancel leaves the hole and focus on the shift", async () => {
    const user = userEvent.setup()
    h.assign.mockRejectedValueOnce(findings422('Warning'))
    renderPage()
    await user.click(screen.getByRole('button', { name: TUE_PLUS }))
    await user.click(option(/^Sam Wilson/))
    expect(h.assign).toHaveBeenCalledWith({ id: 'open', data: { staffId: 'staff-2', overrideReason: null, acknowledgedFindingCodes: [], expectedStaffId: null } })
    const dialog = await screen.findByRole('alertdialog', { name: 'Assign with warnings' })
    expect(screen.queryByRole('dialog', { name: TUE_PLUS })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(document.querySelector('[data-shift-open="open"]')).toHaveAccessibleName(/Needs staff/)   // a writer's plus box prints no words (the chip brief, section 4)
    await waitFor(() => expect(document.querySelector('[data-shift-open="open"]')).toHaveFocus())
  })

  it("shows any other refusal in today's error Callout, in the server's words", async () => {
    const user = userEvent.setup()
    const STALE = 'This shift changed after the board was loaded. Refresh the board and try again.'
    h.assign.mockRejectedValueOnce({ response: { status: 409, data: { success: false, errors: [STALE] } } })
    renderPage()
    await user.click(screen.getByRole('button', { name: TUE_PLUS }))
    await user.click(option(/^Kim Lee/))
    expect((await screen.findByText(STALE)).closest('[role="alert"]')).not.toBeNull()
  })

  it('shows the pending look while the request is out, and every other plus waits', async () => {
    const user = userEvent.setup()
    h.assign.mockReturnValueOnce(new Promise(() => {}))   // still out
    renderPage()
    await user.click(screen.getByRole('button', { name: TUE_PLUS }))
    await user.click(option(/^Kim Lee/))
    expect(document.querySelector('[aria-busy="true"]')).toHaveTextContent('Assigning Kim…')
    expect(screen.getByRole('button', { name: 'Assign someone to Thursday 9am to 3pm for Mia' })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('RosterBoardPage: the picker on a phone and in the Staff view', () => {
  it("is the SlideOver on a phone, and the pick's pending look reaches the grid there too (SHAPE departure 15)", async () => {
    const user = userEvent.setup()
    h.screen.belowMd = true
    h.assign.mockReturnValueOnce(new Promise(() => {}))
    renderPage()
    await user.click(screen.getByRole('button', { name: TUE_PLUS }))
    const sheet = screen.getByRole('dialog', { name: 'Assign someone' })
    expect(sheet).toHaveAccessibleDescription('Mia Chen, Tue 18 Aug, 9am–3pm')
    await user.click(within(sheet).getByRole('option', { name: /^Kim Lee/ }))
    expect(h.assign).toHaveBeenCalledWith({ id: 'open', data: { staffId: 'staff-6', overrideReason: null, acknowledgedFindingCodes: [], expectedStaffId: null } })
    expect(document.querySelector('[aria-busy="true"]')).toHaveTextContent('Assigning Kim…')
  })

  it("puts a plus on the Staff view's Unfilled lane, and its picker reads leave from the staff rows", async () => {
    const user = userEvent.setup()
    sessionStorage.setItem('odip.roster.boardView', 'staff')
    const pending = { startDate: '2026-08-18', endDate: '2026-08-18', kind: 'PendingLeave', availabilityType: 'Leave', notes: null, startTime: null, endTime: null } as const
    h.board.mockReturnValue({ data: makeStaffBoard({ unfilled: [OPEN], staffRows: [makeStaffRow({ staffId: 'staff-6', fullName: 'Kim Lee', leave: [pending] })] }), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    await user.click(screen.getByRole('button', { name: TUE_PLUS }))
    expect(groupLabels(picker())).toEqual(['Free at this time', 'On leave that day'])
    expect(option(/^Kim Lee/)).toHaveAccessibleName('Kim Lee, 0 of 38 hours this week, leave pending')
  })
})

// The ⋮ menu's Swap (the lead's decision 1, 2026-10-15): the same request, sentence and focus as a drag swap, through the picker shell.
describe('RosterBoardPage: Swap with… from the menu', () => {
  const SWAP_NAME = 'Swap Sam with…'
  const openSwap = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(within(document.querySelector('[data-shift-chip="sam-wed"]') as HTMLElement).getByRole('button', { name: /^Actions for/ }))
    await user.click(screen.getByRole('option', { name: 'Swap Sam with…' }))
    return screen.getByRole('dialog', { name: SWAP_NAME })
  }

  it('lists the other assigned, unlocked shifts of the week, person then day and time, and rings the chip', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openSwap(user)
    expect(within(dialog).getByRole('combobox', { name: 'Find staff' })).toHaveFocus()
    expect(within(dialog).getAllByRole('option').map(o => o.getAttribute('aria-label'))).toEqual(['Alex Ng, Tuesday 8am to 5pm, for Jo'])
    expect(within(dialog).getByRole('option').textContent).toBe('Alex Ng· Tue 8am–5pm · Jo')   // two spans, drawn apart by a gap
    expect(document.querySelector('[data-shift-chip="sam-wed"] [data-shift-box]')).toHaveClass('ring-2')
  })

  it('sends exactly what a drag swap sends, says it as a drag swap does, and leaves focus on the shift', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openSwap(user)
    await user.click(within(dialog).getByRole('option', { name: /^Alex Ng/ }))
    expect(h.move).toHaveBeenCalledWith({ fromShiftId: 'sam-wed', toShiftId: 'jo-tue', mode: 'Swap', staffId: 'staff-2', expectedToStaffId: 'staff-9', overrideReason: null, acknowledgedFindingCodes: [] })
    expect(screen.queryByRole('dialog', { name: SWAP_NAME })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Swapped: Sam is on Jo Park, Tuesday 8am to 5pm and Alex on Mia Chen, Wednesday 9am to 3pm.')).toBeInTheDocument())
    expect(document.querySelector('[data-shift-open="sam-wed"]')).toHaveFocus()
  })

  it('says so when nobody else is rostered this week, and Escape gives focus back to the menu', async () => {
    const user = userEvent.setup()
    h.board.mockReturnValue({ data: makeParticipantBoard({ participantRows: [makeParticipantRow({ participantId: 'p-1', fullName: 'Mia Chen', shifts: [SAM_WED, DONE] })] }), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    const dialog = await openSwap(user)
    expect(within(dialog).getByText('No one else is rostered this week to swap with.')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: SWAP_NAME })).not.toBeInTheDocument()
    expect(within(document.querySelector('[data-shift-chip="sam-wed"]') as HTMLElement).getByRole('button', { name: /^Actions for/ })).toHaveFocus()
  })
})
