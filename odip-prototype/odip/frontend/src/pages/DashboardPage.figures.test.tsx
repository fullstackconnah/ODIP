import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from './DashboardPage'

const { mockUseParticipantAlertsAggregate, mockUseDashboard, mockUsePendingLeaveQueue, mockUseStaff } = vi.hoisted(() => ({
  mockUseParticipantAlertsAggregate: vi.fn(),
  mockUseDashboard: vi.fn(),
  mockUsePendingLeaveQueue: vi.fn(),
  mockUseStaff: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useDashboard: mockUseDashboard,
  useSettings: () => ({ data: undefined }),
  useStaff: mockUseStaff,
  useParticipantAlertsAggregate: mockUseParticipantAlertsAggregate,
  usePendingLeaveQueue: mockUsePendingLeaveQueue,
}))

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  mockUsePendingLeaveQueue.mockReturnValue({ count: 0, loading: false, error: false })
  mockUseStaff.mockReturnValue({ data: [] })
  mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
  mockUseDashboard.mockReturnValue({
    data: {
      upcomingTripCount: 0, activeParticipantCount: 0, outstandingTaskCount: 2, overdueTaskCount: 2, conflictCount: 0,
      tripsMissingAccommodation: 0, tripsMissingVehicles: 0, tripsMissingStaff: 0, openIncidentCount: 0, qscOverdueCount: 0,
      upcomingTrips: [],
      overdueTasks: [
        { id: 'task-1', title: 'Chase invoice', priority: 'High', dueDate: '2026-10-02', tripName: 'Beach Trip', ownerName: 'Sam Owner' },
        { id: 'task-2', title: 'Find leave cover', priority: 'High', dueDate: '2026-10-01', ownerName: 'Sam Owner' },
      ],
    },
    isLoading: false,
    isError: false,
  })
})

function renderPage() {
  return render(<MemoryRouter><DashboardPage /></MemoryRouter>)
}

// L3-03: each attention figure must be reproducible on the page behind it. The band's tile for a count above zero carries its figure, a line saying what
// it counts, and a link to the page where the rows are.

describe('Dashboard "Overdue" figure', () => {
  it('links the tile to the task list filtered to Overdue, which the server answers with the same predicate', () => {
    renderPage()

    const tile = screen.getByRole('group', { name: 'Overdue 2' })
    expect(within(tile).getByRole('link', { name: 'Open overdue tasks' })).toHaveAttribute('href', '/tasks?status=Overdue')
  })

  it('links the Overdue Tasks panel "View All" to the same filtered list', () => {
    renderPage()

    const panel = screen.getByRole('heading', { name: 'Overdue Tasks' }).closest('div')!.parentElement!
    expect(within(panel).getByRole('link', { name: 'View All' })).toHaveAttribute('href', '/tasks?status=Overdue')
  })
})

describe('Dashboard "Critical Participant Alerts" figure', () => {
  it('says how many participants the alerts belong to, so the figure matches the flagged rows on the Participants page', () => {
    // Two participants holding 2 and 1 Critical alerts: the tile counts alerts (3), the Participants table shows 2 flagged rows.
    mockUseParticipantAlertsAggregate.mockReturnValue({
      data: [
        { participantId: 'p1', participantName: 'Jamie Smith', isActive: true, criticalCount: 2, warningCount: 0, infoCount: 0,
          alerts: [
            { type: 'plan-expired', severity: 'Critical', message: 'NDIS plan end date has passed', deepLinkTab: 'details', linkTo: null },
            { type: 'qsc-report-overdue', severity: 'Critical', message: 'QSC report has not been submitted', deepLinkTab: 'details', linkTo: '/incidents/i1' },
          ] },
        { participantId: 'p2', participantName: 'Alex Rivera', isActive: true, criticalCount: 1, warningCount: 0, infoCount: 0,
          alerts: [{ type: 'plan-expired', severity: 'Critical', message: 'NDIS plan end date has passed', deepLinkTab: 'details', linkTo: null }] },
      ],
      isLoading: false,
    })

    renderPage()

    const tile = screen.getByRole('group', { name: 'Critical Participant Alerts 3' })
    expect(tile).toHaveTextContent('3')
    expect(tile).toHaveTextContent('2 participants')
  })
})

describe('Dashboard "Qualification Issues" figure', () => {
  it('says how many staff the issues belong to, so it reads against the Qualifications page headline (a staff count)', () => {
    // Staff A holds four flagged credentials with no date (4 issues); staff B one expired First Aid (1 issue): the tile counts 5.
    const base = { isActive: true, workerScreeningExpiryDate: null }
    mockUseStaff.mockReturnValue({
      data: [
        { ...base, id: 's1', fullName: 'Staff A', isFirstAidQualified: true, isDriverEligible: true, isManualHandlingCompetent: true, isMedicationCompetent: true },
        { ...base, id: 's2', fullName: 'Staff B', isFirstAidQualified: true, firstAidExpiryDate: '2000-01-01' },
      ],
    })

    renderPage()

    const tile = screen.getByRole('group', { name: 'Qualification Issues 5' })
    expect(tile).toHaveTextContent('5')
    expect(tile).toHaveTextContent('2 staff members')
  })
})
