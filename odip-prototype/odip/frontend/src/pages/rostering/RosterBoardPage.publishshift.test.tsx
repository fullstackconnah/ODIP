import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RosterBoardPage from './RosterBoardPage'
import { makeFinding, makeParticipantBoard, makeParticipantRow, makeShift } from './test-fixtures'
import type { RosterBoardDto, ShiftDto } from '@/api/types'

// Publish one shift from its chip menu (card roster-draft-publish): the page's half. It is the slide-over's own request (PUT the shift with status Published).
const h = vi.hoisted(() => ({ board: vi.fn(), update: vi.fn() }))

vi.mock('@/api/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks')>('@/api/hooks')
  return {
    ...actual,
    useRosterBoard: h.board,
    useAssignShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useMoveStaff: () => ({ mutateAsync: vi.fn(), isPending: false }),
    usePublishWeek: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useStartWeek: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useSetRegular: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCreateShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateShift: () => ({ mutateAsync: h.update, isPending: false }),
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

const DRAFT = makeShift({
  id: 'draft-1', participantId: 'p-1', participantName: 'Mia Chen', serviceDate: '2026-08-18', startTime: '09:00:00', endTime: '15:00:00', durationHours: 6,
  status: 'Draft', staffId: 'staff-2', staffName: 'Sam Wilson', notes: 'Bring the lift sling', overrideReason: 'Cover', acknowledgedFindingCodes: ['SOME_WARNING'],
})
const PUBLISHED = makeShift({ id: 'pub-1', participantId: 'p-1', participantName: 'Mia Chen', serviceDate: '2026-08-17', status: 'Published', staffId: 'staff-2', staffName: 'Sam Wilson' })
const board = (shifts: ShiftDto[]): RosterBoardDto =>
  makeParticipantBoard({ weekStarted: true, participantRows: [makeParticipantRow({ participantId: 'p-1', fullName: 'Mia Chen', shifts })] })

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/rostering', element: <RosterBoardPage /> }], { initialEntries: ['/rostering?date=2026-08-17'] })
  return render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
}
const chipOf = (id: string) => document.querySelector(`[data-shift-chip="${id}"]`) as HTMLElement
const openMenu = (user: ReturnType<typeof userEvent.setup>, id: string) => user.click(within(chipOf(id)).getByRole('button', { name: /^Actions for/ }))

beforeEach(() => {
  h.board.mockReset()
  h.update.mockReset()
  h.board.mockReturnValue({ data: board([DRAFT, PUBLISHED]), isLoading: false, isError: false, refetch: vi.fn() })
  localStorage.clear()
  sessionStorage.clear()
})

describe('Publish from the chip menu', () => {
  it('sends the shift as it is with status Published, once, and announces it', async () => {
    const user = userEvent.setup()
    h.update.mockResolvedValue({ ...DRAFT, status: 'Published' })
    renderPage()
    await openMenu(user, 'draft-1')
    await user.click(screen.getByRole('option', { name: 'Publish' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1))
    // The full body, every field the server reads; expectedStaffId is the worker the chip showed, so a stale chip is refused rather than written back.
    expect(h.update).toHaveBeenCalledWith({
      id: 'draft-1',
      data: expect.objectContaining({
        participantId: 'p-1', staffId: 'staff-2', serviceDate: '2026-08-18', startTime: '09:00', endTime: '15:00', endsNextDay: DRAFT.endsNextDay, ratio: DRAFT.ratio, nightType: DRAFT.nightType,
        status: 'Published', notes: 'Bring the lift sling', overrideReason: 'Cover', acknowledgedFindingCodes: ['SOME_WARNING'], expectedStaffId: 'staff-2',
      }),
    })
    await waitFor(() => expect(screen.getByText(/Published Mia Chen, Tuesday 9am to 3pm\. Sam has been notified\./)).toBeInTheDocument())
  })

  it('a second press while the first is out sends nothing more, and the item reads Publishing…', async () => {
    const user = userEvent.setup()
    let release: (v: unknown) => void = () => {}
    h.update.mockReturnValue(new Promise(r => { release = r }))
    renderPage()
    await openMenu(user, 'draft-1')
    await user.click(screen.getByRole('option', { name: 'Publish' }))
    await openMenu(user, 'draft-1')
    await user.click(screen.getByRole('option', { name: 'Publishing…' }))
    expect(h.update).toHaveBeenCalledTimes(1)
    release({ ...DRAFT, status: 'Published' })
  })

  it('a refusal leaves the shift Draft and says why, in the server\'s words', async () => {
    const user = userEvent.setup()
    h.update.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { message: 'This shift has already started.' } } })
    renderPage()
    await openMenu(user, 'draft-1')
    await user.click(screen.getByRole('option', { name: 'Publish' }))
    expect(await screen.findByText("Couldn't publish Mia Chen, Tuesday 9am to 3pm. This shift has already started.")).toBeInTheDocument()
    expect(within(chipOf('draft-1')).getByText('Draft')).toBeInTheDocument()
    await openMenu(user, 'draft-1')
    expect(screen.getByRole('option', { name: 'Publish' })).not.toHaveAttribute('aria-disabled')
  })

  it('findings on the shift say to open it, not a bare failure', async () => {
    const user = userEvent.setup()
    h.update.mockRejectedValue({ isAxiosError: true, response: { status: 422, data: { data: [makeFinding({ severity: 'Blocking' })] } } })
    renderPage()
    await openMenu(user, 'draft-1')
    await user.click(screen.getByRole('option', { name: 'Publish' }))
    expect(await screen.findByText("Couldn't publish Mia Chen, Tuesday 9am to 3pm. Open the shift to see what needs fixing, then publish it from there.")).toBeInTheDocument()
  })

  it('with no server message it names the shift and says to try again', async () => {
    const user = userEvent.setup()
    h.update.mockRejectedValue(new Error('boom'))
    renderPage()
    await openMenu(user, 'draft-1')
    await user.click(screen.getByRole('option', { name: 'Publish' }))
    expect(await screen.findByText("Couldn't publish Mia Chen, Tuesday 9am to 3pm. Please try again.")).toBeInTheDocument()
  })

  it('a worker moved since the board loaded (409) shows the board-changed notice with Refresh the board', async () => {
    const user = userEvent.setup()
    h.update.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { message: 'This shift changed after the board was loaded. Refresh the board and try again.', code: 'SHIFT_BOARD_CHANGED' } } })
    renderPage()
    await openMenu(user, 'draft-1')
    await user.click(screen.getByRole('option', { name: 'Publish' }))
    expect(await screen.findByRole('button', { name: 'Refresh the board' })).toBeInTheDocument()
    expect(screen.getByText(/Couldn't publish Mia Chen, Tuesday 9am to 3pm. This shift changed after the board was loaded/)).toBeInTheDocument()
  })

  it('a reader gets no actions menu, so no Publish', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    renderPage()
    expect(within(chipOf('draft-1')).queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument()
  })
})
