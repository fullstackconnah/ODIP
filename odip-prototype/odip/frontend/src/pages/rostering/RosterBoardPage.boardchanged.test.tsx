import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RosterBoardPage from './RosterBoardPage'
import { makeParticipantBoard, makeParticipantRow, makeShift, makeUnfilledShift } from './test-fixtures'
import { WEEK_HEADING_ID, ShiftSlideOver } from './components'

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
const LOCKED = "This shift has started, finished or been cancelled, so its worker can't be changed here."
const conflict = (message: string, code?: string) => ({ response: { status: 409, data: { success: false, errors: [message], ...(code ? { code } : {}) } } })

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
    const { user } = await refuse(u => pick(u, /^Kim Lee/), conflict(BOARD_CHANGED))
    // The refusal's own onSettled refetch lands first, so the count below is the action's alone.
    await waitFor(() => expect(h.get.mock.calls.filter(c => c[0] === '/rostering/board').length).toBeGreaterThanOrEqual(2))
    const settled = boardGets()
    await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
    await waitFor(() => expect(screen.queryByText(BOARD_CHANGED)).not.toBeInTheDocument())
    expect(boardGets()).toBe(settled + 1)
    expect(h.get).toHaveBeenLastCalledWith('/rostering/board', { weekStart: '2026-08-17', groupBy: 'participant' })
    expect(screen.getAllByText('The board is up to date.')).toHaveLength(1)
    expect(screen.getByText('The board is up to date.').closest('[role="status"]')).not.toBeNull()
    expect(document.getElementById(WEEK_HEADING_ID)).toHaveFocus()
  })

  it('keeps the notice and says so when the refresh fails', async () => {
    const { user } = await refuse(u => pick(u, /^Kim Lee/), conflict(BOARD_CHANGED))
    await waitFor(() => expect(boardGets()).toBeGreaterThanOrEqual(2))
    h.get.mockImplementation(async (url: string) => { if (url === '/rostering/board') throw new Error('offline'); return [] })
    await user.click(screen.getByRole('button', { name: 'Refresh the board' }))
    expect(await screen.findAllByText("Couldn't refresh the board.")).not.toHaveLength(0)
    expect(screen.getByText(BOARD_CHANGED)).toBeInTheDocument()
    expect(refreshButton()).toBeInTheDocument()
    expect(refreshButton()).not.toHaveAttribute('aria-busy')
    expect(screen.queryByText('The board is up to date.')).not.toBeInTheDocument()
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
  it('shows Refresh the board for the board-changed 409', async () => {
    await refuse(act, conflict(BOARD_CHANGED))
    expect(refreshButton()).toBeInTheDocument()
  })

  it('shows no Refresh for a different 409', async () => {
    await refuse(act, conflict(LOCKED, 'SHIFT_STATUS_LOCKED'))
    expect(refreshButton()).not.toBeInTheDocument()
  })
})

// The empty-day move (POST shifts with moveFromShiftId) is refused in the shift panel, not on the board: the same action, from the same component.
describe('the shift panel: an empty-day move (POST shifts with moveFromShiftId)', () => {
  const renderPanel = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ShiftSlideOver
        target={{ mode: 'create', participantId: 'p-1', staffId: 'staff-2', serviceDate: '2026-08-20', moveFromShiftId: 'sam-wed' }}
        onClose={vi.fn()}
        canWrite
        participantOptions={[{ value: 'p-1', label: 'Mia Chen' }]}
        staffOptions={[{ value: 'staff-2', label: 'Sam Wilson' }]}
      />
    </QueryClientProvider>,
  )
  it.each([
    { refusal: conflict(BOARD_CHANGED), shows: true },
    { refusal: conflict(LOCKED, 'SHIFT_STATUS_LOCKED'), shows: false },
  ])('Refresh the board shown: $shows', async ({ refusal, shows }) => {
    const user = userEvent.setup()
    h.post.mockRejectedValue(refusal)
    renderPanel()
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await screen.findByText(refusal.response.data.errors[0])
    expect(h.post).toHaveBeenCalledWith('/rostering/shifts', expect.objectContaining({ moveFromShiftId: 'sam-wed', staffId: 'staff-2' }))
    if (shows) expect(refreshButton()).toBeInTheDocument()
    else expect(refreshButton()).not.toBeInTheDocument()
  })
})
