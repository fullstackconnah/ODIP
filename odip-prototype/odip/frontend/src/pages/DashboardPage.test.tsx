import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from './DashboardPage'
import { BAND_GRID_CLASS, BAND_SPAN_CLASS, bandSpans } from './dashboard/bandLayout'
import { TONE } from '@/lib/tone'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUseParticipantAlertsAggregate, mockUseDashboard, mockUsePendingLeaveQueue, mockUsePendingCompletionQueue, mockUseStaff, mockUseSettings } = vi.hoisted(() => ({
  mockUseParticipantAlertsAggregate: vi.fn(),
  mockUsePendingCompletionQueue: vi.fn(),
  mockUseSettings: vi.fn(),
  mockUseDashboard: vi.fn(),
  mockUsePendingLeaveQueue: vi.fn(),
  mockUseStaff: vi.fn(),
}))

// Only the API layer needs mocking — the rest of DashboardPage's rendering (trips/tasks lists)
// falls back to its own built-in empty defaults when useDashboard returns no data.
vi.mock('@/api/hooks', () => ({
  useDashboard: mockUseDashboard,
  useSettings: mockUseSettings,
  useStaff: mockUseStaff,
  useParticipantAlertsAggregate: mockUseParticipantAlertsAggregate,
  usePendingLeaveQueue: mockUsePendingLeaveQueue,
  usePendingCompletionQueue: mockUsePendingCompletionQueue,
}))

// The pending leave queue as the page reads it: the count, and whether that count can be trusted yet (it is 0 while loading, and after a failure).
const pendingLeave = (count: number, o: { loading?: boolean; error?: boolean } = {}) => ({ count, loading: false, error: false, ...o })
// The shift completions awaiting review, read the same way (the nav badge on Staff & roster adds this queue to the leave queue).
const pendingCompletions = pendingLeave

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
  mockUseDashboard.mockReturnValue(summaryData())
  mockUseSettings.mockReturnValue({ data: undefined })
  mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
  mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(0))
  mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(0))
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

  it('has no tile and no list section when there are no Critical alerts: the band names the item among the clear ones', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    // The list section is omitted entirely when empty, and a zero is not a tile.
    expect(screen.queryByRole('heading', { name: 'Critical Participant Alerts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /Critical Participant Alerts/ })).not.toBeInTheDocument()
    expect(screen.getByText(/^Checked and at zero:.*Critical Participant Alerts/)).toBeInTheDocument()
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
    expect(row).toHaveTextContent('Qualification Issues')
    expect(row).not.toHaveTextContent('Critical Participant Alerts')
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })
})

describe('DashboardPage — Pending Leave card (I-6)', () => {
  it('links to the leave approvals queue with the pending count for a Coordinator', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(3))
    renderPage()

    const tile = screen.getByRole('group', { name: 'Pending Leave 3' })
    expect(within(tile).getByRole('link', { name: 'Review leave requests' })).toHaveAttribute('href', '/rostering/leave')
    expect(within(tile).getByText('3')).toBeInTheDocument()
  })

  it('is no tile when there are no pending leave requests: the band names it among the items that are clear', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(0))
    renderPage()

    expect(screen.queryByRole('group', { name: /Pending Leave/ })).not.toBeInTheDocument()
    expect(screen.getByText(/^Checked and at zero:.*Pending Leave/)).toBeInTheDocument()
  })

  it('does not call the queue clear while it is still loading, or after it failed (its count is 0 in both)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })

    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(0, { loading: true }))
    const { unmount } = renderPage()
    expect(screen.getByRole('link', { name: 'Pending Leave Loading' })).toHaveAttribute('href', '/rostering/leave')
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
    expect(screen.getByText('All clear', { selector: 'span.font-semibold' }).closest('p')).not.toHaveTextContent('Pending Leave')
    unmount()

    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(0, { error: true }))
    renderPage()
    expect(screen.getByRole('link', { name: "Pending Leave Couldn't load" })).toHaveAttribute('href', '/rostering/leave')
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it('is hidden for a SupportWorker (matches the backend Admin/Coordinator/SuperAdmin gate)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(3))
    renderPage()

    expect(screen.queryByText(/Pending Leave/)).not.toBeInTheDocument()
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

// ── Bolder dashboard: a greeting and the date as the title, and the needs-attention band as the peak ──

const summaryData = (overrides: Record<string, unknown> = {}) => ({
  data: {
    upcomingTripCount: 0, activeParticipantCount: 0, outstandingTaskCount: 0,
    overdueTaskCount: 0, conflictCount: 0, tripsMissingAccommodation: 0,
    tripsMissingVehicles: 0, tripsMissingStaff: 0, openIncidentCount: 0,
    qscOverdueCount: 0, upcomingTrips: [], overdueTasks: [],
    ...overrides,
  },
  isPending: false, isLoading: false, isError: false,
})

const asRole = (role: string, fullName?: string) => localStorage.setItem('odip_user', JSON.stringify(fullName ? { role, fullName } : { role }))

const criticalAlertFor = (participantId: string, participantName: string) => ({
  participantId, participantName, isActive: true,
  alerts: [{ type: 'plan-expired', severity: 'Critical', message: 'NDIS plan end date has passed', deepLinkTab: 'details', linkTo: null }],
  criticalCount: 1, warningCount: 0, infoCount: 0,
})

// One staff member whose first-aid certificate expired long ago: exactly one qualification issue, whatever today is.
const staffWithOneIssue = { data: [{ isFirstAidQualified: true, firstAidExpiryDate: '2000-01-01' }] }

// Two staff and three issues: the first one's First Aid has expired and his Driver Licence is flagged with no date; the second one's First Aid has expired too.
const staffWithThreeIssues = {
  data: [
    { isFirstAidQualified: true, firstAidExpiryDate: '2000-01-01', isDriverEligible: true, driverLicenceExpiryDate: null },
    { isFirstAidQualified: true, firstAidExpiryDate: '2000-01-01' },
  ],
}

// Three Critical alerts on two participants: the tile counts alerts (3), the Participants table shows one flagged row per participant (2).
const threeAlertsOnTwoParticipants = {
  data: [
    {
      participantId: 'p1', participantName: 'Jamie Smith', isActive: true, criticalCount: 2, warningCount: 0, infoCount: 0,
      alerts: [
        { type: 'plan-expired', severity: 'Critical', message: 'NDIS plan end date has passed', deepLinkTab: 'details', linkTo: null },
        { type: 'qsc-report-overdue', severity: 'Critical', message: 'QSC report has not been submitted', deepLinkTab: 'details', linkTo: '/incidents/i1' },
      ],
    },
    criticalAlertFor('p2', 'Alex Rivera'),
  ],
  isLoading: false,
}

const band = () => screen.getByRole('region', { name: 'Needs attention' })
const grid = () => band().querySelector('div.grid') as HTMLElement
// The band's tiles, in order: each grid cell holds one tile, a named group or (a placeholder that has a page to go to) a link.
const tiles = () => [...grid().children].map((cell) => cell.firstElementChild as HTMLElement)
const labelOf = (tile: HTMLElement) => tile.querySelector('span:not(.text-display)')!.textContent
const tileLabels = () => tiles().map(labelOf)
const tileFor = (label: string) => tiles().find((tile) => labelOf(tile) === label) as HTMLElement
const clearRow = () => screen.queryByText('All clear', { selector: 'span.font-semibold' })?.closest('p') ?? null

const FULL_ORDER = [
  'Qualification Issues', 'Critical Participant Alerts', 'Overdue', 'Missing Accommodation',
  'Missing Vehicles', 'Missing Staff', 'Open Incidents', 'QSC Overdue', 'Pending Leave', 'Shift Completions',
]

// Every item above zero, for a Coordinator: all ten are tiles, each with the count 3 (the staff list and the alerts give 3 issues and 3 alerts).
function showAll() {
  asRole('Coordinator')
  mockUseStaff.mockReturnValue(staffWithThreeIssues)
  mockUseParticipantAlertsAggregate.mockReturnValue(threeAlertsOnTwoParticipants)
  mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(3))
  mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(3))
  mockUseDashboard.mockReturnValue(summaryData({
    overdueTaskCount: 3, tripsMissingAccommodation: 3, tripsMissingVehicles: 3, tripsMissingStaff: 3, openIncidentCount: 3, qscOverdueCount: 3,
  }))
}

