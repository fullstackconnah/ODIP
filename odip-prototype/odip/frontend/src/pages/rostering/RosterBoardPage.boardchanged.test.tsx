import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RosterBoardPage from './RosterBoardPage'
import { makeParticipantBoard, makeParticipantRow, makeShift, makeUnfilledShift } from './test-fixtures'
import { WEEK_HEADING_ID, ShiftSlideOver } from './components'
import { useRosterBoard } from '@/api/hooks'

// The board-changed 409 (RosteringController.BoardChangedMessage) offers "Refresh the board". The board query, the writes and the QueryClient are REAL:
// only the HTTP layer is faked, so "it refetched" is a counted GET /rostering/board, not a mocked refetch.
const h = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(),
  staff: [
    { id: 'staff-2', fullName: 'Sam Wilson', isActive: true, region: 'North', hasExpiredQualifications: false },
    { id: 'staff-9', fullName: 'Alex Ng', isActive: true, region: 'South', hasExpiredQualifications: false },
    { id: 'staff-6', fullName: 'Kim Lee', isActive: true, region: 'North', hasExpiredQualifications: false },
  ],
}))

vi.mock('@/api/client', () => ({ apiGet: h.get, apiPost: h.post, apiPut: h.put, apiDelete: vi.fn(), apiGetWithDefault: vi.fn() }))

vi.mock('@/api/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks')>('@/api/hooks')
  return {
    ...actual,
    useParticipants: () => ({ data: [] }),
    useStaff: () => ({ data: h.staff, isLoading: false }),
    useParticipantRoutines: () => ({ data: [] }),
    useCompatibility: () => ({ data: [] }),
    useRosterShiftNotes: () => ({ data: [] }),
    useCheckShift: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => false }))

const BOARD_CHANGED = 'This shift changed after the board was loaded. Refresh the board and try again.'
const REFRESH_FAILED = "Couldn't refresh the board. Try again."
const LOCKED = "This shift has started, finished or been cancelled, so its worker can't be changed here."
const conflict = (message: string, code?: string) => ({ response: { status: 409, data: { success: false, errors: [message], ...(code ? { code } : {}) } } })

const boardChanged = () => conflict(BOARD_CHANGED, 'SHIFT_BOARD_CHANGED')

// The week of Monday 2026-08-17: Mia's open Tuesday, Sam on her Wednesday (from pattern pat-wed), Alex on Jo's Tuesday.
const OPEN = makeUnfilledShift({ id: 'open', participantId: 'p-1', participantName: 'Mia Chen', serviceDate: '2026-08-18', startTime: '09:00:00', endTime: '15:00:00', durationHours: 6, status: 'Draft' })
const SAM_WED = makeShift({ id: 'sam-wed', participantId: 'p-1', participantName: 'Mia Chen', serviceDate: '2026-08-19', startTime: '09:00:00', endTime: '15:00:00', durationHours: 6, staffId: 'staff-2', staffName: 'Sam Wilson', status: 'Published', shiftPatternId: 'pat-wed', fromAgreement: true })
const JO_TUE = makeShift({ id: 'jo-tue', participantId: 'p-2', participantName: 'Jo Park', serviceDate: '2026-08-18', startTime: '08:00:00', endTime: '17:00:00', durationHours: 9, staffId: 'staff-9', staffName: 'Alex Ng', status: 'Draft' })
const BOARD = makeParticipantBoard({
  participantRows: [
    makeParticipantRow({ participantId: 'p-1', fullName: 'Mia Chen', shifts: [OPEN, SAM_WED] }),
    makeParticipantRow({ participantId: 'p-2', fullName: 'Jo Park', shifts: [JO_TUE] }),
  ],
})

// The week as it is after somebody else moved Sam off Wednesday.
const BOARD_SAM_OFF = makeParticipantBoard({
  participantRows: [
    makeParticipantRow({ participantId: 'p-1', fullName: 'Mia Chen', shifts: [OPEN, makeUnfilledShift({ ...SAM_WED })] }),
    makeParticipantRow({ participantId: 'p-2', fullName: 'Jo Park', shifts: [JO_TUE] }),
  ],
})

