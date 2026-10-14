import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { TONE } from '@/lib/tone'
import { mockUseDashboard, mockUseParticipantAlertsAggregate } from './dashboard/dashboardHookMocks'
import { installDashboardDefaults, renderPage, summaryData, asRole } from './dashboard/dashboardTestKit'

vi.mock('@/api/hooks', async () => (await import('./dashboard/dashboardHookMocks')).hooks)
vi.mock('./dashboard/useDecisionGroups', async () => ({ useDecisionGroups: (await import('./dashboard/dashboardHookMocks')).mockUseDecisionGroups }))

installDashboardDefaults()

// Density finish review (fix 5): the Upcoming trips rows give their long strings room. (The Overdue Tasks panel that shared this block is gone: the Tasks due
// group replaced it.)
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

  it('gives every truncated upcoming-trip cell a tooltip with its full text, destination included', () => {
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUseDashboard.mockReturnValue(dashboardWith({
      upcomingTripCount: 2,
      upcomingTrips: [
        { id: 't-2', tripName: 'Tamborine Mountain Getaway', destination: 'Mount Tamborine QLD', startDate: '2026-08-28', status: 'OpenForBookings', currentParticipantCount: 3, maxParticipants: 8 },
        { id: 't-3', tripName: 'Mystery Trip', destination: '', startDate: '2026-09-18', status: 'Planning', currentParticipantCount: 0, maxParticipants: 6 },
      ],
    }))
    renderPage()

    // "Mount Tamborine QLD" needs 123px at 12px and the cell is w-28 (112px): it is cut with an
    // ellipsis, so the full text has to be reachable.
    const destination = screen.getByText('Mount Tamborine QLD')
    expect(destination).toHaveClass('truncate', 'w-28')
    expect(destination).toHaveAttribute('title', 'Mount Tamborine QLD')
    expect(screen.getByText('Tamborine Mountain Getaway')).toHaveAttribute('title', 'Tamborine Mountain Getaway')
    // The "TBD" placeholder is titled too, so the cell never has a truncated, untitled state.
    expect(screen.getByText('TBD')).toHaveAttribute('title', 'TBD')
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

  it('has no tile and no list section when there are no Critical alerts: the band names the item among the clear ones', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    // The list section is omitted entirely when empty, and a zero is not a tile.
    expect(screen.queryByRole('heading', { name: 'Critical Participant Alerts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /Critical Participant Alerts/ })).not.toBeInTheDocument()
    expect(screen.getByText(/^Checked and at zero:.*critical participant alerts/)).toBeInTheDocument()
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
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SuperAdmin' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: undefined, isPending: true, isLoading: true })
    renderPage()

    expect(screen.getByText('Critical Participant Alerts')).toBeInTheDocument()
    // The rest of the band IS clear (the useStaff mock's empty list, the zeros of the summary), so it still says so, but it does not name the item whose
    // request is in flight, and the band is not the all-clear field while that item is waiting.
    const row = screen.getByText('All clear', { selector: 'span.font-semibold' }).closest('p') as HTMLElement
    expect(row).toHaveTextContent('qualification issues')
    expect(row).not.toHaveTextContent('critical participant alerts')
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })
})

// Density polish (touch): the "View All" links (16px) and the upcoming-trip
// rows (40px) were all under 44px on a phone. Each takes a `--tap-min` floor: 0px on a mouse, so the desktop
// dashboard is exactly what it was, 44px tall under `pointer: coarse`. jsdom has no CSS, so the class contract is
// what is pinned here.
describe('DashboardPage — 44px touch targets', () => {
  const FLOOR = ['min-h-[var(--tap-min)]']
  const renderWithLists = () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({
      data: [{
        participantId: 'p1', participantName: 'Jamie Smith', isActive: true,
        alerts: [{ type: 'plan-expired', severity: 'Critical', message: 'NDIS plan end date has passed', deepLinkTab: 'details', linkTo: null }],
        criticalCount: 1, warningCount: 0, infoCount: 0,
      }],
      isLoading: false,
    })
    mockUseDashboard.mockReturnValue({
      data: {
        upcomingTripCount: 1, activeParticipantCount: 0, outstandingTaskCount: 0,
        overdueTaskCount: 1, conflictCount: 0, tripsMissingAccommodation: 0,
        tripsMissingVehicles: 0, tripsMissingStaff: 0, openIncidentCount: 0, qscOverdueCount: 0,
        upcomingTrips: [{ id: 't-1', tripName: 'Beach Trip', destination: 'Caloundra QLD', startDate: '2026-08-28', status: 'Confirmed', currentParticipantCount: 3, maxParticipants: 8 }],
        overdueTasks: [{ id: 'task-1', title: 'Chase invoice', priority: 'High', dueDate: new Date(Date.now() - 3600000).toISOString(), tripName: 'Beach Trip', ownerName: 'Sam Owner' }],
      },
      isLoading: false, isError: false,
    })
    return renderPage()
  }

  it('floors both "View All" links (Upcoming trips, Critical Participant Alerts) at --tap-min', () => {
    renderWithLists()

    const viewAll = screen.getAllByRole('link', { name: 'View All' })
    // In page order: the Critical Participant Alerts cards (Alerts) come before Upcoming trips now. The Overdue Tasks panel is gone; the decision groups' links carry TAP_FLOOR too (QuickGroup.test.tsx).
    expect(viewAll.map(a => a.getAttribute('href'))).toEqual(['/participants', '/trips'])
    for (const link of viewAll) {
      expect(link).toHaveClass('pointer-coarse:inline-flex', ...FLOOR, 'pointer-coarse:items-center', 'font-bold', 'hover:underline')
    }
  })

  it('sets both at text-xs: the alerts list takes the panels\' own link size now, so the band stays the loudest thing on the page', () => {
    renderWithLists()

    for (const link of screen.getAllByRole('link', { name: 'View All' })) expect(link).toHaveClass('text-xs')
  })

  it('lifts each upcoming-trip row to --tap-min while it stays h-10 (40px) on a mouse', () => {
    renderWithLists()

    const row = screen.getByRole('link', { name: /Beach Trip/ })
    expect(row).toHaveClass('flex', 'h-10', ...FLOOR, 'items-center')
    expect(row).toHaveAttribute('href', '/trips/t-1')
  })
  it('never hard-codes 44px: every floor is the --tap-min token', () => {
    const { container } = renderWithLists()

    expect(container.innerHTML).not.toMatch(/(?:min-h|min-w|h|w)-\[44px\]/)
  })
})

// A trip status is coloured one way everywhere: the dashboard's chips take StatusBadge's tones (lib/tone.ts),
// not a map of their own (it had no entry for Cancelled or Archived, which fell to grey). A task's priority is the Tasks due group's now (words in its meta).
describe('DashboardPage — trip status and task priority chips use the shared tones', () => {
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
  const trip = (status: string) => ({
    id: `t-${status}`, tripName: `Trip ${status}`, startDate: '2026-08-14', destination: 'Somewhere', currentParticipantCount: 1, maxParticipants: 6, status,
  })

  it.each([
    ['Draft', 'neutral'],
    ['Planning', 'info'],
    ['OpenForBookings', 'success'],
    ['WaitlistOnly', 'warning'],
    ['Confirmed', 'success'],
    ['InProgress', 'info'], // owner decision: in progress is information (blue)
    ['Completed', 'success'],
    ['Cancelled', 'danger'],
    ['Archived', 'neutral'],
  ] as const)('colours a %s trip with the %s tone', (status, tone) => {
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUseDashboard.mockReturnValue(dashboardWith({ upcomingTripCount: 1, upcomingTrips: [trip(status)] }))
    renderPage()

    const chip = screen.getByText(status.replace(/([A-Z])/g, ' $1').trim())
    expect(chip).toHaveClass('rounded-full', 'text-xs', 'font-bold', 'shrink-0', ...TONE[tone].solid.split(' '))
  })

})

describe('DashboardPage — due dates and participant ratios', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('spells the participant ratio of a trip "x / y", with an en dash when there is no maximum', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUseDashboard.mockReturnValue(summaryData({
      upcomingTripCount: 2,
      upcomingTrips: [
        { id: 't-a', tripName: 'Beach Trip', destination: 'Caloundra QLD', startDate: '2026-08-28', status: 'Confirmed', currentParticipantCount: 5, maxParticipants: 6 },
        { id: 't-b', tripName: 'Open Trip', destination: 'Byron Bay', startDate: '2026-09-28', status: 'Confirmed', currentParticipantCount: 3, maxParticipants: 0 },
      ],
    }))
    renderPage()

    expect(screen.getByText('5 / 6 pax')).toBeInTheDocument()
    expect(screen.getByText('3 / — pax')).toBeInTheDocument()
  })
})
