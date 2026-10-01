import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from './DashboardPage'
import { TONE } from '@/lib/tone'

const { mockUseParticipantAlertsAggregate, mockUseDashboard, mockUsePendingLeaveCount, mockUseStaff } = vi.hoisted(() => ({
  mockUseParticipantAlertsAggregate: vi.fn(),
  mockUseDashboard: vi.fn(),
  mockUsePendingLeaveCount: vi.fn(),
  mockUseStaff: vi.fn(),
}))

// Only the API layer needs mocking — the rest of DashboardPage's rendering (trips/tasks lists)
// falls back to its own built-in empty defaults when useDashboard returns no data.
vi.mock('@/api/hooks', () => ({
  useDashboard: mockUseDashboard,
  useSettings: () => ({ data: undefined }),
  useStaff: mockUseStaff,
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
  mockUseStaff.mockReturnValue({ data: [] })
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

  it('keeps the link text sizes: text-xs for the two panels, text-sm for the alerts heading row', () => {
    renderWithLists()

    const [trips, tasks, alerts] = screen.getAllByRole('link', { name: 'View All' })
    expect(trips).toHaveClass('text-xs')
    expect(tasks).toHaveClass('text-xs')
    expect(alerts).toHaveClass('text-sm')
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

// ── Bolder dashboard: display-step title with a summary line, and the needs-attention band ──

const summaryData = (overrides: Record<string, unknown> = {}) => ({
  data: {
    upcomingTripCount: 0, activeParticipantCount: 0, outstandingTaskCount: 0,
    overdueTaskCount: 0, conflictCount: 0, tripsMissingAccommodation: 0,
    tripsMissingVehicles: 0, tripsMissingStaff: 0, openIncidentCount: 0,
    qscOverdueCount: 0, upcomingTrips: [], overdueTasks: [],
    ...overrides,
  },
  isLoading: false, isError: false,
})

const asRole = (role: string) => localStorage.setItem('odip_user', JSON.stringify({ role }))

const criticalAlertFor = (participantId: string, participantName: string) => ({
  participantId, participantName, isActive: true,
  alerts: [{ type: 'plan-expired', severity: 'Critical', message: 'NDIS plan end date has passed', deepLinkTab: 'details', linkTo: null }],
  criticalCount: 1, warningCount: 0, infoCount: 0,
})

// One staff member whose first-aid certificate expired long ago: exactly one qualification issue, whatever today is.
const staffWithOneIssue = { data: [{ isFirstAidQualified: true, firstAidExpiryDate: '2000-01-01' }] }

const band = () => screen.getByRole('region', { name: 'Needs attention' })
const bandGrid = () => band().firstElementChild as HTMLElement
const bandItems = () => [...bandGrid().children] as HTMLElement[]
const labelOf = (el: HTMLElement) => el.querySelector('span')!.textContent
const bandLabels = () => bandItems().map(labelOf)
const itemFor = (label: string) => bandItems().find((el) => labelOf(el) === label) as HTMLElement

const FULL_ORDER = [
  'Qualification Issues', 'Critical Participant Alerts', 'Overdue', 'Missing Accommodation',
  'Missing Vehicles', 'Missing Staff', 'Open Incidents', 'QSC Overdue', 'Pending Leave',
]

describe('DashboardPage — header (display title and summary line)', () => {
  it('titles the page at the display step and keeps it the one h1', () => {
    renderPage()

    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('Management Dashboard')
    // The display step (28px, Plus Jakarta Sans 800), not the default 20px page title.
    expect(h1s[0]).toHaveClass('text-display')
    expect(h1s[0]).not.toHaveClass('text-xl')
  })

  it('replaces the generic subtitle with one quiet line of the everyday counts, in the meta row, joined by middots', () => {
    mockUseDashboard.mockReturnValue(summaryData({ upcomingTripCount: 3, activeParticipantCount: 5, outstandingTaskCount: 4 }))
    renderPage()

    expect(screen.queryByText(/Centralized overview/)).not.toBeInTheDocument()
    const items = ['3 upcoming trips', '5 active participants', '4 outstanding tasks'].map((text) => screen.getByText(text))
    // Tabular figures, so the line does not jitter as the counts change.
    for (const item of items) expect(item).toHaveClass('tabular-nums')
    const row = items[0].parentElement!.parentElement as HTMLElement
    expect(row).toHaveTextContent('3 upcoming trips·5 active participants·4 outstanding tasks')
    // The meta row sits under the title, in the same header block.
    expect(row.parentElement).toHaveClass('text-[13px]', 'text-[var(--color-muted-foreground)]')
    expect(row.parentElement!.parentElement).toContainElement(screen.getByRole('heading', { level: 1 }))
  })

  it.each([
    [1, 1, 1, ['1 upcoming trip', '1 active participant', '1 outstanding task']],
    [0, 0, 0, ['0 upcoming trips', '0 active participants', '0 outstanding tasks']],
    [2, 12, 101, ['2 upcoming trips', '12 active participants', '101 outstanding tasks']],
  ])('agrees the noun with the count (%i, %i, %i)', (trips, participants, tasks, expected) => {
    mockUseDashboard.mockReturnValue(summaryData({ upcomingTripCount: trips, activeParticipantCount: participants, outstandingTaskCount: tasks }))
    renderPage()

    for (const text of expected) expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('no longer gives the everyday counts a tile each: they are context, not something to act on', () => {
    mockUseDashboard.mockReturnValue(summaryData({ upcomingTripCount: 3, activeParticipantCount: 5, outstandingTaskCount: 4 }))
    renderPage()

    // "Upcoming Trips" is now only the panel heading; the other two labels are gone.
    expect(screen.getAllByText('Upcoming Trips')).toHaveLength(1)
    expect(screen.queryByText('Active Participants')).not.toBeInTheDocument()
    expect(screen.queryByText('Outstanding Tasks')).not.toBeInTheDocument()
  })
})

describe('DashboardPage — loading and error keep their behaviour', () => {
  it('shows only the spinner while the summary loads: no title, no band', () => {
    mockUseDashboard.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    const { container } = renderPage()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument()
  })

  it('shows the failure message, not a band of zeros, when the summary fails', () => {
    mockUseDashboard.mockReturnValue({ data: undefined, isLoading: false, isError: true })
    renderPage()

    expect(screen.getByText('Failed to load dashboard. Please refresh the page.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument()
  })
})

describe('DashboardPage — needs-attention band: order and role gating', () => {
  it('is one named region holding every item in the fixed order for a Coordinator with leave waiting', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUsePendingLeaveCount.mockReturnValue(3)
    renderPage()

    expect(bandLabels()).toEqual(FULL_ORDER)
    // The band is the only region: one landmark, named by what it is for.
    expect(screen.getAllByRole('region')).toHaveLength(1)
  })

  it('keeps every item in its place at zero (only Pending Leave, which was never fixed, drops out)', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    expect(bandLabels()).toEqual(FULL_ORDER.filter((label) => label !== 'Pending Leave'))
    for (const item of bandItems()) expect(within(item).getByText('0')).toBeInTheDocument()
  })

  it('leaves out the alerts item and Pending Leave for a role without canViewAlerts / canApproveLeave, even with leave waiting', () => {
    asRole('SupportWorker')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUsePendingLeaveCount.mockReturnValue(3)
    renderPage()

    expect(bandLabels()).toEqual(
      FULL_ORDER.filter((label) => label !== 'Critical Participant Alerts' && label !== 'Pending Leave'),
    )
    expect(screen.queryByText('Critical Participant Alerts')).not.toBeInTheDocument()
    expect(screen.queryByText('Pending Leave')).not.toBeInTheDocument()
  })

  it('spells the accommodation item out (the KPI row abbreviated it to fit a 136px tile)', () => {
    renderPage()

    expect(screen.getByText('Missing Accommodation')).toBeInTheDocument()
    expect(screen.queryByText('Missing Accomm.')).not.toBeInTheDocument()
  })
})

describe('DashboardPage — needs-attention band: tint, zero and figures', () => {
  it('tints a non-zero item by its tone family and leaves a zero item quiet with a muted figure', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(staffWithOneIssue)
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [criticalAlertFor('p1', 'Jamie Smith')], isLoading: false })
    mockUsePendingLeaveCount.mockReturnValue(2)
    mockUseDashboard.mockReturnValue(summaryData({
      overdueTaskCount: 2, tripsMissingAccommodation: 1, tripsMissingVehicles: 0, tripsMissingStaff: 4, openIncidentCount: 3, qscOverdueCount: 1,
    }))
    renderPage()

    // danger -> the error container; warning -> the warning container (the trip glance strip's own tints).
    const danger = ['Qualification Issues', 'Critical Participant Alerts', 'Overdue', 'QSC Overdue']
    const warning = ['Missing Accommodation', 'Missing Staff', 'Open Incidents', 'Pending Leave']
    for (const label of danger) {
      expect(itemFor(label)).toHaveAttribute('data-attention', 'error')
      expect(itemFor(label)).toHaveClass('bg-[var(--color-error-container)]', 'text-[var(--color-on-error-container)]')
    }
    for (const label of warning) {
      expect(itemFor(label)).toHaveAttribute('data-attention', 'warning')
      expect(itemFor(label)).toHaveClass('bg-[var(--color-warning-container)]', 'text-[var(--color-on-warning-container)]')
    }
    // The one zero is untinted: card fill, muted figure and label.
    const zero = itemFor('Missing Vehicles')
    expect(zero).not.toHaveAttribute('data-attention')
    expect(zero).toHaveClass('bg-[var(--color-card)]', 'text-[var(--color-muted-foreground)]')
    expect(within(zero).getByText('0')).toBeInTheDocument()
    expect(itemFor('Overdue')).toHaveTextContent('2')
    expect(itemFor('Missing Staff')).toHaveTextContent('4')
  })

  it('tints nothing when every item is zero', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    for (const item of bandItems()) {
      expect(item).not.toHaveAttribute('data-attention')
      expect(item).toHaveClass('bg-[var(--color-card)]')
    }
    expect(band().innerHTML).not.toMatch(/-container\)\]/)
  })

  it('sets every figure at the display step, in tabular figures', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    const figures = bandItems().map((item) => item.querySelector('.text-display'))
    expect(figures.every((figure) => figure !== null)).toBe(true)
    for (const figure of figures) expect(figure).toHaveClass('tabular-nums')
  })

  it('carries the same numbers as before: each figure is the count its KPI tile showed', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUseDashboard.mockReturnValue(summaryData({
      overdueTaskCount: 7, tripsMissingAccommodation: 6, tripsMissingVehicles: 5, tripsMissingStaff: 4, openIncidentCount: 3, qscOverdueCount: 2,
    }))
    renderPage()

    const figures = Object.fromEntries(bandItems().map((item) => [labelOf(item), item.querySelector('.text-display')!.textContent]))
    expect(figures).toMatchObject({
      Overdue: '7', 'Missing Accommodation': '6', 'Missing Vehicles': '5', 'Missing Staff': '4', 'Open Incidents': '3', 'QSC Overdue': '2',
    })
  })
})