const boardGets = () => h.get.mock.calls.filter(c => c[0] === '/rostering/board').length
const refreshButton = () => screen.queryByRole('button', { name: 'Refresh the board' })
type User = ReturnType<typeof userEvent.setup>
const menu = async (user: User, chip: string, option: string) => {
  await user.click(within(document.querySelector(`[data-shift-chip="${chip}"]`) as HTMLElement).getByRole('button', { name: /^Actions for/ }))
  await user.click(screen.getByRole('option', { name: option }))
}
const pick = async (user: User, name: RegExp) => {
  await user.click(screen.getByRole('button', { name: 'Assign someone to Tuesday 9am to 3pm for Mia' }))
  await user.click(screen.getByRole('option', { name }))
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([{ path: '/rostering', element: <RosterBoardPage /> }], { initialEntries: ['/rostering?date=2026-08-17'] })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
}

/** Shows the board, then refuses the write `act` makes with `refusal`, and waits for the refusal's own board refetch (onSettled) to land. */
async function refuse(act: (user: User) => Promise<void>, refusal: unknown) {
  const user = userEvent.setup()
  renderPage()
  await waitFor(() => expect(document.querySelector('[data-shift-chip="sam-wed"]')).not.toBeNull())
  h.post.mockRejectedValue(refusal)
  h.put.mockRejectedValue(refusal)
  const before = boardGets()
  await act(user)
  const message = (refusal as { response: { data: { errors: string[] } } }).response.data.errors[0]
  await screen.findByText(message)
  return { user, before }
}

beforeEach(() => {
  h.get.mockReset(); h.post.mockReset(); h.put.mockReset()
  h.get.mockImplementation(async (url: string) => (url === '/rostering/board' ? BOARD : []))
  sessionStorage.clear()
  localStorage.clear()
})

