import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from './DashboardPage'

const { mockUseParticipantAlertsAggregate, mockUseDashboard, mockUsePendingLeaveCount } = vi.hoisted(() => ({
  mockUseParticipantAlertsAggregate: vi.fn(),
  mockUseDashboard: vi.fn(),
  mockUsePendingLeaveCount: vi.fn(),
}))

// Only the API layer needs mocking — the rest of DashboardPage's rendering (trips/tasks lists)
// falls back to its own built-in empty defaults when useDashboard returns no data.
vi.mock('@/api/hooks', () => ({
  useDashboard: mockUseDashboard,
  useSettings: () => ({ data: undefined }),
  useStaff: () => ({ data: [] }),
  useParticipantAlertsAggregate: mockUseParticipantAlertsAggregate,
  usePendingLeaveCount: mockUsePendingLeaveCount,
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  )
}

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

beforeEach(() => {
  mockUseDashboard.mockReturnValue({ data: undefined, isLoading: false, isError: false })
  mockUsePendingLeaveCount.mockReturnValue(0)
})

describe('DashboardPage — Overdue Tasks link (PP-75)', () => {
  it('deep-links each overdue task to its edit route and labels the link "View"', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUseDashboard.mockReturnValue({
      data: {
        upcomingTripCount: 0, activeParticipantCount: 0, outstandingTaskCount: 0,
        overdueTaskCount: 1, conflictCount: 0, tripsMissingAccommodation: 0,
        tripsMissingVehicles: 0, tripsMissingStaff: 0, openIncidentCount: 0,
        qscOverdueCount: 0, upcomingTrips: [],
        overdueTasks: [{ id: 'task-1', title: 'Chase invoice', priority: 'High', dueDate: new Date(Date.now() - 3600000).toISOString(), tripName: 'Beach Trip', ownerName: 'Sam Owner' }],
      },
      isLoading: false, isError: false,
    })
    renderPage()

    const link = document.querySelector('a[href="/tasks/task-1/edit"]')
    expect(link).not.toBeNull()
    expect(link).toHaveTextContent(/view/i)
    expect(screen.queryByText(/^resolve$/i)).not.toBeInTheDocument()
  })

  // Item 9: an obligation-engine task (LeaveCoverage, IncidentQscReport, …) isn't raised against
  // a trip, so tripInstanceId/tripName are now omitted from the wire response rather than sent as
  // null — the tile must render this without throwing, and its click-through must still work.
  it('renders a trip-less overdue task without crashing and keeps its View link working', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUseDashboard.mockReturnValue({
      data: {
        upcomingTripCount: 0, activeParticipantCount: 0, outstandingTaskCount: 0,
        overdueTaskCount: 1, conflictCount: 0, tripsMissingAccommodation: 0,
        tripsMissingVehicles: 0, tripsMissingStaff: 0, openIncidentCount: 0,
        qscOverdueCount: 0, upcomingTrips: [],
        overdueTasks: [{ id: 'task-2', title: 'Find leave cover', priority: 'High', dueDate: new Date(Date.now() - 3600000).toISOString(), ownerName: 'Sam Owner' }],
      },
      isLoading: false, isError: false,
    })

    expect(() => renderPage()).not.toThrow()
    expect(screen.getByText('Find leave cover')).toBeInTheDocument()
    const link = document.querySelector('a[href="/tasks/task-2/edit"]')
    expect(link).not.toBeNull()
    expect(link).toHaveTextContent(/view/i)
  })
})