describe('DashboardPage — needs-attention band: All clear and loading', () => {
  it('says "All clear" on Qualification Issues and Critical Participant Alerts at zero, as the lime positive chip, and nowhere else', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    const clear = screen.getAllByText('All clear')
    expect(clear).toHaveLength(2)
    for (const chip of clear) expect(chip).toHaveClass('rounded-full', 'bg-[var(--color-primary-fixed)]')
    expect(within(itemFor('Qualification Issues')).getByText('All clear')).toBeInTheDocument()
    expect(within(itemFor('Critical Participant Alerts')).getByText('All clear')).toBeInTheDocument()
  })

  it('drops "All clear" once an item is non-zero', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(staffWithOneIssue)
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [criticalAlertFor('p1', 'Jamie Smith')], isLoading: false })
    renderPage()

    expect(screen.queryByText('All clear')).not.toBeInTheDocument()
  })

  it('shows an en dash, not a definite 0, while the alerts request is in flight: busy, untinted, no "All clear"', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: undefined, isLoading: true })
    renderPage()

    const item = itemFor('Critical Participant Alerts')
    expect(item).toHaveAttribute('aria-busy', 'true')
    expect(item).not.toHaveAttribute('data-attention')
    expect(within(item).getByText('–')).toHaveClass('text-display', 'tabular-nums')
    expect(within(item).queryByText('0')).not.toBeInTheDocument()
    expect(within(item).queryByText('All clear')).not.toBeInTheDocument()
    expect(item).toHaveClass('bg-[var(--color-card)]', 'text-[var(--color-muted-foreground)]')
    // Qualification Issues keeps its own zero state ("All clear" from the staff list), so exactly one remains.
    expect(screen.getAllByText('All clear')).toHaveLength(1)
    expect(within(itemFor('Qualification Issues')).getByText('All clear')).toBeInTheDocument()
    // Nothing else in the band is busy.
    expect(bandItems().filter((el) => el.getAttribute('aria-busy') === 'true')).toEqual([item])
  })

  it('settles when the alerts arrive: zero becomes a quiet 0 with "All clear", non-zero becomes the danger treatment', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: undefined, isLoading: true })
    const { rerender } = renderPage()
    expect(itemFor('Critical Participant Alerts')).toHaveAttribute('aria-busy', 'true')

    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    rerender(<MemoryRouter><DashboardPage /></MemoryRouter>)
    let item = itemFor('Critical Participant Alerts')
    expect(item).not.toHaveAttribute('aria-busy')
    expect(within(item).getByText('0')).toBeInTheDocument()
    expect(within(item).getByText('All clear')).toBeInTheDocument()
    expect(item).not.toHaveAttribute('data-attention')

    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [criticalAlertFor('p1', 'Jamie Smith')], isLoading: false })
    rerender(<MemoryRouter><DashboardPage /></MemoryRouter>)
    item = itemFor('Critical Participant Alerts')
    expect(item).not.toHaveAttribute('aria-busy')
    expect(item).toHaveAttribute('data-attention', 'error')
    expect(within(item).getByText('1')).toBeInTheDocument()
    expect(within(item).queryByText('All clear')).not.toBeInTheDocument()
  })

  it('never shows the loading placeholder to a role that cannot view alerts (the item, and the request, do not exist)', () => {
    asRole('SupportWorker')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: undefined, isLoading: false })
    renderPage()

    expect(screen.queryByText('–')).not.toBeInTheDocument()
    expect(band().querySelector('[aria-busy]')).toBeNull()
  })
})