describe('the board-changed 409 offers Refresh the board (real QueryClient)', () => {
  it('refetches the shown week, clears the notice, says so once, and puts focus on the week heading', async () => {
    const { user } = await refuse(u => pick(u, /^Kim Lee/), boardChanged())
    // The refusal's own onSettled refetch lands first, so the count below is the action's alone.
    await waitFor(() => expect(h.get.mock.calls.filter(c => c[0] === '/rostering/board').length).toBeGreaterThanOrEqual(2))
    const settled = boardGets()
    await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
    await waitFor(() => expect(screen.queryByText(BOARD_CHANGED)).not.toBeInTheDocument())
    expect(boardGets()).toBe(settled + 1)
    expect(h.get).toHaveBeenLastCalledWith('/rostering/board', { weekStart: '2026-08-17', groupBy: 'participant' })
    // Said once to a screen reader (the page's polite region) and shown once to everyone else (a success notice that does not announce itself).
    const said = screen.getAllByText('The board is up to date.')
    expect(said).toHaveLength(2)
    expect(said.filter(el => el.getAttribute('role') === 'status')).toHaveLength(1)
    expect(document.getElementById(WEEK_HEADING_ID)).toHaveFocus()
  })

  it('says the outcome again on a second refresh, since each refresh first says it is refreshing', async () => {
    const { user } = await refuse(u => pick(u, /^Kim Lee/), boardChanged())
    await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
    await screen.findAllByText('The board is up to date.')
    await pick(user, /^Kim Lee/)
    await screen.findByText(BOARD_CHANGED)
    const region = screen.getByText('The board is up to date.')
    let release = () => {}
    h.get.mockImplementation((url: string) => (url === '/rostering/board' ? new Promise(res => { release = () => res(BOARD) }) : Promise.resolve([])))
    await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
    await waitFor(() => expect(region).toHaveTextContent('Refreshing the board…'))
    release()
    await waitFor(() => expect(screen.queryByText(BOARD_CHANGED)).not.toBeInTheDocument())
    expect(region).toHaveTextContent('The board is up to date.')
  })

  it('holds the button while it runs (aria-busy, aria-disabled) and ignores a second press', async () => {
    const { user } = await refuse(u => pick(u, /^Kim Lee/), boardChanged())
    await waitFor(() => expect(boardGets()).toBeGreaterThanOrEqual(2))
    let release = () => {}
    h.get.mockImplementation((url: string) => (url === '/rostering/board' ? new Promise(res => { release = () => res(BOARD) }) : Promise.resolve([])))
    const settled = boardGets()
    await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
    await waitFor(() => expect(refreshButton()).toHaveAttribute('aria-busy', 'true'))
    expect(refreshButton()).toHaveAttribute('aria-disabled', 'true')
    expect(refreshButton()).toHaveFocus()
    await user.click(refreshButton() as HTMLElement)
    expect(boardGets()).toBe(settled + 1)
    release()
    await waitFor(() => expect(screen.queryByText(BOARD_CHANGED)).not.toBeInTheDocument())
    expect(boardGets()).toBe(settled + 1)
  })

  it('keeps the notice and says so when the refresh fails', async () => {
    const { user } = await refuse(u => pick(u, /^Kim Lee/), boardChanged())
    await waitFor(() => expect(boardGets()).toBeGreaterThanOrEqual(2))
    h.get.mockImplementation(async (url: string) => { if (url === '/rostering/board') throw new Error('offline'); return [] })
    await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
    expect(await screen.findAllByText(REFRESH_FAILED)).not.toHaveLength(0)
    expect(screen.getByText(BOARD_CHANGED)).toBeInTheDocument()
    // The week stays on screen: a failed refresh is not the load-error page with a second Retry.
    expect(document.querySelector('[data-shift-chip="sam-wed"]')).not.toBeNull()
    expect(screen.queryByText("Couldn't load the roster board")).not.toBeInTheDocument()
    expect(refreshButton()).toBeInTheDocument()
    expect(refreshButton()).not.toHaveAttribute('aria-busy')
    expect(refreshButton()).toHaveFocus()
    expect(screen.queryByText('The board is up to date.')).not.toBeInTheDocument()
  })

  it('puts the action under the message, in the text column: only the dismiss X is in the actions slot', async () => {
    await refuse(u => pick(u, /^Kim Lee/), boardChanged())
    expect(refreshButton()?.closest('[role="alert"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Dismiss error' }).parentElement).not.toContainElement(refreshButton())
  })

  it.each([
    { name: 'the code, whatever the sentence says (the copy was edited)', refusal: conflict('Somebody reworded this sentence.', 'SHIFT_BOARD_CHANGED') },
    { name: 'the sentence alone (a server from before the code)', refusal: conflict(BOARD_CHANGED) },
  ])('offers Refresh the board on $name', async ({ refusal }) => {
    await refuse(u => pick(u, /^Kim Lee/), refusal)
    expect(refreshButton()).toBeInTheDocument()
  })

  it('shows the success notice, and clears it by itself after a few seconds', async () => {
    const { user } = await refuse(u => pick(u, /^Kim Lee/), boardChanged())
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
      await screen.findByRole('button', { name: 'Dismiss notice' })
      act(() => { vi.advanceTimersByTime(6000) })
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Dismiss notice' })).not.toBeInTheDocument())
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the success notice the size of the refusal it replaces, so the grid does not move when Refresh succeeds', async () => {
    const { user } = await refuse(u => pick(u, /^Kim Lee/), boardChanged())
    await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
    await screen.findByRole('button', { name: 'Dismiss notice' })
    const notice = document.body
    // jsdom has no layout: the measured check is the shots script. Here, the refusal's sentence and the action row sit invisible in the notice.
    expect(notice.querySelector('[aria-hidden="true"][data-reserve]')).toHaveAttribute('data-reserve', BOARD_CHANGED)
    expect(notice.querySelector('.invisible [aria-busy], .invisible button')).not.toBeNull()
  })

  it('holds the success notice while a staff member is being carried, and clears it a few seconds after the drop', async () => {
    const { user } = await refuse(u => pick(u, /^Kim Lee/), boardChanged())
    const scrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()   // dnd-kit's KeyboardSensor calls it when it lifts
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
      await screen.findByRole('button', { name: 'Dismiss notice' })
      screen.getByRole('button', { name: /^Sam Wilson, / }).focus()
      await user.keyboard(' ')
      await screen.findByText('Picked up Sam Wilson.')
      act(() => { vi.advanceTimersByTime(20000) })
      expect(screen.getByRole('button', { name: 'Dismiss notice' })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      await screen.findByText('Cancelled. Nothing changed.')
      act(() => { vi.advanceTimersByTime(6000) })
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Dismiss notice' })).not.toBeInTheDocument())
    } finally {
      vi.useRealTimers()
      Element.prototype.scrollIntoView = scrollIntoView
    }
  })

  it('a refresh that resolves after a newer write began says nothing and takes no focus', async () => {
    const { user } = await refuse(u => pick(u, /^Kim Lee/), boardChanged())
    await waitFor(() => expect(boardGets()).toBeGreaterThanOrEqual(2))
    const releases: (() => void)[] = []
    h.get.mockImplementation((url: string) => (url === '/rostering/board' ? new Promise(res => { releases.push(() => res(BOARD)) }) : Promise.resolve([])))
    await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
    await waitFor(() => expect(refreshButton()).toHaveAttribute('aria-busy', 'true'))
    const NOT_READY = 'Participant is not ready for booking or rostering.'
    h.post.mockRejectedValue({ response: { status: 400, data: { success: false, errors: [NOT_READY] } } })
    await pick(user, /^Kim Lee/)   // the old notice and its action go at once; the refusal itself waits for the board refetch (onSettled)
    await waitFor(() => expect(releases.length).toBeGreaterThanOrEqual(2))
    await act(async () => { releases.forEach(r => r()); await new Promise(r => setTimeout(r, 50)) })
    await screen.findByText(NOT_READY)
    // The late refresh belongs to a notice that is gone: it says nothing and takes no focus.
    expect(screen.queryByText('The board is up to date.')).not.toBeInTheDocument()
    expect(document.getElementById(WEEK_HEADING_ID)).not.toHaveFocus()
  })
})