describe('DashboardPage — header (a greeting, the date and the summary line)', () => {
  // Pins "now" without stopping the timers (the clock is the only thing these tests move).
  const pinTo = (when: Date) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(when)
  }
  const heading = () => screen.getByRole('heading', { level: 1 })

  afterEach(() => {
    vi.useRealTimers()
    restoreZone()
    document.title = ''
  })

  it('greets the signed-in user by first name and time of day with today\'s date after it, all in the one h1 at the display step', () => {
    pinTo(new Date(2026, 9, 2, 9, 30))
    asRole('Coordinator', 'Sarah Mitchell')
    renderPage()

    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('Good morning, Sarah Friday 2 October')
    // The display step (28px, Plus Jakarta Sans 800), not the default 20px page title.
    expect(h1s[0]).toHaveClass('text-display')
    expect(h1s[0]).not.toHaveClass('text-xl')
    // The old title is gone from the page; it names the tab instead.
    expect(screen.queryByText('Management Dashboard')).not.toBeInTheDocument()
  })

  it.each([
    [0, 5, 'Good morning'],
    [11, 59, 'Good morning'],
    [12, 0, 'Good afternoon'],
    [17, 59, 'Good afternoon'],
    [18, 0, 'Good evening'],
    [23, 59, 'Good evening'],
  ])('says "%s:%s" is "%s"', (hour, minute, expected) => {
    pinTo(new Date(2026, 9, 2, hour, minute))
    asRole('Coordinator', 'Sarah Mitchell')
    renderPage()

    expect(heading()).toHaveTextContent(`${expected}, Sarah`)
  })

  it('uses the first name only: the rest of the full name is not in the heading', () => {
    pinTo(new Date(2026, 9, 2, 14, 0))
    asRole('Admin', 'Callum Radford')
    renderPage()

    expect(heading()).toHaveTextContent('Good afternoon, Callum Friday 2 October')
    expect(heading()).not.toHaveTextContent('Radford')
  })

  it('greets without a comma or an invented name when the sign-in carries none', () => {
    pinTo(new Date(2026, 9, 2, 9, 30))
    asRole('Coordinator')
    renderPage()

    expect(heading()).toHaveTextContent('Good morning Friday 2 October')
    expect(heading().textContent).not.toMatch(/,/)
  })

  // 2026-10-01 23:30 UTC is Friday 9:30 am in Sydney (UTC+10) and still Thursday evening in UTC: the heading follows the wall clock the viewer is looking at,
  // the greeting and the date together, never the UTC date (still yesterday until 10:00 or 11:00 in Sydney).
  it('reads the greeting and the date from the viewer\'s wall clock, never the UTC date', () => {
    pinTo(new Date('2026-10-01T23:30:00Z'))
    asRole('Coordinator', 'Sarah Mitchell')

    if (!setZone('Australia/Sydney')) return // this runtime cannot switch zones
    const sydney = renderPage()
    expect(heading()).toHaveTextContent('Good morning, Sarah Friday 2 October')
    expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-10-02')
    sydney.unmount()

    setZone('UTC')
    renderPage()
    expect(heading()).toHaveTextContent('Good evening, Sarah Thursday 1 October')
    expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-10-01')
  })

  it('holds the date across the Sydney clock change (Sunday 4 October, 02:00 becomes 03:00)', () => {
    if (!setZone('Australia/Sydney')) return
    asRole('Coordinator', 'Sarah Mitchell')

    pinTo(new Date('2026-10-03T15:59:00Z')) // 01:59 AEST
    const before = renderPage()
    expect(heading()).toHaveTextContent('Good morning, Sarah Sunday 4 October')
    before.unmount()

    pinTo(new Date('2026-10-03T16:30:00Z')) // 03:30 AEDT, the same morning
    renderPage()
    expect(heading()).toHaveTextContent('Good morning, Sarah Sunday 4 October')
  })

  it('sets the date in a time element in the muted ink at the same size, after the greeting', () => {
    pinTo(new Date(2026, 9, 2, 9, 30))
    asRole('Coordinator', 'Sarah Mitchell')
    renderPage()

    const time = document.querySelector('time') as HTMLElement
    expect(time).toHaveTextContent('Friday 2 October')
    expect(time).toHaveAttribute('datetime', '2026-10-02')
    expect(heading()).toContainElement(time)
    expect(time.parentElement).toHaveClass('text-[var(--color-muted-foreground)]')
    expect(time.parentElement!.className).not.toMatch(/\btext-(?:xs|sm|base|lg|xl|[2-9]xl|display)\b/)
    expect(screen.getByText('Good morning, Sarah').compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the tab named "Management Dashboard" while the heading is the greeting', () => {
    pinTo(new Date(2026, 9, 2, 9, 30))
    asRole('Coordinator', 'Sarah Mitchell')
    renderPage()

    expect(document.title).toBe('Management Dashboard — Odip')
    expect(heading()).toHaveTextContent('Good morning, Sarah')
  })

  it('moves on with the clock: a page left open since the morning says good afternoon without a reload, and the tab name does not move', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 2, 11, 59, 30))
    asRole('Coordinator', 'Sarah Mitchell')
    renderPage()
    expect(heading()).toHaveTextContent('Good morning, Sarah Friday 2 October')

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(heading()).toHaveTextContent('Good afternoon, Sarah Friday 2 October')
    expect(document.title).toBe('Management Dashboard — Odip')

    act(() => {
      vi.advanceTimersByTime(12 * 60 * 60_000) // past midnight
    })
    expect(heading()).toHaveTextContent('Good morning, Sarah Saturday 3 October')
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
    mockUseDashboard.mockReturnValue({ data: undefined, isPending: true, isLoading: true, isError: false })
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

// TanStack Query PAUSES a request while the browser reports offline: the query is pending with a fetchStatus of "paused" and isLoading is false. The real hooks are
// exercised in DashboardPage.offline.test.tsx; here the page is given exactly what they return in that state.
describe('DashboardPage — a paused request is waiting, not a settled zero', () => {
  const paused = { data: undefined, isPending: true, isLoading: false, isError: false, fetchStatus: 'paused' }
  const disabled = { data: undefined, isPending: true, isLoading: false, isError: false, fetchStatus: 'idle' }

  it('shows the spinner, and no band and no zeros, while the summary is paused', () => {
    mockUseDashboard.mockReturnValue(paused)
    const { container } = renderPage()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument()
    expect(screen.queryByText(/All clear/)).not.toBeInTheDocument()
  })

  it('shows the spinner, not a made-up summary of zeros, for a result that has no data and no reason', () => {
    mockUseDashboard.mockReturnValue({ data: undefined, isPending: false, isLoading: false, isError: false })
    const { container } = renderPage()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument()
  })

  it('shows an en dash, busy, on Qualification Issues and Critical Participant Alerts while their requests are paused, and never names them clear', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(paused)
    mockUseParticipantAlertsAggregate.mockReturnValue(paused)
    renderPage()

    for (const label of ['Qualification Issues', 'Critical Participant Alerts']) {
      const tile = tileFor(label)
      expect(tile, label).toHaveAttribute('aria-busy', 'true')
      expect(tile, label).not.toHaveAttribute('data-attention')
      expect(within(tile).getByText('–'), label).toBeInTheDocument()
      expect(within(tile).getByText('Loading'), label).toHaveClass('sr-only')
    }
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
    expect(clearRow()).not.toHaveTextContent('Qualification Issues')
    expect(clearRow()).not.toHaveTextContent('Critical Participant Alerts')
  })

  it('does not call a DISABLED query waiting: nobody asked it, so the role that cannot view alerts sees no placeholder', () => {
    asRole('ReadOnly')
    mockUseParticipantAlertsAggregate.mockReturnValue(disabled)
    renderPage()

    expect(screen.queryByText('–')).not.toBeInTheDocument()
    expect(band().querySelector('[aria-busy]')).toBeNull()
  })

  it('keeps a failed request a failure, whatever else is true of it', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue({ data: undefined, isPending: false, isLoading: false, isError: true, fetchStatus: 'idle' })
    renderPage()

    expect(tileFor('Qualification Issues')).not.toHaveAttribute('aria-busy')
    expect(within(tileFor('Qualification Issues')).getByText("Couldn't load")).toBeInTheDocument()
  })
})