describe('DashboardPage — needs-attention band: no "All clear" without data', () => {
  const qualification = () => itemFor('Qualification Issues')
  const alerts = () => itemFor('Critical Participant Alerts')
  const inFlight = { data: undefined, isLoading: true, isError: false }
  const failed = { data: undefined, isLoading: false, isError: true }

  // The shared contract of a placeholder: an en dash where the number would be, not tinted, no caption, no number.
  const expectPlaceholder = (item: HTMLElement, { busy, say }: { busy: boolean; say: string }) => {
    expect(within(item).getByText('\u2013')).toHaveClass('text-display', 'tabular-nums')
    expect(within(item).getByText(say)).toHaveClass('sr-only')
    if (busy) expect(item).toHaveAttribute('aria-busy', 'true')
    else expect(item).not.toHaveAttribute('aria-busy')
    expect(item).not.toHaveAttribute('data-attention')
    expect(item).toHaveClass('bg-[var(--color-card)]', 'text-[var(--color-muted-foreground)]')
    expect(within(item).queryByText('0')).not.toBeInTheDocument()
    expect(within(item).queryByText('All clear')).not.toBeInTheDocument()
  }

  it('shows an en dash on Qualification Issues while the staff list loads: busy, untinted, no "All clear"', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(inFlight)
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    expectPlaceholder(qualification(), { busy: true, say: 'Loading' })
    expect(within(band()).getByRole('link', { name: 'Qualification Issues Loading' })).toHaveAttribute('href', '/qualifications')
    // The alerts item HAS its data (none), so it keeps its own "All clear": exactly one remains.
    expect(screen.getAllByText('All clear')).toHaveLength(1)
    expect(within(alerts()).getByText('All clear')).toBeInTheDocument()
  })

  it('shows an en dash and "Couldn\'t load" on Qualification Issues when the staff request fails: not busy, no "All clear"', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(failed)
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    expectPlaceholder(qualification(), { busy: false, say: "Couldn't load" })
    expect(within(band()).getByRole('link', { name: "Qualification Issues Couldn't load" })).toHaveAttribute('href', '/qualifications')
    expect(screen.getAllByText('All clear')).toHaveLength(1)
    expect(within(alerts()).getByText('All clear')).toBeInTheDocument()
  })

  it('shows an en dash and "Couldn\'t load" on Critical Participant Alerts when the alerts request fails: not busy, no "All clear"', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue(failed)
    renderPage()

    expectPlaceholder(alerts(), { busy: false, say: "Couldn't load" })
    expect(within(band()).getByRole('link', { name: "Critical Participant Alerts Couldn't load" })).toHaveAttribute('href', '/participants')
    // Qualification Issues has its data (no issues), so it keeps its own "All clear": exactly one remains.
    expect(screen.getAllByText('All clear')).toHaveLength(1)
    expect(within(qualification()).getByText('All clear')).toBeInTheDocument()
    // No participant alerts section is invented from a failed request.
    expect(screen.getAllByText('Critical Participant Alerts')).toHaveLength(1)
  })

  it('claims "All clear" nowhere while both requests are in flight', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(inFlight)
    mockUseParticipantAlertsAggregate.mockReturnValue(inFlight)
    renderPage()

    expect(screen.queryByText('All clear')).not.toBeInTheDocument()
    expectPlaceholder(qualification(), { busy: true, say: 'Loading' })
    expectPlaceholder(alerts(), { busy: true, say: 'Loading' })
    expect(bandItems().filter((el) => el.getAttribute('aria-busy') === 'true')).toHaveLength(2)
  })

  it('claims "All clear" nowhere while both requests have failed, and says so twice', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(failed)
    mockUseParticipantAlertsAggregate.mockReturnValue(failed)
    renderPage()

    expect(screen.queryByText('All clear')).not.toBeInTheDocument()
    expect(screen.getAllByText("Couldn't load")).toHaveLength(2)
    expectPlaceholder(qualification(), { busy: false, say: "Couldn't load" })
    expectPlaceholder(alerts(), { busy: false, say: "Couldn't load" })
  })

  it('treats a failed request as a placeholder even when rows are still cached, so a stale count is never tinted', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue({ ...staffWithOneIssue, isLoading: false, isError: true })
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [criticalAlertFor('p1', 'Jamie Smith')], isLoading: false, isError: true })
    renderPage()

    expectPlaceholder(qualification(), { busy: false, say: "Couldn't load" })
    expectPlaceholder(alerts(), { busy: false, say: "Couldn't load" })
  })

  it('still fails honestly for a role without alerts: the staff item is the only placeholder', () => {
    asRole('SupportWorker')
    mockUseStaff.mockReturnValue(failed)
    renderPage()

    expectPlaceholder(qualification(), { busy: false, say: "Couldn't load" })
    expect(screen.getAllByText("Couldn't load")).toHaveLength(1)
    expect(screen.queryByText('All clear')).not.toBeInTheDocument()
  })

  it('settles from each placeholder: a zero becomes a quiet 0 with "All clear", a count becomes the danger treatment', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(failed)
    mockUseParticipantAlertsAggregate.mockReturnValue(inFlight)
    const { rerender } = renderPage()
    expectPlaceholder(qualification(), { busy: false, say: "Couldn't load" })
    expectPlaceholder(alerts(), { busy: true, say: 'Loading' })

    // The staff retry succeeds with nobody expiring; the alerts arrive with one Critical alert.
    mockUseStaff.mockReturnValue({ data: [], isLoading: false, isError: false })
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [criticalAlertFor('p1', 'Jamie Smith')], isLoading: false, isError: false })
    rerender(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(qualification()).not.toHaveAttribute('data-attention')
    expect(within(qualification()).getByText('0')).toBeInTheDocument()
    expect(within(qualification()).getByText('All clear')).toBeInTheDocument()
    expect(alerts()).toHaveAttribute('data-attention', 'error')
    expect(within(alerts()).getByText('1')).toBeInTheDocument()
    expect(within(band()).queryByText("Couldn't load")).not.toBeInTheDocument()

    // Later the staff list is refreshed with an expiring credential: the item is loud, not "All clear".
    mockUseStaff.mockReturnValue({ ...staffWithOneIssue, isLoading: false, isError: false })
    rerender(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(qualification()).toHaveAttribute('data-attention', 'error')
    expect(within(qualification()).getByText('1')).toBeInTheDocument()
    expect(within(qualification()).queryByText('All clear')).not.toBeInTheDocument()
  })
})