// Every board write that can be refused with the board-changed 409 (the audit in the report): each shows the action for it, none for another 409.
const PATHS: { path: string; act: (user: User) => Promise<void> }[] = [
  { path: 'assign from the picker (a drop without the drag: /assign with expectedStaffId)', act: u => pick(u, /^Kim Lee/) },
  { path: 'move from the picker (move-staff, Move)', act: u => pick(u, /^Alex Ng/) },
  { path: 'swap from the menu (move-staff, Swap)', act: async u => { await menu(u, 'sam-wed', 'Swap Sam with…'); await u.click(within(screen.getByRole('dialog', { name: 'Swap Sam with…' })).getByRole('option', { name: /^Alex Ng/ })) } },
  {
    path: 'make the regular (PUT patterns/{id}/regular)',
    act: async u => { await menu(u, 'sam-wed', 'Make Sam the regular'); await u.click(within(screen.getByRole('alertdialog', { name: 'Make Sam the regular?' })).getByRole('button', { name: 'Make Sam the regular' })) },
  },
]

describe.each(PATHS)('$path', ({ act }) => {
  it('shows no Refresh when the same sentence arrives as a non-409 error', async () => {
    await refuse(act, { response: { status: 400, data: { success: false, errors: [BOARD_CHANGED] } } })
    expect(refreshButton()).not.toBeInTheDocument()
  })

  it('shows Refresh the board for the board-changed 409', async () => {
    await refuse(act, boardChanged())
    expect(refreshButton()).toBeInTheDocument()
  })

  it('shows no Refresh for a different 409', async () => {
    await refuse(act, conflict(LOCKED, 'SHIFT_STATUS_LOCKED'))
    expect(refreshButton()).not.toBeInTheDocument()
  })
})

// The empty-day move (POST shifts with moveFromShiftId) is refused in the shift panel, not on the board: the same action, from the same component. It is the only way a panel gets the
// board-changed 409 (PUT shifts/{id} never sends it). The board query is REAL here too (BoardObserver), so a refresh is a counted GET.
function BoardObserver() { useRosterBoard('2026-08-17', 'participant'); return null }
const MOVE = { mode: 'create' as const, participantId: 'p-1', staffId: 'staff-2', serviceDate: '2026-08-20', moveFromShiftId: 'sam-wed' }
const SAVED = makeShift({ id: 'new', participantId: 'p-1', participantName: 'Mia Chen', staffId: 'staff-2', staffName: 'Sam Wilson', serviceDate: '2026-08-20', status: 'Draft' })
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
const panelProps = () => ({ onClose: vi.fn(), canWrite: true, participantOptions: [{ value: 'p-1', label: 'Mia Chen' }], staffOptions: [{ value: 'staff-2', label: 'Sam Wilson' }] })
const saveButton = () => screen.getByRole('button', { name: /^save$/i })

