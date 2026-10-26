import { afterEach, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from '../DashboardPage'
import {
  mockUseDashboard, mockUseSettings, mockUseStaff, mockUseParticipantAlertsAggregate, mockUsePendingLeaveQueue, mockUsePendingCompletionQueue, mockUseDecisionGroups, mockUseModuleVisibility, mockUseSetupStatus, mockUseProviderSettings,
} from './dashboardHookMocks'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// The app's real route table: every `<Route path="...">` App.tsx declares, but not the catch-all (path="*"), which would "match" a path nobody built. A route renamed
// there must fail a test here, not a coordinator's click.
export const APP_ROUTES = [...readFileSync(join(SRC, 'App.tsx'), 'utf8').matchAll(/<Route path="([^"]+)"/g)].map((match) => match[1]).filter((path) => path !== '*')
export const routeExists = (pathname: string) => APP_ROUTES.some((route) => new RegExp('^' + route.replace(/:[^/]+/g, '[^/]+') + '$').test(pathname))

// A .ts file (no JSX), so react-refresh's one-components-per-file rule does not read this shared kit as a component module.
export function renderPage() {
  return render(createElement(MemoryRouter, null, createElement(DashboardPage)))
}

/** The defaults every dashboard page test starts from (moved verbatim from DashboardPage.test.tsx). Call it once at the top of a test file. */
export const FINISHED_ORG = { staffCount: 20, participantCount: 40, participantsWithPlanCount: 40, firstPublishedWeekStart: '2020-01-06', hasInvoice: true, employmentHeroAvailable: false }
// A settled query as the page reads it.
export const settled = (data: unknown) => ({ data, isPending: false, isError: false, isFetching: false, fetchStatus: 'idle', errorUpdateCount: 0 })

export function installDashboardDefaults() {
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
    mockUseModuleVisibility.mockReturnValue({ data: { hiddenAccommodation: false, hiddenVehicles: false }, isError: false })
    // A finished organisation: its first week was published long ago, so the setup card is not drawn and no existing assertion moves.
    mockUseSetupStatus.mockReturnValue(settled({ ...FINISHED_ORG }))
    mockUseProviderSettings.mockReturnValue(settled({ organisationName: 'Sunrise Care', address: '1 Main St', state: 'NSW' }))
    // No decision groups: a test sees the band exactly as its viewer's role draws it.
    mockUseDecisionGroups.mockReturnValue([])
  })
}

// The pending leave queue as the page reads it: the count, and whether that count can be trusted yet (it is 0 while loading, and after a failure).
export const pendingLeave = (count: number, o: { loading?: boolean; error?: boolean } = {}) => ({ count, loading: false, error: false, ...o })
// The shift completions awaiting review, read the same way (the nav badge on Staff & roster adds this queue to the leave queue).
export const pendingCompletions = pendingLeave

// ── Bolder dashboard: a greeting and the date as the title, and the needs-attention band as the peak ──

export const summaryData = (overrides: Record<string, unknown> = {}) => ({
  data: {
    upcomingTripCount: 0, activeParticipantCount: 0, outstandingTaskCount: 0,
    overdueTaskCount: 0, conflictCount: 0, tripsMissingAccommodation: 0,
    tripsMissingVehicles: 0, tripsMissingStaff: 0, openIncidentCount: 0,
    qscOverdueCount: 0, upcomingTrips: [], overdueTasks: [],
    ...overrides,
  },
  isPending: false, isLoading: false, isError: false,
})

export const asRole = (role: string, fullName?: string) => localStorage.setItem('odip_user', JSON.stringify(fullName ? { role, fullName } : { role }))

export const criticalAlertFor = (participantId: string, participantName: string) => ({
  participantId, participantName, isActive: true,
  alerts: [{ type: 'plan-expired', severity: 'Critical', message: 'NDIS plan end date has passed', deepLinkTab: 'details', linkTo: null }],
  criticalCount: 1, warningCount: 0, infoCount: 0,
})