describe('DashboardPage — needs-attention band: links and accessible names', () => {
  it('links Qualification Issues, Critical Participant Alerts, Overdue and Pending Leave, and only those', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUsePendingLeaveCount.mockReturnValue(3)
    renderPage()

    const links = within(band()).getAllByRole('link')
    expect(links.map((a) => [labelOf(a), a.getAttribute('href')])).toEqual([
      ['Qualification Issues', '/qualifications'],
      ['Critical Participant Alerts', '/participants'],
      ['Overdue', '/tasks?status=Overdue'],
      ['Pending Leave', '/rostering/leave'],
    ])
  })

  it('links only Qualification Issues and Overdue for a role without alerts or leave', () => {
    asRole('SupportWorker')
    renderPage()

    expect(within(band()).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/qualifications', '/tasks?status=Overdue'])
  })

  it('gives every item an accessible name that includes its number and its label', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(staffWithOneIssue)
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUsePendingLeaveCount.mockReturnValue(3)
    mockUseDashboard.mockReturnValue(summaryData({ overdueTaskCount: 2, tripsMissingStaff: 4 }))
    renderPage()

    const inBand = within(band())
    // The caption says how many staff the issues belong to, so 12 reads against the Qualifications page's "All Issues (4)".
    expect(inBand.getByRole('link', { name: 'Qualification Issues 1 1 staff member' })).toHaveAttribute('href', '/qualifications')
    expect(inBand.getByRole('link', { name: 'Critical Participant Alerts 0 All clear' })).toHaveAttribute('href', '/participants')
    expect(inBand.getByRole('link', { name: 'Overdue 2' })).toHaveAttribute('href', '/tasks?status=Overdue')
    expect(inBand.getByRole('group', { name: 'Missing Accommodation 0' })).toBeInTheDocument()
    expect(inBand.getByRole('group', { name: 'Missing Staff 4' })).toBeInTheDocument()
    expect(inBand.getByRole('group', { name: 'QSC Overdue 0' })).toBeInTheDocument()
    expect(inBand.getByRole('link', { name: 'Pending Leave 3' })).toHaveAttribute('href', '/rostering/leave')
    // Every item is either a link or a named group: nothing is left unnamed, and nothing relies on colour alone.
    expect(inBand.getAllByRole('group')).toHaveLength(5)
    expect(inBand.getAllByRole('link')).toHaveLength(4)
  })

  it('floors every linked item at --tap-min so it keeps a 44px hit area on touch', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUsePendingLeaveCount.mockReturnValue(1)
    renderPage()

    for (const link of within(band()).getAllByRole('link')) expect(link).toHaveClass('min-h-[var(--tap-min)]')
  })
})

