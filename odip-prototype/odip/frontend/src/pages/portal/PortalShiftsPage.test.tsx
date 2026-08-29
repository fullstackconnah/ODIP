import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PortalShiftsPage from './PortalShiftsPage'
import type { PortalShiftsResponseDto } from '@/api/types'

const { mockUseMyShifts } = vi.hoisted(() => ({
  mockUseMyShifts: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useMyShifts: mockUseMyShifts,
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <PortalShiftsPage />
    </MemoryRouter>,
  )
}

const NOT_LINKED: PortalShiftsResponseDto = {
  isLinked: false,
  staffId: null,
  shifts: [],
  tripAssignments: [],
}

function makeShiftsResponse(overrides: Partial<PortalShiftsResponseDto> = {}): PortalShiftsResponseDto {
  return {
    isLinked: true,
    staffId: 'staff-1',
    shifts: [
      {
        id: 'shift-1',
        participantId: 'participant-1',
        participantName: 'Mia Chen',
        serviceDate: '2026-08-17',
        startTime: '09:00:00',
        endTime: '17:00:00',
        endsNextDay: false,
        durationHours: 8,
        ratio: 'OneToOne',
        nightType: 'None',
        status: 'Published',
        notes: null,
      },
    ],
    tripAssignments: [],
    ...overrides,
  }
}

beforeEach(() => {
  mockUseMyShifts.mockReset()
})

describe('PortalShiftsPage', () => {
  it('shows guidance when the account is not linked to a staff record', () => {
    mockUseMyShifts.mockReturnValue({ data: NOT_LINKED, isLoading: false })
    renderPage()

    expect(screen.getByText(/isn't linked to a staff record/i)).toBeInTheDocument()
    expect(screen.queryByText('Mia Chen')).not.toBeInTheDocument()
  })

  it('renders the caller\'s own shifts, grouped by day, as links to the shift detail route', () => {
    mockUseMyShifts.mockReturnValue({ data: makeShiftsResponse(), isLoading: false })
    renderPage()

    expect(screen.getByText('Mia Chen')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Mia Chen/i })
    expect(link).toHaveAttribute('href', '/portal/shifts/shift-1')
  })

  it('shows an empty state when linked but nothing is rostered', () => {
    mockUseMyShifts.mockReturnValue({ data: makeShiftsResponse({ shifts: [] }), isLoading: false })
    renderPage()

    expect(screen.getByText(/nothing rostered this week/i)).toBeInTheDocument()
  })

  it('renders trip assignments alongside shifts', () => {
    mockUseMyShifts.mockReturnValue({
      data: makeShiftsResponse({
        tripAssignments: [
          {
            id: 'assign-1',
            tripInstanceId: 'trip-1',
            tripCode: 'TRIP-001',
            tripName: 'Beach Getaway',
            assignmentStart: '2026-08-18',
            assignmentEnd: '2026-08-20',
            isDriver: true,
            status: 'Confirmed',
          },
        ],
      }),
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Beach Getaway')).toBeInTheDocument()
    expect(screen.getByText(/driver/i)).toBeInTheDocument()
  })
})