// One staff member whose first-aid certificate expired long ago: exactly one qualification issue, whatever today is.
export const staffWithOneIssue = { data: [{ isFirstAidQualified: true, firstAidExpiryDate: '2000-01-01' }] }

// Two staff and three issues: the first one's First Aid has expired and his Driver Licence is flagged with no date; the second one's First Aid has expired too.
export const staffWithThreeIssues = {
  data: [
    { isFirstAidQualified: true, firstAidExpiryDate: '2000-01-01', isDriverEligible: true, driverLicenceExpiryDate: null },
    { isFirstAidQualified: true, firstAidExpiryDate: '2000-01-01' },
  ],
}

// Three Critical alerts on two participants: the tile counts alerts (3), the Participants table shows one flagged row per participant (2).
export const threeAlertsOnTwoParticipants = {
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

export const band = () => screen.getByRole('region', { name: 'Alerts' })
export const grid = () => band().querySelector('div.grid') as HTMLElement
// The band's tiles, in order: each grid cell holds one tile, a named group or (a placeholder that has a page to go to) a link.
export const tiles = () => [...grid().children].map((cell) => cell.firstElementChild as HTMLElement)
export const labelOf = (tile: HTMLElement) => tile.querySelector('span:not(.text-display)')!.textContent
export const tileLabels = () => tiles().map(labelOf)
export const tileFor = (label: string) => tiles().find((tile) => labelOf(tile) === label) as HTMLElement
export const clearRow = () => screen.queryByText('All clear', { selector: 'span.font-semibold' })?.closest('p') ?? null

export const FULL_ORDER = [
  'Qualification issues', 'Critical participant alerts', 'Budgets at risk', 'Overdue', 'Missing accommodation',
  'Missing vehicles', 'Missing staff', 'Open incidents', 'QSC overdue', 'Pending leave', 'Shift completions',
]

// The same alerts, with three more participants whose budgets are at risk (two over, one forecast to go over). The Critical alerts are still the three on two participants: an over-budget alert is
// the Budgets at risk tile's, and is not counted a second time as a Critical one.
export const threeAlertsOnTwoParticipantsAndThreeBudgetsAtRisk = {
  data: [
    ...threeAlertsOnTwoParticipants.data,
    { participantId: 'p3', participantName: 'Olive Over', isActive: true, criticalCount: 1, warningCount: 0, infoCount: 0, alerts: [{ type: 'budget-over', severity: 'Critical', message: 'Core is $1,000 over this period\'s $8,000 (to 31 Dec 2026)', deepLinkTab: 'funding' }] },
    { participantId: 'p4', participantName: 'Olga Over', isActive: true, criticalCount: 1, warningCount: 0, infoCount: 0, alerts: [{ type: 'budget-over', severity: 'Critical', message: 'Core is $20 over this period\'s $800 (to 31 Dec 2026)', deepLinkTab: 'funding' }] },
    { participantId: 'p5', participantName: 'Ford Cast', isActive: true, criticalCount: 0, warningCount: 1, infoCount: 0, alerts: [{ type: 'budget-forecast-over', severity: 'Warning', message: 'Booked shifts would take Core $640 over this period\'s $8,000 by 31 Dec 2026', deepLinkTab: 'funding' }] },
  ],
  isLoading: false,
}

// Every item above zero, for a SuperAdmin with no organisation: all eleven are tiles (the staff list and the alerts give 3 issues and 3 alerts, and three participants have a budget at risk).
export function showAll() {
  // A SuperAdmin with no organisation: the one viewer who has every tile and no decision group (SHAPE call 6).
  asRole('SuperAdmin')
  mockUseStaff.mockReturnValue(staffWithThreeIssues)
  mockUseParticipantAlertsAggregate.mockReturnValue(threeAlertsOnTwoParticipantsAndThreeBudgetsAtRisk)
  mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(3))
  mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(3))
  mockUseDashboard.mockReturnValue(summaryData({
    overdueTaskCount: 3, tripsMissingAccommodation: 3, tripsMissingVehicles: 3, tripsMissingStaff: 3, openIncidentCount: 3, qscOverdueCount: 3,
  }))
}