// jsdom has no layout, so the responsive contract is pinned as classes: two columns below md, two balanced rows from md, and
// ONE row once the band's own width (a container query, so the sidebar does not matter) gives every item 173px, what the widest
// label needs on one line ("Critical Participant Alerts", 152.6px, plus the 8px sides and 1px borders): n x 173 + (n - 1) x 8 =
// 1259 / 1440 / 1621px for 7 / 8 / 9 items.
describe('DashboardPage — needs-attention band: responsive shape', () => {
  it('is a size container with two columns by default', () => {
    renderPage()

    expect(band()).toHaveClass('@container')
    expect(bandGrid()).toHaveClass('grid', 'grid-cols-2', 'gap-2')
    // No auto-fit: rows are balanced by count, not filled greedily.
    expect(bandGrid().className).not.toMatch(/auto-fit|minmax/)
  })

  it('shapes 7 items (no alerts, no leave) as 4 + 3 and one row from 1259px, the odd last item taking the spare slot', () => {
    asRole('SupportWorker')
    renderPage()

    expect(bandItems()).toHaveLength(7)
    expect(bandGrid()).toHaveClass('md:grid-cols-4', '@min-[1259px]:grid-cols-7')
    const last = bandItems()[6]
    expect(last).toHaveClass('col-span-2', '@min-[1259px]:col-span-1')
    for (const item of bandItems().slice(0, 6)) expect(item.className).not.toMatch(/col-span/)
  })

  it('shapes 8 items (alerts, no leave) as 4 + 4 and one row from 1440px, with nothing to stretch', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    expect(bandItems()).toHaveLength(8)
    expect(bandGrid()).toHaveClass('md:grid-cols-4', '@min-[1440px]:grid-cols-8')
    for (const item of bandItems()) expect(item.className).not.toMatch(/col-span/)
  })

  it('shapes 9 items (alerts and leave) as 5 + 4 and one row from 1621px, the odd last item taking the spare slot', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUsePendingLeaveCount.mockReturnValue(2)
    renderPage()

    expect(bandItems()).toHaveLength(9)
    expect(bandGrid()).toHaveClass('md:grid-cols-5', '@min-[1621px]:grid-cols-9')
    expect(bandItems()[8]).toHaveClass('col-span-2', '@min-[1621px]:col-span-1')
    // Whole items: nothing truncates or scrolls sideways.
    expect(bandGrid().className).not.toMatch(/overflow|truncate/)
  })

  it('keeps the band a peak in the page: it sits between the header and the panels', () => {
    renderPage()

    const page = band().parentElement as HTMLElement
    const children = [...page.children]
    expect(children.indexOf(band())).toBe(1)
    expect(children[0]).toContainElement(screen.getByRole('heading', { level: 1 }))
    expect(children[2].className).toMatch(/xl:grid-cols-2/)
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
    ['InProgress', 'accessible'],
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