describe('DashboardPage — needs-attention band: a tile for what needs you', () => {
  it('holds every item in its fixed order for a Coordinator with all ten above zero: one named region', () => {
    showAll()
    renderPage()

    expect(tileLabels()).toEqual(FULL_ORDER)
    // The band is the only region: one landmark, named by what it is for.
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(clearRow()).toBeNull()
  })

  it('makes a tile of each item above zero, in that order, and of nothing else: the zero is named in the All clear row instead', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(staffWithOneIssue)
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [criticalAlertFor('p1', 'Jamie Smith')], isLoading: false })
    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(2))
    mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(1))
    mockUseDashboard.mockReturnValue(summaryData({
      overdueTaskCount: 2, tripsMissingAccommodation: 1, tripsMissingVehicles: 0, tripsMissingStaff: 4, openIncidentCount: 3, qscOverdueCount: 1,
    }))
    renderPage()

    expect(tileLabels()).toEqual(FULL_ORDER.filter((label) => label !== 'Missing Vehicles'))
    expect(screen.queryByRole('group', { name: /Missing Vehicles/ })).not.toBeInTheDocument()
    expect(clearRow()).toHaveTextContent('All clear on Missing Vehicles')
  })

  it('leaves out the alerts item, Pending Leave, Shift Completions and Qualification Issues for a role without canViewAlerts / canApproveLeave / canReviewCompletions / the Qualifications page', () => {
    asRole('SupportWorker')
    mockUseStaff.mockReturnValue(staffWithThreeIssues)
    mockUseParticipantAlertsAggregate.mockReturnValue(threeAlertsOnTwoParticipants)
    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(3))
    mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(3))
    mockUseDashboard.mockReturnValue(summaryData({
      overdueTaskCount: 3, tripsMissingAccommodation: 3, tripsMissingVehicles: 3, tripsMissingStaff: 3, openIncidentCount: 3, qscOverdueCount: 3,
    }))
    renderPage()

    expect(tileLabels()).toEqual(FULL_ORDER.filter((label) => !['Critical Participant Alerts', 'Pending Leave', 'Shift Completions', 'Qualification Issues'].includes(label)))
    expect(screen.queryByText(/Critical Participant Alerts/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Pending Leave/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Shift Completions/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Qualification Issues/)).not.toBeInTheDocument()
  })

  it('shows Qualification Issues, linked to the Qualifications page, to every role that can open that page, and to none that cannot', () => {
    mockUseStaff.mockReturnValue(staffWithOneIssue)
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator', 'ReadOnly']) {
      asRole(role)
      const { unmount } = renderPage()
      const tile = screen.getByRole('group', { name: 'Qualification Issues 1' })
      expect(within(tile).getByRole('link', { name: 'Review qualifications' }), role).toHaveAttribute('href', '/qualifications')
      unmount()
      localStorage.clear()
    }
    // The tile used to link a SupportWorker to a page that bounced them back to the Dashboard.
    asRole('SupportWorker')
    renderPage()
    expect(screen.queryByText('Qualification Issues')).not.toBeInTheDocument()
    expect(band().querySelector('a[href="/qualifications"]')).toBeNull()
  })

  it('spells the accommodation item out (the KPI row abbreviated it to fit a 136px tile)', () => {
    mockUseDashboard.mockReturnValue(summaryData({ tripsMissingAccommodation: 1 }))
    renderPage()

    expect(screen.getByText('Missing Accommodation')).toBeInTheDocument()
    expect(screen.queryByText('Missing Accomm.')).not.toBeInTheDocument()
  })

  it('carries the same numbers as before: each figure is the count its KPI tile showed, at the display step in tabular figures', () => {
    asRole('Coordinator')
    mockUseDashboard.mockReturnValue(summaryData({
      overdueTaskCount: 7, tripsMissingAccommodation: 6, tripsMissingVehicles: 5, tripsMissingStaff: 4, openIncidentCount: 3, qscOverdueCount: 2,
    }))
    renderPage()

    const figures = Object.fromEntries(tiles().map((tile) => [labelOf(tile), tile.querySelector('.text-display')]))
    expect(Object.fromEntries(Object.entries(figures).map(([label, el]) => [label, el!.textContent]))).toEqual({
      Overdue: '7', 'Missing Accommodation': '6', 'Missing Vehicles': '5', 'Missing Staff': '4', 'Open Incidents': '3', 'QSC Overdue': '2',
    })
    for (const el of Object.values(figures)) expect(el).toHaveClass('text-display', 'tabular-nums')
  })

  it('counts the Critical alerts and the participants they belong to, and the credential issues and the staff they belong to', () => {
    showAll()
    renderPage()

    expect(within(tileFor('Critical Participant Alerts')).getByText('3')).toBeInTheDocument()
    expect(tileFor('Critical Participant Alerts')).toHaveTextContent('Critical alerts across 2 participants.')
    expect(within(tileFor('Qualification Issues')).getByText('3')).toBeInTheDocument()
    expect(tileFor('Qualification Issues')).toHaveTextContent('Expired, undated or due within 30 days, across 2 staff members.')
  })

  it('keeps the inactive participant\'s Critical alert out of the tile count, as it is out of the list', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({
      data: [criticalAlertFor('p1', 'Jamie Smith'), { ...criticalAlertFor('p2', 'Churned Client'), isActive: false }],
      isLoading: false,
    })
    renderPage()

    expect(tileFor('Critical Participant Alerts')).toHaveTextContent('Critical alerts across 1 participant.')
    expect(within(tileFor('Critical Participant Alerts')).getByText('1')).toBeInTheDocument()
  })
})

