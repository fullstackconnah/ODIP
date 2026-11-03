import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RosterBoardPage from './RosterBoardPage'
import { makeParticipantBoard, makeParticipantRow, makeShift, makeUnfilledShift } from './test-fixtures'
import type { RosterBoardDto, ShiftDto } from '@/api/types'

// Auto-roster (R7 PR2), the page's half: when the trigger shows, and the run that opens the panel.
const h = vi.hoisted(() => ({ board: vi.fn(), draft: vi.fn(), apply: vi.fn() }))

vi.mock('@/api/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks')>('@/api/hooks')
  return {
    ...actual,
    useRosterBoard: h.board,
    useAutoRosterDraft: () => ({ mutateAsync: h.draft, isPending: false }),
    useApplyAutoRoster: () => ({ mutateAsync: h.apply, isPending: false }),
    usePublishWeek: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useStartWeek: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useParticipants: () => ({ data: [] }),
    useStaff: () => ({ data: [], isLoading: false }),
    useParticipantRoutines: () => ({ data: [] }),
    useCompatibility: () => ({ data: [] }),
    useRosterShiftNotes: () => ({ data: [] }),
  }
})

const open = (o: Partial<ShiftDto> = {}) => makeUnfilledShift({ id: 'open-tue', participantId: 'p-1', participantName: 'Mia Chen', serviceDate: '2026-08-18', status: 'Draft', ...o })
const filled = makeShift({ id: 'f1', participantId: 'p-1', participantName: 'Mia Chen', serviceDate: '2026-08-19', staffId: 'staff-2', staffName: 'Sam Wilson', status: 'Draft' })
const board = (shifts: ShiftDto[], extra: Partial<Extract<RosterBoardDto, { groupBy: 'Participant' }>> = {}) =>
  makeParticipantBoard({ weekStarted: true, participantRows: [makeParticipantRow({ participantId: 'p-1', fullName: 'Mia Chen', shifts })], ...extra })
const showBoard = (data: RosterBoardDto) => h.board.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn() })

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/rostering', element: <RosterBoardPage /> }], { initialEntries: ['/rostering?date=2026-08-17'] })
  return render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
}
const trigger = () => screen.queryByRole('button', { name: 'Auto-roster' })

beforeEach(() => {
  for (const fn of [h.board, h.draft, h.apply]) fn.mockReset()
  sessionStorage.clear()
  localStorage.clear()
})

describe('the Auto-roster trigger', () => {
  it('shows on a started week with an open shift, for a writer, and is a secondary button', () => {
    showBoard(board([open(), filled]))
    renderPage()
    expect(trigger()).toBeInTheDocument()
    expect(trigger()).not.toHaveClass('bg-[var(--color-primary)]')
  })

  it('is hidden for a reader', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    showBoard(board([open()]))
    renderPage()
    expect(trigger()).not.toBeInTheDocument()
  })

  it('is hidden on an unstarted week, where the Start card is the action', () => {
    showBoard(board([open()], { weekStarted: false }))
    renderPage()
    expect(trigger()).not.toBeInTheDocument()
  })

  it('is hidden when no shift is open', () => {
    showBoard(board([filled]))
    renderPage()
    expect(trigger()).not.toBeInTheDocument()
  })

  it('is hidden when the only unfilled shift is Cancelled, which nobody can fill', () => {
    showBoard(board([open({ status: 'Cancelled' }), filled]))
    renderPage()
    expect(trigger()).not.toBeInTheDocument()
  })
})

describe('the run', () => {
  it('opens the panel at once, drafts the shown week, and drops an answer that comes after the panel is closed', async () => {
    const user = userEvent.setup()
    let answer: (d: unknown) => void = () => {}
    h.draft.mockReturnValue(new Promise(resolve => { answer = resolve }))
    showBoard(board([open()]))
    renderPage()

    await user.click(trigger()!)
    expect(await screen.findByRole('dialog', { name: 'Draft roster' })).toBeInTheDocument()
    expect(screen.getByText('Drafting the week…')).toBeInTheDocument()
    expect(h.draft).toHaveBeenCalledWith('2026-08-17')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    answer({ weekStart: '2026-08-17', generatedAt: '2026-08-14T00:00:00Z', changes: [], hours: [], uncovered: [] })
    await Promise.resolve()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a failed run shows its sentence in the panel with Try again, which runs it again', async () => {
    const user = userEvent.setup()
    h.draft.mockRejectedValueOnce({ response: { status: 400, data: { errors: ['Choose an organisation to auto-roster its week.'] } } })
    h.draft.mockReturnValue(new Promise(() => {}))
    showBoard(board([open()]))
    renderPage()

    await user.click(trigger()!)
    expect(await screen.findByText('Choose an organisation to auto-roster its week.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(h.draft).toHaveBeenCalledTimes(2)
  })
})