describe('the shift panel: an empty-day move (POST shifts with moveFromShiftId)', () => {
  const renderPanel = ({ observe = true, onSaved = vi.fn() } = {}) => {
    render(
      <QueryClientProvider client={newClient()}>
        {observe && <BoardObserver />}
        <ShiftSlideOver target={MOVE} {...panelProps()} onSaved={onSaved} />
      </QueryClientProvider>,
    )
    return onSaved
  }
  it.each([
    { refusal: boardChanged(), shows: true },
    { refusal: conflict(LOCKED, 'SHIFT_STATUS_LOCKED'), shows: false },
  ])('Refresh the board shown: $shows', async ({ refusal, shows }) => {
    const user = userEvent.setup()
    h.post.mockRejectedValue(refusal)
    renderPanel()
    await user.click(saveButton())
    await screen.findByText(refusal.response.data.errors[0])
    expect(h.post).toHaveBeenCalledWith('/rostering/shifts', expect.objectContaining({ moveFromShiftId: 'sam-wed', staffId: 'staff-2' }))
    if (shows) expect(refreshButton()).toBeInTheDocument()
    else expect(refreshButton()).not.toBeInTheDocument()
  })

  it('brings the refusal at the foot of the panel into view when it appears', async () => {
    const user = userEvent.setup()
    const scrollIntoView = Element.prototype.scrollIntoView
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy   // jsdom has no layout, so no scrollIntoView: the call is what is checked
    try {
      h.post.mockRejectedValue(boardChanged())
      renderPanel()
      await user.click(saveButton())
      const notice = (await screen.findByText(BOARD_CHANGED)).closest('[role="alert"]')
      expect(spy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })   // instant: jsdom has no matchMedia, which reads as reduced motion
      expect(spy.mock.contexts).toContain(notice)
    } finally {
      Element.prototype.scrollIntoView = scrollIntoView
    }
  })

  it('refreshes for real; with Sam still on the shift he was carried off, it says the board is up to date and Save keeps the move', async () => {
    const user = userEvent.setup()
    h.post.mockRejectedValueOnce(boardChanged()).mockResolvedValue(SAVED)
    const onSaved = renderPanel()
    await waitFor(() => expect(boardGets()).toBe(1))
    await user.click(saveButton())
    await screen.findByText(BOARD_CHANGED)
    await waitFor(() => expect(boardGets()).toBe(2))   // the refusal's own refetch (onSettled)
    await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
    // The panel's polite region and a visible note: the panel is a modal, so the page's region is not heard.
    expect(await screen.findAllByText('The board is up to date.')).toHaveLength(2)
    expect(boardGets()).toBe(3)
    await user.click(saveButton())
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(2))
    expect(h.post).toHaveBeenLastCalledWith('/rostering/shifts', expect.objectContaining({ moveFromShiftId: 'sam-wed' }))
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('with Sam gone from that shift, the refreshed panel does not claim it is up to date, says why, and Save no longer sends the stale move', async () => {
    const user = userEvent.setup()
    h.post.mockRejectedValueOnce(boardChanged()).mockResolvedValue(SAVED)
    const onSaved = renderPanel()
    await waitFor(() => expect(boardGets()).toBe(1))
    await user.click(saveButton())
    await screen.findByText(BOARD_CHANGED)
    await waitFor(() => expect(boardGets()).toBe(2))   // the refusal's own refetch (onSettled)
    h.get.mockImplementation(async (url: string) => (url === '/rostering/board' ? BOARD_SAM_OFF : []))
    await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
    const why = /Sam Wilson is no longer on the shift you moved them from\. Save adds this shift without moving them\./
    expect(await screen.findAllByText(why)).toHaveLength(2)
    expect(screen.queryByText('The board is up to date.')).not.toBeInTheDocument()
    expect(boardGets()).toBe(3)
    await user.click(saveButton())
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(2))
    expect(h.post.mock.calls[1][1]).not.toHaveProperty('moveFromShiftId')
    // Nobody was moved by this save, so the board must not announce a move.
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('with no board on screen nothing was refreshed: it says so instead of claiming success', async () => {
    const user = userEvent.setup()
    h.post.mockRejectedValue(boardChanged())
    renderPanel({ observe: false })
    await user.click(saveButton())
    await screen.findByText(BOARD_CHANGED)
    await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
    expect(await screen.findAllByText(REFRESH_FAILED)).not.toHaveLength(0)
    expect(screen.queryByText('The board is up to date.')).not.toBeInTheDocument()
  })

  it('a reopened panel starts with an empty announcement region, not the last done line', async () => {
    const user = userEvent.setup()
    h.post.mockRejectedValue(boardChanged())
    const client = newClient()
    const props = panelProps()
    const ui = (t: typeof MOVE | null) => <QueryClientProvider client={client}><BoardObserver /><ShiftSlideOver {...props} target={t} /></QueryClientProvider>
    const { rerender } = render(ui(MOVE))
    await user.click(saveButton())
    await screen.findByText(BOARD_CHANGED)
    await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
    await screen.findAllByText('The board is up to date.')
    rerender(ui(null))
    rerender(ui({ ...MOVE }))
    expect(screen.queryByText('The board is up to date.')).not.toBeInTheDocument()
    expect(document.querySelector('[role="status"]')).toBeNull()
  })
})