describe('DashboardPage — needs-attention band: each tile says what it means and where it is fixed', () => {
  // [label, the honest line at 3, the link's text, where it goes]. The Missing counts are of the trips the server calls upcoming (start today or within 60 days).
  const EXPECTED = [
    ['Qualification Issues', 'Expired, undated or due within 30 days, across 2 staff members.', 'Review qualifications', '/qualifications'],
    ['Critical Participant Alerts', 'Critical alerts across 2 participants.', 'Review participants', '/participants'],
    ['Overdue', 'Tasks past their due date and still open.', 'Open overdue tasks', '/tasks?status=Overdue'],
    ['Missing Accommodation', 'Trips start within 60 days with no accommodation reserved.', 'Open trips', '/trips'],
    ['Missing Vehicles', 'Trips start within 60 days with no vehicle assigned.', 'Assign vehicles', '/schedule'],
    ['Missing Staff', 'Trips start within 60 days with no staff assigned.', 'Assign staff', '/schedule'],
    ['Open Incidents', 'Incidents not yet resolved or closed.', 'Open incidents', '/incidents'],
    ['QSC Overdue', 'Reportable incidents with no QSC report after 24 hours.', 'Review QSC reports', '/incidents?qsc=overdue'],
    ['Pending Leave', 'Leave and unavailability requests waiting for a decision.', 'Review leave requests', '/rostering/leave'],
    ['Shift Completions', 'Submitted shifts waiting for review before they are billed.', 'Review completions', '/rostering/completions'],
  ] as const

  it.each(EXPECTED)('%s: its figure and label, the line "%s", and a "%s" link to %s', (label, line, linkText, href) => {
    showAll()
    renderPage()

    const tile = screen.getByRole('group', { name: `${label} 3` })
    expect(within(tile).getByText(label)).toBeInTheDocument()
    expect(within(tile).getByText('3')).toHaveClass('text-display')
    expect(within(tile).getByText(line)).toBeInTheDocument()
    const links = within(tile).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName(linkText)
    expect(links[0]).toHaveAttribute('href', href)
  })

  it('opens every action link to a route that exists today, one link per tile, each with a name of its own', () => {
    showAll()
    renderPage()

    const links = within(band()).getAllByRole('link')
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual(EXPECTED.map(([, , text, href]) => [text, href]))
    // Every name is there and none is shared, so a list of the page's links is a list of what each does.
    const names = links.map((a) => a.textContent)
    expect(names.every((name) => name && name.length > 0)).toBe(true)
    expect(new Set(names).size).toBe(names.length)
  })

  it('names the Schedule for vehicles and staff, where trips are assigned them, and the Trips list for accommodation, which is chosen on the trip', () => {
    showAll()
    renderPage()

    expect(within(tileFor('Missing Vehicles')).getByRole('link')).toHaveAttribute('href', '/schedule')
    expect(within(tileFor('Missing Staff')).getByRole('link')).toHaveAttribute('href', '/schedule')
    expect(within(tileFor('Missing Accommodation')).getByRole('link')).toHaveAttribute('href', '/trips')
  })

  it('opens QSC Overdue on the Incidents list already filtered to it, and Overdue on the Tasks list filtered to Overdue', () => {
    showAll()
    renderPage()

    expect(within(tileFor('QSC Overdue')).getByRole('link')).toHaveAttribute('href', '/incidents?qsc=overdue')
    expect(within(tileFor('Overdue')).getByRole('link')).toHaveAttribute('href', '/tasks?status=Overdue')
  })

  it('keeps a count of one in the singular: "Trip starts", "1 staff member", "1 participant"', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(staffWithOneIssue)
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [criticalAlertFor('p1', 'Jamie Smith')], isLoading: false })
    mockUseDashboard.mockReturnValue(summaryData({ tripsMissingAccommodation: 1, tripsMissingVehicles: 1, tripsMissingStaff: 1 }))
    renderPage()

    expect(tileFor('Missing Accommodation')).toHaveTextContent('Trip starts within 60 days with no accommodation reserved.')
    expect(tileFor('Missing Vehicles')).toHaveTextContent('Trip starts within 60 days with no vehicle assigned.')
    expect(tileFor('Missing Staff')).toHaveTextContent('Trip starts within 60 days with no staff assigned.')
    expect(tileFor('Qualification Issues')).toHaveTextContent('across 1 staff member.')
    expect(tileFor('Critical Participant Alerts')).toHaveTextContent('across 1 participant.')
  })

  it('states the warning window the Qualifications page uses (30 days unless the settings say otherwise), with the noun agreeing', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(staffWithOneIssue)
    renderPage()
    expect(tileFor('Qualification Issues')).toHaveTextContent('due within 30 days')
    cleanup()

    mockUseSettings.mockReturnValue({ data: { qualificationWarningDays: 90 } })
    renderPage()
    expect(tileFor('Qualification Issues')).toHaveTextContent('due within 90 days')
    cleanup()

    mockUseSettings.mockReturnValue({ data: { qualificationWarningDays: 1 } })
    renderPage()
    expect(tileFor('Qualification Issues')).toHaveTextContent('due within 1 day,')
  })
})