// Density finish review (fix 5): at 1920 the content box is 1648px, and the KPI row must hold
// every tile on one line while the Overdue Tasks panel gives its long title/trip strings room.
describe('DashboardPage — density layout', () => {
  const dashboardWith = (overrides: Record<string, unknown>) => ({
    data: {
      upcomingTripCount: 0, activeParticipantCount: 0, outstandingTaskCount: 0,
      overdueTaskCount: 0, conflictCount: 0, tripsMissingAccommodation: 0,
      tripsMissingVehicles: 0, tripsMissingStaff: 0, openIncidentCount: 0,
      qscOverdueCount: 0, upcomingTrips: [], overdueTasks: [],
      ...overrides,
    },
    isLoading: false, isError: false,
  })

  it('sizes the KPI row with an 8.5rem (136px) tile minimum so 10-11 tiles fit one row at 1920', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUseDashboard.mockReturnValue(dashboardWith({}))
    const { container } = renderPage()

    const kpiRow = container.querySelector('div[class*="auto-fit"]') as HTMLElement
    expect(kpiRow.className).toMatch(/minmax\(8\.5rem,1fr\)/)
    // 11 tiles (Coordinator sees the alerts tile): 11 x 136 + 10 x 8 gaps = 1576px <= 1648px.
    expect(kpiRow.children.length).toBe(11)
    expect(11 * 136 + 10 * 8).toBeLessThanOrEqual(1920 - 232 - 2 * 20)
  })

  it('splits Upcoming Trips / Overdue Tasks evenly from xl, not 3fr/2fr', () => {
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUseDashboard.mockReturnValue(dashboardWith({}))
    const { container } = renderPage()

    const panels = container.querySelector('div[class*="xl:grid-cols-2"]') as HTMLElement
    expect(panels).not.toBeNull()
    expect(panels.className).not.toMatch(/3fr/)
    expect(panels.className).toMatch(/items-start/)
  })

  it('shows an overdue task\'s full title (which carries the participant name) and trip name, with tooltips for narrow panels', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUseDashboard.mockReturnValue(dashboardWith({
      overdueTaskCount: 1,
      overdueTasks: [{
        id: 'task-9', title: 'Chase travel insurance certificate — Sienna W.', priority: 'Urgent',
        dueDate: new Date(Date.now() - 3 * 86400000).toISOString(), tripName: 'Sunshine Coast Beach Escape', ownerName: 'Callum Radford',
      }],
    }))
    renderPage()

    const title = screen.getByText('Chase travel insurance certificate — Sienna W.')
    expect(title).toHaveAttribute('title', 'Chase travel insurance certificate — Sienna W.')
    const trip = screen.getByText('Sunshine Coast Beach Escape')
    expect(trip).toHaveAttribute('title', 'Sunshine Coast Beach Escape')
    // The trip cell appears only when the *panel* (container query) is wide enough for it, so the
    // title keeps the space in narrower panels.
    expect(trip.className).toMatch(/hidden/)
    expect(trip.className).toMatch(/@3xl:inline/)
  })
})

