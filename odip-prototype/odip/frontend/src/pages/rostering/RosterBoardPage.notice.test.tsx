import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RosterBoardPage from './RosterBoardPage'
import { makeParticipantBoard, makeParticipantRow, makeShift, makeStaffBoard } from './test-fixtures'
import type { PendingAgreementDto, RosterBoardDto } from '@/api/types'

const h = vi.hoisted(() => ({ board: vi.fn() }))

vi.mock('@/api/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks')>('@/api/hooks')
  const idle = () => ({ mutateAsync: vi.fn(), isPending: false })
  return {
    ...actual,
    useRosterBoard: h.board,
    useAssignShift: idle, useMoveStaff: idle, usePublishWeek: idle, useCreateShift: idle, useUpdateShift: idle, useDeleteShift: idle,
    useParticipants: () => ({ data: [] }),
    useStaff: () => ({ data: [], isLoading: false }),
    useParticipantRoutines: () => ({ data: [] }),
    useCompatibility: () => ({ data: [] }),
    useRosterShiftNotes: () => ({ data: [] }),
    useCheckShift: () => ({ mutate: vi.fn(), isPending: false }),
  }
})
vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => false }))

const NOTICE = /^Shifts from a service agreement appear here once it's approved for rostering\./
const DANIEL = makeParticipantRow({ participantId: 'p-1', fullName: 'Daniel Osei' })
const GRACE = makeParticipantRow({ participantId: 'p-2', fullName: 'Grace Palmer-Hughes', shifts: [makeShift({ id: 'g-1', participantId: 'p-2', participantName: 'Grace Palmer-Hughes', serviceDate: '2026-08-18' })] })
const DANIEL_WAITS: PendingAgreementDto = { participantId: 'p-1', displayName: 'Daniel Osei', draftId: 'd-2', version: 2, canReceiveServices: true }
// Still in onboarding: no row on the board (live, 2026-10-15).
const KIM_WAITS: PendingAgreementDto = { participantId: 'p-9', displayName: 'Kim Tran', draftId: 'd-9', version: 1, canReceiveServices: false }
const showBoard = (board: RosterBoardDto) => h.board.mockReturnValue({ data: board, isLoading: false, isError: false, refetch: vi.fn() })

function renderPage(entry = '/rostering?date=2026-08-17') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/rostering', element: <RosterBoardPage /> }], { initialEntries: [entry] })
  return { ...render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>), router }
}

beforeEach(() => {
  h.board.mockReset()
  sessionStorage.clear()
  localStorage.clear()
})

describe('RosterBoardPage: the waiting-for-approval notice (spec 2026-10-15, decision A; L10)', () => {
  it('names who waits, each a link to the agreement, and marks their row', () => {
    showBoard(makeParticipantBoard({ participantRows: [DANIEL, GRACE], pendingAgreements: [DANIEL_WAITS] }))
    renderPage()
    expect(screen.getByText(NOTICE)).toHaveTextContent('Waiting: Daniel Osei v2.')
    expect(screen.getByRole('link', { name: 'Daniel Osei v2: open the service agreement' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: "Agreement v2 not approved: its shifts appear once it's approved for rostering" })).toBeInTheDocument()
  })

  it('names a participant with no row "(not active yet)" and says to start their services; only the active one, who has a row, is marked (Review Focus 4)', () => {
    showBoard(makeParticipantBoard({ participantRows: [DANIEL, GRACE], pendingAgreements: [KIM_WAITS, DANIEL_WAITS] }))
    renderPage()
    expect(screen.getByText(NOTICE)).toHaveTextContent(
      "Waiting: Daniel Osei v2 and Kim Tran v1 (not active yet). Start a participant's services before their agreement's shifts can be rostered.",
    )
    // The row marker is derived from the list by participantId: Daniel's row has it; Kim has no row, so nothing is marked for her.
    expect(screen.getAllByRole('img', { name: /not approved: its shifts appear/ })).toHaveLength(1)
    expect(screen.getByRole('img', { name: "Agreement v2 not approved: its shifts appear once it's approved for rostering" })).toBeInTheDocument()
  })

  it('follows the participant filter: no notice when the participant in view has nothing waiting', () => {
    showBoard(makeParticipantBoard({ participantRows: [DANIEL, GRACE], pendingAgreements: [DANIEL_WAITS, KIM_WAITS] }))
    renderPage('/rostering?date=2026-08-17&participant=p-2')
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
  })

  it('is gone once the agreement is approved', () => {
    showBoard(makeParticipantBoard({ participantRows: [DANIEL, GRACE], pendingAgreements: [] }))
    renderPage()
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
  })

  it('stands in for the "Nothing rostered this week" hint while it shows: it is the reason the week is empty', () => {
    showBoard(makeParticipantBoard({ participantRows: [DANIEL], pendingAgreements: [DANIEL_WAITS] }))
    const { unmount } = renderPage()
    expect(screen.getByText(NOTICE)).toBeInTheDocument()
    expect(screen.queryByText('Nothing rostered this week')).not.toBeInTheDocument()
    unmount()
    showBoard(makeParticipantBoard({ participantRows: [DANIEL], pendingAgreements: [] }))
    renderPage()
    expect(screen.getByText('Nothing rostered this week')).toBeInTheDocument()
  })

  it('is measured into the board frame, as the error Callout is, so strip and grid still share one screen', () => {
    showBoard(makeParticipantBoard({ participantRows: [DANIEL], pendingAgreements: [DANIEL_WAITS] }))
    const { container } = renderPage()
    const page = container.querySelector('.animate-fade-in') as HTMLElement
    // jsdom has no layout (offsetHeight 0); capture 10 measures the real thing.
    expect(page.style.getPropertyValue('--roster-notice-h')).toBe('calc(0px + var(--section-gap))')
  })

  it('is not in the Staff view, which has no data for it', () => {
    sessionStorage.setItem('odip.roster.boardView', 'staff')
    showBoard(makeStaffBoard())
    renderPage()
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
  })
})