describe('DashboardPage — needs-attention band: tint and the All clear states', () => {
  it('tints a tile by its tone family: danger takes the error container, warning the warning container, everything in the on-container colour', () => {
    showAll()
    renderPage()

    // danger -> the error container; warning -> the warning container (the trip glance strip's own tints).
    const danger = ['Qualification Issues', 'Critical Participant Alerts', 'Overdue', 'QSC Overdue']
    const warning = ['Missing Accommodation', 'Missing Vehicles', 'Missing Staff', 'Open Incidents', 'Pending Leave', 'Shift Completions']
    for (const label of danger) {
      expect(tileFor(label)).toHaveAttribute('data-attention', 'error')
      expect(tileFor(label)).toHaveClass('bg-[var(--color-error-container)]', 'text-[var(--color-on-error-container)]')
    }
    for (const label of warning) {
      expect(tileFor(label)).toHaveAttribute('data-attention', 'warning')
      expect(tileFor(label)).toHaveClass('bg-[var(--color-warning-container)]', 'text-[var(--color-on-warning-container)]')
    }
  })

  it('names the items at zero in ONE All clear row on Pale Sprout, after the tiles, and gives them no tile', () => {
    asRole('Coordinator')
    mockUseDashboard.mockReturnValue(summaryData({ overdueTaskCount: 2 }))
    renderPage()

    expect(tileLabels()).toEqual(['Overdue'])
    const row = clearRow()!
    expect(row).toHaveTextContent(
      'All clear on Qualification Issues, Critical Participant Alerts, Missing Accommodation, Missing Vehicles, Missing Staff, Open Incidents, QSC Overdue, Pending Leave and Shift Completions',
    )
    expect(row).toHaveClass('bg-[var(--color-primary-fixed)]', 'text-[var(--color-on-primary-fixed)]')
    expect(screen.getAllByText('All clear')).toHaveLength(1)
    expect(tileFor('Overdue').compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('names only the items the role has in the All clear row', () => {
    asRole('ReadOnly')
    mockUseDashboard.mockReturnValue(summaryData({ overdueTaskCount: 2 }))
    renderPage()

    expect(clearRow()).toHaveTextContent(
      'All clear on Qualification Issues, Missing Accommodation, Missing Vehicles, Missing Staff, Open Incidents and QSC Overdue',
    )
    expect(clearRow()).not.toHaveTextContent('Critical Participant Alerts')
    expect(clearRow()).not.toHaveTextContent('Pending Leave')
    expect(clearRow()).not.toHaveTextContent('Shift Completions')
  })

  it('becomes one full-width Pale Sprout field when everything is zero: "All clear. Nothing needs you right now."', () => {
    asRole('Coordinator')
    renderPage()

    const field = screen.getByText('All clear. Nothing needs you right now.').closest('div.rounded-md') as HTMLElement
    expect(field).toHaveClass('bg-[var(--color-primary-fixed)]', 'text-[var(--color-on-primary-fixed)]')
    expect(band().firstElementChild).toBe(field)
    // The field IS the band: no tile, no link, no second row.
    expect(band().querySelector('div.grid')).toBeNull()
    expect(within(band()).queryAllByRole('link')).toHaveLength(0)
    expect(within(band()).queryAllByRole('group')).toHaveLength(0)
    expect(clearRow()).toBeNull()
    // It names everything it checked, so the claim can be audited.
    expect(screen.getByText(
      'Checked and at zero: Qualification Issues, Critical Participant Alerts, Overdue, Missing Accommodation, Missing Vehicles, Missing Staff, Open Incidents, QSC Overdue, Pending Leave and Shift Completions.',
    )).toBeInTheDocument()
  })

  it('stays one field, naming what it checked, for a role with fewer items', () => {
    asRole('ReadOnly')
    renderPage()

    expect(screen.getByText('All clear. Nothing needs you right now.')).toBeInTheDocument()
    expect(screen.getByText('Checked and at zero: Qualification Issues, Overdue, Missing Accommodation, Missing Vehicles, Missing Staff, Open Incidents and QSC Overdue.')).toBeInTheDocument()
  })

  it('tints nothing when every item is zero: no container fill but the one Pale Sprout field', () => {
    asRole('Coordinator')
    renderPage()

    expect(band().innerHTML).not.toMatch(/-container\)\]/)
    expect(band().querySelectorAll('[data-attention]')).toHaveLength(0)
  })

  it('goes back to tiles the moment something is above zero: the field is not sticky', () => {
    asRole('Coordinator')
    const { rerender } = renderPage()
    expect(screen.getByText('All clear. Nothing needs you right now.')).toBeInTheDocument()

    mockUseDashboard.mockReturnValue(summaryData({ qscOverdueCount: 1 }))
    rerender(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
    expect(tileLabels()).toEqual(['QSC Overdue'])
    expect(clearRow()).toHaveTextContent('All clear on Qualification Issues')
  })

  it('draws no All clear row, and no Pale Sprout at all, while every item needs you', () => {
    showAll()
    renderPage()

    expect(screen.queryByText('All clear')).not.toBeInTheDocument()
    expect(band().innerHTML).not.toMatch(/primary-fixed/)
  })
})

describe('DashboardPage — needs-attention band: no "All clear" without data', () => {
  const qualification = () => tileFor('Qualification Issues')
  const alerts = () => tileFor('Critical Participant Alerts')
  const leave = () => tileFor('Pending Leave')
  const completions = () => tileFor('Shift Completions')
  const inFlight = { data: undefined, isPending: true, isLoading: true, isError: false }
  const failed = { data: undefined, isLoading: false, isError: true }

  // The shared contract of a placeholder: an en dash where the number would be, not tinted, no line, no action, no number.
  const expectPlaceholder = (tile: HTMLElement, { busy, say }: { busy: boolean; say: string }) => {
    expect(within(tile).getByText('–')).toHaveClass('text-display', 'tabular-nums')
    expect(within(tile).getByText(say)).toHaveClass('sr-only')
    if (busy) expect(tile).toHaveAttribute('aria-busy', 'true')
    else expect(tile).not.toHaveAttribute('aria-busy')
    expect(tile).not.toHaveAttribute('data-attention')
    expect(tile).toHaveClass('bg-[var(--color-card)]', 'text-[var(--color-muted-foreground)]')
    expect(within(tile).queryByText('0')).not.toBeInTheDocument()
    expect(within(tile).queryByText('All clear')).not.toBeInTheDocument()
    // No line saying what a count means (there is no count), and nowhere to "fix" it from the tile but the page it counts.
    expect(tile.querySelectorAll('span.text-\\[13px\\]')).toHaveLength(1) // only the label
  }
  const clearNames = () => clearRow()?.textContent ?? ''

  it('shows an en dash on Qualification Issues while the staff list loads: busy, untinted, a link to the page, no "All clear"', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(inFlight)
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    expectPlaceholder(qualification(), { busy: true, say: 'Loading' })
    expect(within(band()).getByRole('link', { name: 'Qualification Issues Loading' })).toHaveAttribute('href', '/qualifications')
    // The rest of the band HAS its data, so it says so, but not for the item that is waiting, and the band is not the all-clear field.
    expect(clearNames()).not.toMatch(/Qualification Issues/)
    expect(clearNames()).toMatch(/Critical Participant Alerts/)
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it('shows an en dash and "Couldn\'t load" on Qualification Issues when the staff request fails: not busy, no "All clear"', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(failed)
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    expectPlaceholder(qualification(), { busy: false, say: "Couldn't load" })
    expect(within(band()).getByRole('link', { name: "Qualification Issues Couldn't load" })).toHaveAttribute('href', '/qualifications')
    expect(clearNames()).not.toMatch(/Qualification Issues/)
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it('shows an en dash and "Couldn\'t load" on Critical Participant Alerts when the alerts request fails: not busy, no "All clear"', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue(failed)
    renderPage()

    expectPlaceholder(alerts(), { busy: false, say: "Couldn't load" })
    expect(within(band()).getByRole('link', { name: "Critical Participant Alerts Couldn't load" })).toHaveAttribute('href', '/participants')
    expect(clearNames()).not.toMatch(/Critical Participant Alerts/)
    expect(clearNames()).toMatch(/Qualification Issues/)
    // No participant alerts section is invented from a failed request.
    expect(screen.queryByRole('heading', { name: 'Critical Participant Alerts' })).not.toBeInTheDocument()
  })

  it('shows an en dash on Pending Leave while the queue loads or after it failed, for a role that approves leave: never a clear queue', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })

    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(0, { loading: true }))
    const first = renderPage()
    expectPlaceholder(leave(), { busy: true, say: 'Loading' })
    expect(within(band()).getByRole('link', { name: 'Pending Leave Loading' })).toHaveAttribute('href', '/rostering/leave')
    expect(clearNames()).not.toMatch(/Pending Leave/)
    first.unmount()

    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(0, { error: true }))
    renderPage()
    expectPlaceholder(leave(), { busy: false, say: "Couldn't load" })
    expect(within(band()).getByRole('link', { name: "Pending Leave Couldn't load" })).toHaveAttribute('href', '/rostering/leave')
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it('shows the placeholder in the item\'s own place among the tiles, so the rows do not jump when its data arrives', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(inFlight)
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    mockUseDashboard.mockReturnValue(summaryData({ overdueTaskCount: 2, tripsMissingStaff: 1 }))
    renderPage()

    expect(tileLabels()).toEqual(['Qualification Issues', 'Overdue', 'Missing Staff'])
  })

  it('claims "All clear" for none of the items while their requests are all in flight', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(inFlight)
    mockUseParticipantAlertsAggregate.mockReturnValue(inFlight)
    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(0, { loading: true }))
    mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(0, { loading: true }))
    renderPage()

    // The items the summary answered are clear, and the row names only those: not one of the four that are waiting.
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
    expect(clearNames()).toBe('All clear on Overdue, Missing Accommodation, Missing Vehicles, Missing Staff, Open Incidents and QSC Overdue')
    expectPlaceholder(qualification(), { busy: true, say: 'Loading' })
    expectPlaceholder(alerts(), { busy: true, say: 'Loading' })
    expectPlaceholder(leave(), { busy: true, say: 'Loading' })
    expectPlaceholder(completions(), { busy: true, say: 'Loading' })
    expect(tiles().filter((tile) => tile.getAttribute('aria-busy') === 'true')).toHaveLength(4)
  })

  it('claims "All clear" for none of the items whose requests have all failed, and says so four times', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(failed)
    mockUseParticipantAlertsAggregate.mockReturnValue(failed)
    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(0, { error: true }))
    mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(0, { error: true }))
    renderPage()

    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
    expect(clearNames()).not.toMatch(/Qualification Issues|Critical Participant Alerts|Pending Leave|Shift Completions/)
    expect(screen.getAllByText("Couldn't load")).toHaveLength(4)
  })

  it('treats a failed request as a placeholder even when rows are still cached, so a stale count is never tinted', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue({ ...staffWithOneIssue, isLoading: false, isError: true })
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [criticalAlertFor('p1', 'Jamie Smith')], isLoading: false, isError: true })
    renderPage()

    expectPlaceholder(qualification(), { busy: false, say: "Couldn't load" })
    expectPlaceholder(alerts(), { busy: false, say: "Couldn't load" })
  })

  it('fails honestly for a role without alerts or leave: the staff item is the only placeholder', () => {
    // ReadOnly: no alerts and no leave, but it can open the Qualifications page, so it keeps the tile (a SupportWorker gets none).
    asRole('ReadOnly')
    mockUseStaff.mockReturnValue(failed)
    renderPage()

    expectPlaceholder(qualification(), { busy: false, say: "Couldn't load" })
    expect(screen.getAllByText("Couldn't load")).toHaveLength(1)
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it('never shows the loading placeholder to a role that cannot view alerts (the item, and the request, do not exist)', () => {
    asRole('SupportWorker')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: undefined, isLoading: false })
    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(0))
    mockUseDashboard.mockReturnValue(summaryData({ overdueTaskCount: 1 }))
    renderPage()

    expect(screen.queryByText('–')).not.toBeInTheDocument()
    expect(band().querySelector('[aria-busy]')).toBeNull()
  })

  it('settles from each placeholder: a zero joins the All clear row, a count becomes a tinted tile', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(failed)
    mockUseParticipantAlertsAggregate.mockReturnValue(inFlight)
    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(0, { loading: true }))
    const { rerender } = renderPage()
    expectPlaceholder(qualification(), { busy: false, say: "Couldn't load" })
    expectPlaceholder(alerts(), { busy: true, say: 'Loading' })
    expectPlaceholder(leave(), { busy: true, say: 'Loading' })

    // The staff retry succeeds with nobody expiring; the alerts arrive with one Critical alert; the leave queue is empty.
    mockUseStaff.mockReturnValue({ data: [], isLoading: false, isError: false })
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [criticalAlertFor('p1', 'Jamie Smith')], isLoading: false, isError: false })
    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(0))
    rerender(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(tileLabels()).toEqual(['Critical Participant Alerts'])
    expect(alerts()).toHaveAttribute('data-attention', 'error')
    expect(within(alerts()).getByText('1')).toBeInTheDocument()
    expect(clearNames()).toMatch(/Qualification Issues/)
    expect(clearNames()).toMatch(/Pending Leave/)
    expect(within(band()).queryByText("Couldn't load")).not.toBeInTheDocument()

    // Later the staff list is refreshed with an expiring credential: the item is a tile, not clear.
    mockUseStaff.mockReturnValue({ ...staffWithOneIssue, isLoading: false, isError: false })
    rerender(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(qualification()).toHaveAttribute('data-attention', 'error')
    expect(within(qualification()).getByText('1')).toBeInTheDocument()
    expect(clearNames()).not.toMatch(/Qualification Issues/)
  })
})