describe('DashboardPage — Critical Participant Alerts card', () => {
  it('lists a Critical alert with the participant name and message for a Coordinator', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({
      data: [
        {
          participantId: 'p1', participantName: 'Jamie Smith', isActive: true,
          alerts: [
            { type: 'plan-expired', severity: 'Critical', message: 'NDIS plan end date has passed', deepLinkTab: 'details', linkTo: null },
          ],
          criticalCount: 1, warningCount: 0, infoCount: 0,
        },
        {
          participantId: 'p2', participantName: 'Alex Rivera', isActive: true,
          alerts: [
            { type: 'routine-coverage-gap', severity: 'Warning', message: 'No active routines recorded', deepLinkTab: 'routines', linkTo: null },
          ],
          criticalCount: 0, warningCount: 1, infoCount: 0,
        },
      ],
      isLoading: false,
    })
    renderPage()

    // Appears twice: the metric tile and the list section's heading.
    expect(screen.getAllByText('Critical Participant Alerts').length).toBe(2)
    expect(screen.getByText('Jamie Smith')).toBeInTheDocument()
    expect(screen.getByText('NDIS plan end date has passed')).toBeInTheDocument()
    // Only the Critical-severity alert is surfaced — the Warning-only participant is excluded.
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument()

    const link = screen.getByText('Jamie Smith').closest('a')
    expect(link).toHaveAttribute('href', '/participants/p1?tab=details')
  })

  it('links to alert.linkTo instead of the participant tab when the alert carries one, and shows the human type label', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({
      data: [
        {
          participantId: 'p1', participantName: 'Jamie Smith', isActive: true,
          alerts: [
            { type: 'open-serious-incident', severity: 'Critical', message: 'Open serious incident requires review', deepLinkTab: 'incidents', linkTo: '/incidents/inc-1' },
          ],
          criticalCount: 1, warningCount: 0, infoCount: 0,
        },
        {
          participantId: 'p2', participantName: 'Alex Rivera', isActive: true,
          alerts: [
            { type: 'qsc-report-overdue', severity: 'Critical', message: 'QSC report has not been submitted', deepLinkTab: 'details', linkTo: '/qsc-reports/qsc-1' },
          ],
          criticalCount: 1, warningCount: 0, infoCount: 0,
        },
      ],
      isLoading: false,
    })
    renderPage()

    const incidentLink = screen.getByText('Jamie Smith').closest('a')
    expect(incidentLink).toHaveAttribute('href', '/incidents/inc-1')
    const qscLink = screen.getByText('Alex Rivera').closest('a')
    expect(qscLink).toHaveAttribute('href', '/qsc-reports/qsc-1')

    // The card shows the alert type in the same human wording as the label map, alongside the message.
    expect(screen.getByText('Open serious incident')).toBeInTheDocument()
    expect(screen.getByText('QSC report overdue')).toBeInTheDocument()
  })

  it('shows an "All clear" tile and no list section when there are no Critical alerts', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    // Only the metric tile's heading appears — the list section is omitted entirely when empty.
    expect(screen.getAllByText('Critical Participant Alerts')).toHaveLength(1)
    expect(screen.getAllByText('All clear').length).toBeGreaterThan(0)
  })

  it('is hidden entirely for a SupportWorker (matches the backend Admin/Coordinator/SuperAdmin gate)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    expect(screen.queryByText('Critical Participant Alerts')).not.toBeInTheDocument()
  })

  it('excludes an inactive participant\'s Critical alert from the tile count and list, even if the aggregate mock includes one (fix round 1 — review finding)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({
      data: [
        {
          participantId: 'p1', participantName: 'Jamie Smith', isActive: true,
          alerts: [
            { type: 'plan-expired', severity: 'Critical', message: 'NDIS plan end date has passed', deepLinkTab: 'details', linkTo: null },
          ],
          criticalCount: 1, warningCount: 0, infoCount: 0,
        },
        {
          // Simulates a churned/archived participant whose stale PlanEndDate would otherwise
          // generate a permanent, undismissable Critical alert.
          participantId: 'p2', participantName: 'Churned Client', isActive: false,
          alerts: [
            { type: 'plan-expired', severity: 'Critical', message: 'NDIS plan end date has passed', deepLinkTab: 'details', linkTo: null },
          ],
          criticalCount: 1, warningCount: 0, infoCount: 0,
        },
      ],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Jamie Smith')).toBeInTheDocument()
    expect(screen.queryByText('Churned Client')).not.toBeInTheDocument()

    // Tile count reflects only the active participant's Critical alert (1), not both (2).
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('2')).not.toBeInTheDocument()
  })

  it('does not claim "All clear" while the alerts request is still loading (a false negative would be worse than a blank tile)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: undefined, isLoading: true })
    renderPage()

    expect(screen.getByText('Critical Participant Alerts')).toBeInTheDocument()
    // The unrelated Qualification Issues tile also renders "All clear" (its own zero-issue
    // state, from the useStaff mock's empty list) — assert only the Critical Alerts tile's own
    // copy is absent, by checking the count stays at that one pre-existing occurrence.
    expect(screen.getAllByText('All clear')).toHaveLength(1)
  })
})

describe('DashboardPage — Pending Leave card (I-6)', () => {
  it('links to the leave approvals queue with the pending count for a Coordinator', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUsePendingLeaveCount.mockReturnValue(3)
    renderPage()

    const link = screen.getByText('Pending Leave').closest('a')
    expect(link).toHaveAttribute('href', '/rostering/leave')
    expect(within(link as HTMLElement).getByText('3')).toBeInTheDocument()
  })

  it('is hidden when there are no pending leave requests', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUsePendingLeaveCount.mockReturnValue(0)
    renderPage()

    expect(screen.queryByText('Pending Leave')).not.toBeInTheDocument()
  })

  it('is hidden for a SupportWorker (matches the backend Admin/Coordinator/SuperAdmin gate)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUsePendingLeaveCount.mockReturnValue(3)
    renderPage()

    expect(screen.queryByText('Pending Leave')).not.toBeInTheDocument()
  })
})
