import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RosteringTab from './RosteringTab'
import type { ParticipantRosteringDto } from '@/api/types/participants'

const { mockUseParticipantRostering } = vi.hoisted(() => ({
  mockUseParticipantRostering: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useParticipantRostering: mockUseParticipantRostering,
}))

function makeData(overrides: Partial<ParticipantRosteringDto> = {}): ParticipantRosteringDto {
  return {
    upcomingShifts: [],
    assignedStaff: [],
    ...overrides,
  }
}

function renderTab() {
  return render(
    <MemoryRouter>
      <RosteringTab participantId="participant-1" />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseParticipantRostering.mockReset()
})

describe('RosteringTab', () => {
  it('shows a loading state', () => {
    mockUseParticipantRostering.mockReturnValue({ data: undefined, isLoading: true })
    renderTab()

    expect(screen.getByRole('status')).toHaveTextContent(/loading rostering details/i)
  })

  it('shows empty states when there is no assigned staff or upcoming shifts', () => {
    mockUseParticipantRostering.mockReturnValue({ data: makeData(), isLoading: false })
    renderTab()

    expect(screen.getByText('No staff assigned')).toBeInTheDocument()
    expect(screen.getByText('No shifts in the next 28 days')).toBeInTheDocument()
  })

  it('links an assigned staff card to their staff detail page and shows shift count/compatibility', () => {
    mockUseParticipantRostering.mockReturnValue({
      data: makeData({
        assignedStaff: [
          { staffId: 'staff-1', staffName: 'Alex Rivera', shiftCount: 3, compatibility: 'Preferred' },
        ],
      }),
      isLoading: false,
    })
    renderTab()

    expect(screen.getByRole('link', { name: 'Alex Rivera' })).toHaveAttribute('href', '/staff/staff-1')
    expect(screen.getByText('3 shifts')).toBeInTheDocument()
    expect(screen.getByText('Preferred')).toBeInTheDocument()
  })

  it('renders the upcoming shifts table with a staff link and date/time/status', () => {
    mockUseParticipantRostering.mockReturnValue({
      data: makeData({
        upcomingShifts: [
          {
            shiftId: 'shift-1', serviceDate: '2026-09-20', startTime: '08:00:00', endTime: '16:00:00',
            endsNextDay: false, staffId: 'staff-1', staffName: 'Alex Rivera', status: 'Published',
            assigneeOnApprovedLeave: false,
          },
        ],
      }),
      isLoading: false,
    })
    renderTab()

    expect(screen.getByRole('link', { name: 'Alex Rivera' })).toHaveAttribute('href', '/staff/staff-1')
    expect(screen.getByText('Published')).toBeInTheDocument()
  })

  it('shows an on-leave marker for a filled shift whose assignee has approved leave', () => {
    mockUseParticipantRostering.mockReturnValue({
      data: makeData({
        upcomingShifts: [
          {
            shiftId: 'shift-2', serviceDate: '2026-09-21', startTime: '19:00:00', endTime: '07:00:00',
            endsNextDay: true, staffId: 'staff-2', staffName: 'Mei Zhang', status: 'Published',
            assigneeOnApprovedLeave: true,
          },
        ],
      }),
      isLoading: false,
    })
    renderTab()

    expect(screen.getByText('On leave')).toBeInTheDocument()
  })

  it('shows "Unassigned" for a shift with no staffId', () => {
    mockUseParticipantRostering.mockReturnValue({
      data: makeData({
        upcomingShifts: [
          {
            shiftId: 'shift-3', serviceDate: '2026-09-22', startTime: '09:00:00', endTime: '15:00:00',
            endsNextDay: false, status: 'Published', assigneeOnApprovedLeave: false,
          },
        ],
      }),
      isLoading: false,
    })
    renderTab()

    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('links "Open roster" to /rostering', () => {
    mockUseParticipantRostering.mockReturnValue({ data: makeData(), isLoading: false })
    renderTab()

    expect(screen.getByRole('link', { name: /open roster/i })).toHaveAttribute('href', '/rostering')
  })
})