describe('DashboardPage — Shift Completions: the band counts what the nav badge counts', () => {
  it('is a tile for every role that can review completions, linked to the review queue, and for no other role', () => {
    mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(2))
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator']) {
      asRole(role)
      const { unmount } = renderPage()
      const tile = screen.getByRole('group', { name: 'Shift Completions 2' })
      expect(within(tile).getByText('Submitted shifts waiting for review before they are billed.'), role).toBeInTheDocument()
      expect(within(tile).getByRole('link', { name: 'Review completions' }), role).toHaveAttribute('href', '/rostering/completions')
      expect(tile, role).toHaveAttribute('data-attention', 'warning')
      unmount()
      localStorage.clear()
    }
    for (const role of ['ReadOnly', 'SupportWorker']) {
      asRole(role)
      const { unmount } = renderPage()
      expect(screen.queryByText(/Shift Completions/), role).not.toBeInTheDocument()
      unmount()
      localStorage.clear()
    }
  })

  it('asks for the queue only for a role that can review it, the gate the nav badge uses', () => {
    asRole('Coordinator')
    renderPage()
    expect(mockUsePendingCompletionQueue).toHaveBeenLastCalledWith(true)
    cleanup()

    asRole('ReadOnly')
    renderPage()
    expect(mockUsePendingCompletionQueue).toHaveBeenLastCalledWith(false)
  })

  // The nav shows a red 2 on Staff & roster for two shifts awaiting review: the band must not say, beside it, that nothing needs you.
  it('does not say "Nothing needs you" while shifts wait for review, even with every other item at zero', () => {
    asRole('Coordinator')
    mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(2))
    renderPage()

    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
    expect(tileLabels()).toEqual(['Shift Completions'])
    expect(clearRow()).toHaveTextContent(
      'All clear on Qualification Issues, Critical Participant Alerts, Overdue, Missing Accommodation, Missing Vehicles, Missing Staff, Open Incidents, QSC Overdue and Pending Leave',
    )
    expect(clearRow()).not.toHaveTextContent('Shift Completions')
  })

  it('names Shift Completions among the items it checked once the queue is empty', () => {
    asRole('Coordinator')
    mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(0))
    renderPage()

    expect(screen.getByText('All clear. Nothing needs you right now.')).toBeInTheDocument()
    expect(screen.getByText(/^Checked and at zero:.*Shift Completions\.$/)).toBeInTheDocument()
  })

  it('shows an en dash while the queue loads or after it failed, and never calls the queue clear', () => {
    asRole('Coordinator')

    mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(0, { loading: true }))
    const first = renderPage()
    const loading = screen.getByRole('link', { name: 'Shift Completions Loading' })
    expect(loading).toHaveAttribute('href', '/rostering/completions')
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(loading).not.toHaveAttribute('data-attention')
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
    expect(clearRow()).not.toHaveTextContent('Shift Completions')
    first.unmount()

    mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(0, { error: true }))
    renderPage()
    const failed = screen.getByRole('link', { name: "Shift Completions Couldn't load" })
    expect(failed).toHaveAttribute('href', '/rostering/completions')
    expect(failed).not.toHaveAttribute('aria-busy')
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it('sits after Pending Leave: the two queues the Staff & roster badge adds together', () => {
    showAll()
    renderPage()

    const labels = tileLabels()
    expect(labels.slice(-2)).toEqual(['Pending Leave', 'Shift Completions'])
  })
})

