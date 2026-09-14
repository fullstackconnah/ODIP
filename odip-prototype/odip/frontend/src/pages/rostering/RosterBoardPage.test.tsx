import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RosterBoardPage from './RosterBoardPage'
import { makeParticipantBoard, makeParticipantRow, makeShift } from './test-fixtures'
import type { RosterBoardDto } from '@/api/types'

const { mockUseRosterBoard, mockAssignMutateAsync, mockDeleteMutateAsync } = vi.hoisted(() => ({
  mockUseRosterBoard: vi.fn(),
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
    useParticipants: () => ({ data: [] }),
    useStaff: () => ({ data: [] }),
  }
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
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
