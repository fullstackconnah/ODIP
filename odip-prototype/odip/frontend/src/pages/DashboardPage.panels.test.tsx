import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { TONE } from '@/lib/tone'
import { mockUseDashboard, mockUseParticipantAlertsAggregate } from './dashboard/dashboardHookMocks'
import { installDashboardDefaults, renderPage, summaryData, asRole } from './dashboard/dashboardTestKit'

vi.mock('@/api/hooks', async () => (await import('./dashboard/dashboardHookMocks')).hooks)

installDashboardDefaults()

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

// Density finish review (fix 5): the Overdue Tasks panel gives its long title/trip strings room. (The KPI row that
// used to share this block is now the attention band; its layout is pinned in "needs-attention band" below.)
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
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
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

// Density polish (touch): the "View All" links (16px), the overdue-task "View" links (16px) and the upcoming-trip
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

  it('floors all three "View All" links (Upcoming Trips, Overdue Tasks, Critical Participant Alerts) at --tap-min', () => {
    renderWithLists()

    const viewAll = screen.getAllByRole('link', { name: 'View All' })
    // The Overdue Tasks panel opens the Tasks list on its Overdue filter, the same rule the figure counts (L3-03).
    expect(viewAll.map(a => a.getAttribute('href'))).toEqual(['/trips', '/tasks?status=Overdue', '/participants'])
    for (const link of viewAll) {
      expect(link).toHaveClass('pointer-coarse:inline-flex', ...FLOOR, 'pointer-coarse:items-center', 'font-bold', 'hover:underline')
    }
  })

  it('sets all three at text-xs: the alerts list takes the panels\' own link size now, so the band stays the loudest thing on the page', () => {
    renderWithLists()

    for (const link of screen.getAllByRole('link', { name: 'View All' })) expect(link).toHaveClass('text-xs')
  })

  it('lifts each upcoming-trip row to --tap-min while it stays h-10 (40px) on a mouse', () => {
    renderWithLists()

    const row = screen.getByRole('link', { name: /Beach Trip/ })
    expect(row).toHaveClass('flex', 'h-10', ...FLOOR, 'items-center')
    expect(row).toHaveAttribute('href', '/trips/t-1')
  })

  it('gives an overdue task row room for a 44px "View" link, and floors the link in both directions', () => {
    renderWithLists()

    const view = document.querySelector('a[href="/tasks/task-1/edit"]') as HTMLElement
    expect(view).toHaveClass(...FLOOR, 'min-w-[var(--tap-min)]', 'items-center', 'justify-center', 'shrink-0', 'font-bold')
    // The row is h-10 on a mouse and grows to the floor on touch so the link fits it.
    expect(view.parentElement).toHaveClass('h-10', ...FLOOR)
  })

  it('never hard-codes 44px: every floor is the --tap-min token', () => {
    const { container } = renderWithLists()

    expect(container.innerHTML).not.toMatch(/(?:min-h|min-w|h|w)-\[44px\]/)
  })
})

// A trip status and a task priority are coloured one way everywhere: the dashboard's chips take StatusBadge's tones (lib/tone.ts),
// not a map of their own (it had no entry for Cancelled or Archived, which fell to grey, and read Urgent as Medium).
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
  const task = (priority: string) => ({
    id: `task-${priority}`, title: `Task ${priority}`, priority, dueDate: new Date(Date.now() - 3600000).toISOString(), tripName: 'Beach Trip', ownerName: 'Sam Owner',
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

  it.each([
    ['Urgent', 'danger'],
    ['High', 'danger'],
    ['Medium', 'warning'],
    ['Low', 'info'],
  ] as const)('colours a %s priority with the %s tone and keeps the uppercase chip shape', (priority, tone) => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUseDashboard.mockReturnValue(dashboardWith({ overdueTaskCount: 1, overdueTasks: [task(priority)] }))
    renderPage()

    const chip = screen.getByText(priority)
    expect(chip).toHaveClass('rounded-full', 'text-xs', 'font-bold', 'uppercase', 'tracking-widest', 'shrink-0', ...TONE[tone].solid.split(' '))
  })

  it('reads a task with no priority as Medium (warning), as before', () => {
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUseDashboard.mockReturnValue(dashboardWith({ overdueTaskCount: 1, overdueTasks: [{ ...task('Medium'), priority: null }] }))
    renderPage()

    expect(screen.getByText('Medium')).toHaveClass(...TONE.warning.solid.split(' '))
  })
})

describe('DashboardPage — due dates and participant ratios', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // A task's due date is a calendar day (DateOnly): it counts calendar days, not hours from UTC midnight, which read "17h ago" for yesterday.
  it('reads a due date as calendar days ago, in the compact form', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 1, 3, 40)) // 1 Oct 2026 on the wall clock, whatever the zone
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUseDashboard.mockReturnValue(summaryData({
      overdueTaskCount: 3,
      overdueTasks: [
        { id: 'k1', title: 'Yesterday task', priority: 'High', dueDate: '2026-09-30', ownerName: 'Sam Owner' },
        { id: 'k2', title: 'Last week task', priority: 'High', dueDate: '2026-09-24', ownerName: 'Sam Owner' },
        { id: 'k3', title: 'Last month task', priority: 'High', dueDate: '2026-08-31', ownerName: 'Sam Owner' },
      ],
    }))
    renderPage()

    expect(screen.getByText('Due 1d ago')).toBeInTheDocument()
    expect(screen.getByText('Due 7d ago')).toBeInTheDocument()
    expect(screen.getByText('Due 31d ago')).toBeInTheDocument()
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