describe('DashboardPage — needs-attention band: accessibility', () => {
  it('is one labelled region, with a link for each action whose name says what it does, and the number and the label in every tile\'s name', () => {
    showAll()
    renderPage()

    expect(screen.getByRole('region', { name: 'Needs attention' })).toBe(band())
    for (const link of within(band()).getAllByRole('link')) expect(link).toHaveAccessibleName()
    const names = within(band()).getAllByRole('group').map((group) => group.getAttribute('aria-label'))
    expect(names).toEqual(FULL_ORDER.map((label) => `${label} 3`))
  })

  it('floors every action link at --tap-min and makes the whole tile its hit area, so it keeps a 44px target on touch', () => {
    showAll()
    renderPage()

    for (const link of within(band()).getAllByRole('link')) {
      expect(link).toHaveClass('min-h-[var(--tap-min)]', 'after:absolute', 'after:inset-0')
      expect(link.closest('[role="group"]')).toHaveClass('relative')
    }
    expect(band().innerHTML).not.toMatch(/(?:min-h|min-w|h|w)-\[44px\]/)
  })

  it('sets the tiles and the rest of the page at the same text sizes the system owns: nothing in the band is bigger than the display step or below 13px', () => {
    showAll()
    renderPage()

    expect(band().innerHTML).not.toMatch(/text-(?:xl|2xl|3xl|4xl|5xl|6xl|\[(?:1[0-2]|1[5-9]|[2-9]\d)px\]|\[0?\.\d+rem\])/)
    expect(band().querySelectorAll('.text-display')).toHaveLength(10)
  })

  it('still has exactly one h1 whatever the band shows', () => {
    for (const setUp of [showAll, () => asRole('Coordinator')]) {
      setUp()
      const { unmount } = renderPage()
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
      unmount()
      localStorage.clear()
    }
  })
})

