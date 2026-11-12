import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RosterBoardPage from './RosterBoardPage'
import { makeActivity, makeParticipantBoard, makeParticipantRow, makeShift } from './test-fixtures'

const h = vi.hoisted(() => ({ board: vi.fn() }))

vi.mock('@/api/client', async () => ({
  ...(await vi.importActual<object>('@/api/client')),
  apiGet: (url: string) => Promise.resolve(String(url).includes('/rostering/group-activities/') ? makeActivity() : []),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}))
vi.mock('@/api/hooks', async () => ({
  ...(await vi.importActual<typeof import('@/api/hooks')>('@/api/hooks')),
  useProviderTodayQuery: () => ({ data: { date: '2026-08-01' } }),
  useRosterBoard: h.board,
  useParticipants: () => ({ data: [] }),
  useStaff: () => ({ data: [], isLoading: false }),
  useParticipantRoutines: () => ({ data: [] }),
  useCompatibility: () => ({ data: [] }),
  useRosterShiftNotes: () => ({ data: [] }),
  useServiceLocations: () => ({ data: [] }),
}))
vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => false }))

const MIA = makeShift({ id: 'shift-1', participantId: 'participant-1', participantName: 'Mia Chen', serviceDate: '2026-08-17', groupActivityId: 'activity-1', isGroupLine: true, staffId: null, staffName: null })
const boardWith = (over: Parameters<typeof makeParticipantBoard>[0] = {}) => makeParticipantBoard({
  groupActivitiesEnabled: true,
  groupActivities: [makeActivity(), makeActivity({ id: 'activity-2', title: 'Art', activityName: 'Art', serviceDate: '2026-08-18' })],
  participantRows: [makeParticipantRow({ participantId: 'participant-1', fullName: 'Mia Chen', shifts: [MIA] })],
  ...over,
})

function renderPage(entry = '/rostering?date=2026-08-17') {
  const router = createMemoryRouter([{ path: '/rostering', element: <RosterBoardPage /> }], { initialEntries: [entry] })
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)
}
const load = (board: ReturnType<typeof boardWith>) => h.board.mockReturnValue({ data: board, isLoading: false, isError: false, refetch: vi.fn() })

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear()
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  h.board.mockReset()
  load(boardWith())
})

describe('RosterBoardPage: By activity view', () => {
  it('offers By activity only while group activities are on', () => {
    load(boardWith({ groupActivitiesEnabled: false }))
    renderPage()
    expect(screen.queryByRole('radio', { name: 'By activity' })).not.toBeInTheDocument()
  })

  it('shows one lane per activity, hides the participant chrome, and reuses the participant board', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('radio', { name: 'By activity' }))
    // each name shows twice: the lane label and the card
    await waitFor(() => expect(screen.getAllByText('Art')).toHaveLength(2))
    expect(screen.getAllByText('Bowling')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Unfilled only' })).not.toBeInTheDocument()
    expect(screen.queryByText('All participants')).not.toBeInTheDocument()
    expect(h.board).toHaveBeenLastCalledWith('2026-08-17', 'participant')
    expect(sessionStorage.getItem('odip.roster.boardView')).toBe('activity')
  })

  it('opens the activity panel from a block', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem('odip.roster.boardView', 'activity')
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^Group activity, Bowling/ }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('gives focus back to the block that opened the panel', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem('odip.roster.boardView', 'activity')
    renderPage()
    const block = await screen.findByRole('button', { name: /^Group activity, Bowling/ })
    block.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^Group activity, Bowling/ })).toHaveFocus()
  })

  it('an empty week shows the empty state in place of the grid, with the writer copy', async () => {
    sessionStorage.setItem('odip.roster.boardView', 'activity')
    load(boardWith({ groupActivities: [] }))
    renderPage()
    expect(await screen.findByText('No group activities this week')).toBeInTheDocument()
    expect(screen.getByText('Add one with New, then Group activity.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing rostered this week')).not.toBeInTheDocument()
  })

  it('an empty week reads differently for someone who cannot write', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    sessionStorage.setItem('odip.roster.boardView', 'activity')
    load(boardWith({ groupActivities: [] }))
    renderPage()
    expect(await screen.findByText('Nothing is planned for this week.')).toBeInTheDocument()
  })

  it('lanes show on an unstarted week with no start card', async () => {
    sessionStorage.setItem('odip.roster.boardView', 'activity')
    load(boardWith({ weekStarted: false }))
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Bowling')).toHaveLength(2))
    expect(screen.queryByText("This week hasn't been started")).not.toBeInTheDocument()
  })

  it('falls back to By participant, and stores it, when the switch is off', async () => {
    sessionStorage.setItem('odip.roster.boardView', 'activity')
    load(boardWith({ groupActivitiesEnabled: false }))
    renderPage()
    await waitFor(() => expect(sessionStorage.getItem('odip.roster.boardView')).toBe('participant'))
    expect(await screen.findByRole('radio', { name: 'By participant', checked: true })).toBeInTheDocument()
  })

  it('a ?participant link switches a remembered By activity to By participant', async () => {
    sessionStorage.setItem('odip.roster.boardView', 'activity')
    renderPage('/rostering?date=2026-08-17&participant=participant-1')
    await waitFor(() => expect(sessionStorage.getItem('odip.roster.boardView')).toBe('participant'))
    expect(within(await screen.findByRole('radiogroup')).getByRole('radio', { name: 'By participant', checked: true })).toBeInTheDocument()
  })
})
