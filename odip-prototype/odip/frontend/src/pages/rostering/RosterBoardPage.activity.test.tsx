import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RosterBoardPage from './RosterBoardPage'
import { makeActivity, makeFinding, makeParticipantBoard, makeParticipantRow, makeShift } from './test-fixtures'

const h = vi.hoisted(() => ({ board: vi.fn(), post: vi.fn(), del: vi.fn() }))

vi.mock('@/api/client', async () => ({
  ...(await vi.importActual<object>('@/api/client')),
  apiGet: (url: string) => Promise.resolve(String(url).includes('/rostering/group-activities/') ? makeActivity() : []),
  apiPost: (...a: unknown[]) => h.post(...a),
  apiDelete: (...a: unknown[]) => h.del(...a),
}))
vi.mock('@/api/hooks', async () => ({
  ...(await vi.importActual<typeof import('@/api/hooks')>('@/api/hooks')),
  useRosterBoard: h.board,
  useParticipants: () => ({ data: [] }),
  useStaff: () => ({ data: [{ id: 'staff-2', fullName: 'Sam Wilson', isActive: true, region: 'North', hasExpiredQualifications: false }], isLoading: false }),
  useParticipantRoutines: () => ({ data: [] }),
  useCompatibility: () => ({ data: [] }),
  useRosterShiftNotes: () => ({ data: [] }),
  useServiceLocations: () => ({ data: [] }),
}))
vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => false }))

const MIA = makeShift({ id: 'shift-1', participantId: 'participant-1', participantName: 'Mia Chen', serviceDate: '2026-08-17', groupActivityId: 'activity-1', isGroupLine: true, staffId: null, staffName: null })
const BOARD = makeParticipantBoard({
  groupActivitiesEnabled: true,
  groupActivities: [makeActivity()],
  participantRows: [makeParticipantRow({ participantId: 'participant-1', fullName: 'Mia Chen', shifts: [MIA] })],
})

function renderPage() {
  const router = createMemoryRouter([{ path: '/rostering', element: <RosterBoardPage /> }], { initialEntries: ['/rostering?date=2026-08-17'] })
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>)
}

const warning422 = { response: { status: 422, data: { success: false, data: [makeFinding({ code: 'STAFF_ON_LEAVE', severity: 'Warning', requiresReason: true, message: 'Sam Wilson is on leave.' })] } } }

beforeEach(() => {
  h.post.mockReset(); h.del.mockReset()
  h.board.mockReturnValue({ data: BOARD, isLoading: false, isError: false, refetch: vi.fn() })
  sessionStorage.clear(); localStorage.clear()
})

describe('RosterBoardPage: group activity writes', () => {
  it("shows the override prompt when the modal's Add staff meets a finding, and the retry sends the reason and codes", async () => {
    const user = userEvent.setup()
    h.post.mockRejectedValueOnce(warning422).mockResolvedValueOnce(makeActivity())
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^Group activity, Bowling/ }))
    await user.click(await screen.findByRole('button', { name: 'Add staff' }))
    await user.click(await screen.findByRole('option', { name: /^Sam Wilson/ }))
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/rostering/group-activities/activity-1/staff', { staffId: 'staff-2', overrideReason: null, acknowledgedFindingCodes: [] }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Assign with warnings' })
    await user.type(within(dialog).getByPlaceholderText('Reason for overriding these warnings'), '  Leave cancelled  ')
    await user.click(within(dialog).getByRole('button', { name: 'Assign anyway' }))
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(2))
    expect(h.post).toHaveBeenLastCalledWith('/rostering/group-activities/activity-1/staff', { staffId: 'staff-2', overrideReason: 'Leave cancelled', acknowledgedFindingCodes: ['STAFF_ON_LEAVE'] })
  })

  it('asks before the card menu removes a participant; Keep removes no one', async () => {
    const user = userEvent.setup()
    h.del.mockResolvedValue(makeActivity())
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Actions for Bowling' }))
    await user.click(await screen.findByText('Remove Mia from activity'))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Mia from Bowling?' })
    expect(within(dialog).getByText('Their shift stays on the board as a regular shift.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }))
    expect(h.del).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Actions for Bowling' }))
    await user.click(await screen.findByText('Remove Mia from activity'))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('/rostering/group-activities/activity-1/shifts/shift-1'))
  })
})