// jsdom has no layout, so the responsive contract is pinned as classes and custom properties (the spans themselves are tested in bandLayout.test.ts): a 60-track
// grid with the 8px between tiles as padding, each tile reading its own spans from the band's width (a container query, so the 232px sidebar does not matter).
describe('DashboardPage — needs-attention band: responsive shape', () => {
  it('is a size container holding a 60-track grid, not a viewport breakpoint', () => {
    showAll()
    renderPage()

    expect(band()).toHaveClass('@container')
    expect(grid().className).toBe(BAND_GRID_CLASS)
    // No auto-fit, no viewport breakpoint: rows are balanced by count and by the band's own width.
    expect(grid().className).not.toMatch(/auto-fit|minmax/)
    for (const cell of grid().children) expect(cell.className).not.toMatch(/(?:^|\s)(?:sm|md|lg|xl|2xl):/)
  })

  it.each([
    [1, { overdueTaskCount: 2 }],
    [2, { overdueTaskCount: 2, qscOverdueCount: 1 }],
    [3, { overdueTaskCount: 2, qscOverdueCount: 1, tripsMissingStaff: 1 }],
    [5, { overdueTaskCount: 2, qscOverdueCount: 1, tripsMissingStaff: 1, openIncidentCount: 1, tripsMissingVehicles: 1 }],
  ])('deals %i tile(s) into balanced rows: each cell reads the spans bandSpans gives it', (count, counts) => {
    asRole('Coordinator')
    mockUseDashboard.mockReturnValue(summaryData(counts))
    renderPage()

    const cells = [...grid().children] as HTMLElement[]
    expect(cells).toHaveLength(count)
    const spans = bandSpans(count)
    cells.forEach((cell, i) => {
      expect(cell.className).toBe(BAND_SPAN_CLASS)
      spans[i].forEach((span, step) => expect(cell.style.getPropertyValue(`--span-${step}`)).toBe(String(span)))
    })
  })

  it('keeps the band a peak in the page: it sits between the header and the panels', () => {
    renderPage()

    const page = band().parentElement as HTMLElement
    const children = [...page.children]
    expect(children.indexOf(band())).toBe(1)
    expect(children[0]).toContainElement(screen.getByRole('heading', { level: 1 }))
    expect(children[2].className).toMatch(/xl:grid-cols-2/)
  })

  it('never truncates, scrolls sideways or shrinks the type in the band', () => {
    showAll()
    renderPage()

    expect(band().innerHTML).not.toMatch(/overflow|truncate|line-clamp/)
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
