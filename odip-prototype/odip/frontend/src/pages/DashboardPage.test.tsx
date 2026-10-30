import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from './DashboardPage'
import { BAND_GRID_CLASS, BAND_SPAN_CLASS, bandSpans } from './dashboard/bandLayout'
import { mockUseDashboard, mockUseSettings, mockUseStaff, mockUseParticipantAlertsAggregate, mockUsePendingLeaveQueue, mockUsePendingCompletionQueue } from './dashboard/dashboardHookMocks'
import { installDashboardDefaults, renderPage, summaryData, asRole, pendingLeave, pendingCompletions, criticalAlertFor, staffWithOneIssue, staffWithThreeIssues, threeAlertsOnTwoParticipantsAndThreeBudgetsAtRisk, FULL_ORDER, showAll, band, grid, tiles, labelOf, tileLabels, tileFor, clearRow, APP_ROUTES, routeExists } from './dashboard/dashboardTestKit'

vi.mock('@/api/hooks', async () => (await import('./dashboard/dashboardHookMocks')).hooks)
vi.mock('./dashboard/useDecisionGroups', async () => ({ useDecisionGroups: (await import('./dashboard/dashboardHookMocks')).mockUseDecisionGroups }))

const PAGES = dirname(fileURLToPath(import.meta.url))

installDashboardDefaults()

describe('DashboardPage — needs-attention band: a tile for what needs you', () => {
  it('holds every item in its fixed order for a Coordinator with all eleven above zero: one named region', () => {
    showAll()
    renderPage()

    expect(tileLabels()).toEqual(FULL_ORDER.filter((label) => label !== 'Critical participant alerts'))
    // The band is the only region: one landmark, named by what it is for.
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(clearRow()).toBeNull()
  })

  it('makes a tile of each item above zero, in that order, and of nothing else: the zero is named in the All clear row instead', () => {
    asRole('SuperAdmin')
    mockUseStaff.mockReturnValue(staffWithOneIssue)
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [criticalAlertFor('p1', 'Jamie Smith')], isLoading: false })
    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(2))
    mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(1))
    mockUseDashboard.mockReturnValue(summaryData({
      overdueTaskCount: 2, tripsMissingAccommodation: 1, tripsMissingVehicles: 0, tripsMissingStaff: 4, openIncidentCount: 3, qscOverdueCount: 1,
    }))
    renderPage()

    expect(tileLabels()).toEqual(FULL_ORDER.filter((label) => !['Critical participant alerts', 'Missing vehicles', 'Budgets at risk'].includes(label)))
    expect(screen.queryByRole('group', { name: /Missing vehicles/ })).not.toBeInTheDocument()
    // No budget is in force for anybody here, so the band does not name Budgets at risk at all: it cannot say it checked what nobody recorded. The other zero is a name in the row.
    expect(clearRow()).toHaveTextContent('All clear on trips missing vehicles')
    expect(clearRow()).not.toHaveTextContent(/budgets/)
  })

  it('leaves out the alerts item, Pending leave, Shift completions and Qualification issues for a role without canViewAlerts / canApproveLeave / canReviewCompletions / the Qualifications page', () => {
    asRole('SupportWorker')
    mockUseStaff.mockReturnValue(staffWithThreeIssues)
    mockUseParticipantAlertsAggregate.mockReturnValue(threeAlertsOnTwoParticipantsAndThreeBudgetsAtRisk)
    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(3))
    mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(3))
    mockUseDashboard.mockReturnValue(summaryData({
      overdueTaskCount: 3, tripsMissingAccommodation: 3, tripsMissingVehicles: 3, tripsMissingStaff: 3, openIncidentCount: 3, qscOverdueCount: 3,
    }))
    renderPage()

    expect(tileLabels()).toEqual(FULL_ORDER.filter((label) => !['Critical participant alerts', 'Budgets at risk', 'Pending leave', 'Shift completions', 'Qualification issues'].includes(label)))
    expect(screen.queryByText(/Budgets at risk/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Critical participant alerts/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Pending leave/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Shift completions/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Qualification issues/)).not.toBeInTheDocument()
  })

  it('shows Qualification issues, linked to the Qualifications page, to every role without the Staff compliance group, and to none that cannot', () => {
    mockUseStaff.mockReturnValue(staffWithOneIssue)
    for (const role of ['SuperAdmin', 'ReadOnly']) {
      asRole(role)
      const { unmount } = renderPage()
      const tile = screen.getByRole('group', { name: 'Qualification issues 1' })
      expect(within(tile).getByRole('link', { name: 'Review qualifications' }), role).toHaveAttribute('href', '/qualifications')
      unmount()
      localStorage.clear()
    }
    // An Admin and a Coordinator update the credentials in their Staff compliance group instead (SHAPE call 6).
    for (const role of ['Admin', 'Coordinator']) {
      asRole(role)
      const { unmount } = renderPage()
      expect(screen.queryByRole('group', { name: 'Qualification issues 1' }), role).toBeNull()
      unmount()
      localStorage.clear()
    }
    // The tile used to link a SupportWorker to a page that bounced them back to the Dashboard.
    asRole('SupportWorker')
    renderPage()
    expect(screen.queryByText('Qualification issues')).not.toBeInTheDocument()
    expect(document.querySelector('a[href="/qualifications"]')).toBeNull()
  })

  it('spells the accommodation item out (the KPI row abbreviated it to fit a 136px tile)', () => {
    mockUseDashboard.mockReturnValue(summaryData({ tripsMissingAccommodation: 1 }))
    renderPage()

    expect(screen.getByText('Missing accommodation')).toBeInTheDocument()
    expect(screen.queryByText('Missing Accomm.')).not.toBeInTheDocument()
  })

  it('carries the same numbers as before: each figure is the count its KPI tile showed, at the display step in tabular figures', () => {
    asRole('SuperAdmin')
    mockUseDashboard.mockReturnValue(summaryData({
      overdueTaskCount: 7, tripsMissingAccommodation: 6, tripsMissingVehicles: 5, tripsMissingStaff: 4, openIncidentCount: 3, qscOverdueCount: 2,
    }))
    renderPage()

    const figures = Object.fromEntries(tiles().map((tile) => [labelOf(tile), tile.querySelector('.text-display')]))
    expect(Object.fromEntries(Object.entries(figures).map(([label, el]) => [label, el!.textContent]))).toEqual({
      Overdue: '7', 'Missing accommodation': '6', 'Missing vehicles': '5', 'Missing staff': '4', 'Open incidents': '3', 'NDIS Commission overdue': '2',
    })
    for (const el of Object.values(figures)) expect(el).toHaveClass('text-display', 'tabular-nums')
  })

  it('counts the Critical alerts and the participants they belong to, and the credential issues and the staff they belong to', () => {
    showAll()
    renderPage()

    expect(screen.getByRole('heading', { name: 'Critical participant alerts (3)' })).toBeInTheDocument()
    expect(screen.getByText('across 2 participants')).toBeInTheDocument()
    expect(within(tileFor('Qualification issues')).getByText('3')).toBeInTheDocument()
    expect(tileFor('Qualification issues')).toHaveTextContent('Expired, undated or due within 30 days, across 2 staff members.')
  })

  it('keeps the inactive participant\'s Critical alert out of the tile count, as it is out of the list', () => {
    asRole('SuperAdmin')
    mockUseParticipantAlertsAggregate.mockReturnValue({
      data: [criticalAlertFor('p1', 'Jamie Smith'), { ...criticalAlertFor('p2', 'Churned Client'), isActive: false }],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByRole('heading', { name: 'Critical participant alerts (1)' })).toBeInTheDocument()
  })
})

describe('DashboardPage — needs-attention band: each tile says what it means and where it is fixed', () => {
  // [label, the honest line at 3, the link's text, where it goes]. The Missing counts are of the trips the server calls upcoming (start today or within 60 days).
  const EXPECTED = [
    ['Qualification issues', 'Expired, undated or due within 30 days, across 2 staff members.', 'Review qualifications', '/qualifications'],
    ['Budgets at risk', '3 participants: 2 over, 1 forecast to go over', 'Review budgets', '/budgets'],
    ['Overdue', 'Tasks past their due date and still open.', 'Open overdue tasks', '/tasks?status=Overdue'],
    ['Missing accommodation', 'Trips start within 60 days with no accommodation reserved.', 'Open trips', '/trips'],
    ['Missing vehicles', 'Trips start within 60 days with no vehicle assigned.', 'Assign vehicles', '/schedule'],
    ['Missing staff', 'Trips start within 60 days with no staff assigned.', 'Assign staff', '/schedule'],
    ['Open incidents', 'Incidents not yet resolved or closed.', 'Open incidents', '/incidents'],
    ['NDIS Commission overdue', 'Reportable incidents not reported to the NDIS Commission by their deadline.', 'Review NDIS Commission reports', '/incidents?qsc=overdue'],
    ['Pending leave', 'Leave and unavailability requests waiting for a decision.', 'Review leave requests', '/rostering/leave'],
    ['Shift completions', 'Submitted shifts waiting for review before they are billed.', 'Review completions', '/rostering/completions'],
  ] as const

  it.each(EXPECTED)('%s: its figure and label, the line "%s", and a "%s" link to %s', (label, line, linkText, href) => {
    showAll()
    renderPage()

    const tile = screen.getByRole('group', { name: `${label} 3` })
    expect(within(tile).getAllByText(label)[0]).toHaveClass('font-semibold')   // the label is first; "Open incidents" is also the link text
    expect(within(tile).getByText('3')).toHaveClass('text-display')
    expect(within(tile).getByText(line)).toBeInTheDocument()
    const links = within(tile).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName(linkText)
    expect(links[0]).toHaveAttribute('href', href)
  })

  it('has one link per tile, in tile order, each with a name of its own, and each to the target in the table above', () => {
    showAll()
    renderPage()

    const links = within(band()).getAllByRole('link')
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual(EXPECTED.map(([, , text, href]) => [text, href]))
    // Every name is there and none is shared, so a list of the page's links is a list of what each does.
    const names = links.map((a) => a.textContent)
    expect(names.every((name) => name && name.length > 0)).toBe(true)
    expect(new Set(names).size).toBe(names.length)
  })

  // The table above is a literal list: renaming /schedule in App.tsx would leave it green while the tile sent people to a page that is not there. This reads the real route table.
  it('opens every action link to a path the app\'s route table (App.tsx) declares', () => {
    showAll()
    renderPage()

    // The guard itself: the table was found, a parameter segment matches, and a path nobody declared does not.
    expect(APP_ROUTES.length).toBeGreaterThan(40)
    expect(routeExists('/trips/abc')).toBe(true)
    expect(routeExists('/not-a-page')).toBe(false)
    const hrefs = within(band()).getAllByRole('link').map((a) => a.getAttribute('href')!)
    expect(hrefs).toHaveLength(EXPECTED.length)
    for (const href of hrefs) expect(routeExists(new URL(href, 'http://odip.test').pathname), href).toBe(true)
  })

  it('names filters the target pages actually read (?status= on Tasks, ?qsc= on Incidents), so a renamed parameter fails here', () => {
    const read = (file: string) => readFileSync(join(PAGES, file), 'utf8')
    expect(read('TasksPage.tsx')).toMatch(/searchParams\.get\('status'\)/)
    expect(read('IncidentsPage.tsx')).toMatch(/searchParams\.get\('qsc'\)\s*===\s*'overdue'/)
  })

  it('names the Schedule for vehicles and staff, where trips are assigned them, and the Trips list for accommodation, which is chosen on the trip', () => {
    showAll()
    renderPage()

    expect(within(tileFor('Missing vehicles')).getByRole('link')).toHaveAttribute('href', '/schedule')
    expect(within(tileFor('Missing staff')).getByRole('link')).toHaveAttribute('href', '/schedule')
    expect(within(tileFor('Missing accommodation')).getByRole('link')).toHaveAttribute('href', '/trips')
  })

  it('opens NDIS Commission overdue on the Incidents list already filtered to it, and Overdue on the Tasks list filtered to Overdue', () => {
    showAll()
    renderPage()

    expect(within(tileFor('NDIS Commission overdue')).getByRole('link')).toHaveAttribute('href', '/incidents?qsc=overdue')
    expect(within(tileFor('Overdue')).getByRole('link')).toHaveAttribute('href', '/tasks?status=Overdue')
  })

  it('keeps a count of one in the singular: "Trip starts", "1 staff member", "1 participant"', () => {
    asRole('SuperAdmin')
    mockUseStaff.mockReturnValue(staffWithOneIssue)
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [criticalAlertFor('p1', 'Jamie Smith')], isLoading: false })
    mockUseDashboard.mockReturnValue(summaryData({ tripsMissingAccommodation: 1, tripsMissingVehicles: 1, tripsMissingStaff: 1 }))
    renderPage()

    expect(tileFor('Missing accommodation')).toHaveTextContent('Trip starts within 60 days with no accommodation reserved.')
    expect(tileFor('Missing vehicles')).toHaveTextContent('Trip starts within 60 days with no vehicle assigned.')
    expect(tileFor('Missing staff')).toHaveTextContent('Trip starts within 60 days with no staff assigned.')
    expect(tileFor('Qualification issues')).toHaveTextContent('across 1 staff member.')
    expect(screen.getByRole('heading', { name: 'Critical participant alerts (1)' })).toBeInTheDocument()
    expect(screen.getByText('across 1 participant')).toBeInTheDocument()
  })

  it('states the warning window the Qualifications page uses (30 days unless the settings say otherwise), with the noun agreeing', () => {
    asRole('SuperAdmin')
    mockUseStaff.mockReturnValue(staffWithOneIssue)
    renderPage()
    expect(tileFor('Qualification issues')).toHaveTextContent('due within 30 days')
    cleanup()

    mockUseSettings.mockReturnValue({ data: { qualificationWarningDays: 90 } })
    renderPage()
    expect(tileFor('Qualification issues')).toHaveTextContent('due within 90 days')
    cleanup()

    mockUseSettings.mockReturnValue({ data: { qualificationWarningDays: 1 } })
    renderPage()
    expect(tileFor('Qualification issues')).toHaveTextContent('due within 1 day,')
  })
})

describe('DashboardPage — needs-attention band: tint and the All clear states', () => {
  it('tints a tile by its tone family: danger takes the error container, warning the warning container, everything in the on-container colour', () => {
    showAll()
    renderPage()

    // danger -> the error container; warning -> the warning container (the trip glance strip's own tints).
    const danger = ['Qualification issues', 'Budgets at risk', 'Overdue', 'NDIS Commission overdue']
    const warning = ['Missing accommodation', 'Missing vehicles', 'Missing staff', 'Open incidents', 'Pending leave', 'Shift completions']
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
    asRole('SuperAdmin')
    mockUseDashboard.mockReturnValue(summaryData({ overdueTaskCount: 2 }))
    renderPage()

    expect(tileLabels()).toEqual(['Overdue'])
    const row = clearRow()!
    expect(row).toHaveTextContent(
      'All clear on qualification issues, critical participant alerts, trips missing accommodation, trips missing vehicles, trips missing staff, open incidents, overdue NDIS Commission reports, pending leave and shift completions',
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
      'All clear on qualification issues, trips missing accommodation, trips missing vehicles, trips missing staff, open incidents and overdue NDIS Commission reports',
    )
    expect(clearRow()).not.toHaveTextContent('critical participant alerts')
    expect(clearRow()).not.toHaveTextContent('pending leave')
    expect(clearRow()).not.toHaveTextContent('shift completions')
  })

  it('becomes one full-width Pale Sprout field when everything is zero: "All clear. Nothing needs you right now."', () => {
    asRole('SuperAdmin')
    renderPage()

    const field = screen.getByText('All clear. Nothing needs you right now.').closest('div.rounded-md') as HTMLElement
    expect(field).toHaveClass('bg-[var(--color-primary-fixed)]', 'text-[var(--color-on-primary-fixed)]')
    // The field stands in place of the band: no band, no link, no second row.
    expect(screen.queryByRole('region', { name: 'Alerts' })).not.toBeInTheDocument()
    expect(within(field).queryAllByRole('link')).toHaveLength(0)
    expect(clearRow()).toBeNull()
    // It names everything it checked, so the claim can be audited.
    expect(screen.getByText(
      'Checked and at zero: qualification issues, critical participant alerts, overdue tasks, trips missing accommodation, trips missing vehicles, trips missing staff, open incidents, overdue NDIS Commission reports, pending leave and shift completions.',
    )).toBeInTheDocument()
  })

  it('stays one field, naming what it checked, for a role with fewer items', () => {
    asRole('ReadOnly')
    renderPage()

    expect(screen.getByText('All clear. Nothing needs you right now.')).toBeInTheDocument()
    expect(screen.getByText('Checked and at zero: qualification issues, overdue tasks, trips missing accommodation, trips missing vehicles, trips missing staff, open incidents and overdue NDIS Commission reports.')).toBeInTheDocument()
  })

  it('tints nothing when every item is zero: no container fill but the one Pale Sprout field', () => {
    asRole('SuperAdmin')
    renderPage()

    expect(document.body.innerHTML).not.toContain('error-container)]')
    expect(document.body.innerHTML).not.toContain('warning-container)]')
    expect(document.querySelectorAll('[data-attention]')).toHaveLength(0)
  })

  it('goes back to tiles the moment something is above zero: the field is not sticky', () => {
    asRole('SuperAdmin')
    const { rerender } = renderPage()
    expect(screen.getByText('All clear. Nothing needs you right now.')).toBeInTheDocument()

    mockUseDashboard.mockReturnValue(summaryData({ qscOverdueCount: 1 }))
    rerender(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
    expect(tileLabels()).toEqual(['NDIS Commission overdue'])
    expect(clearRow()).toHaveTextContent('All clear on qualification issues')
  })

  it('draws no All clear row, and no Pale Sprout at all, while every item needs you', () => {
    showAll()
    renderPage()

    expect(screen.queryByText('All clear')).not.toBeInTheDocument()
    expect(band().innerHTML).not.toMatch(/primary-fixed/)
  })
})

describe('DashboardPage — the Schedule links say what the role can do', () => {
  const scheduleLinks = () => ['Missing vehicles', 'Missing staff'].map((label) => within(tileFor(label)).getByRole('link'))

  it('offers "Assign vehicles" and "Assign staff" to the roles that can write, both to the Schedule', () => {
    mockUseDashboard.mockReturnValue(summaryData({ tripsMissingVehicles: 1, tripsMissingStaff: 2 }))
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator']) {
      asRole(role)
      const { unmount } = renderPage()
      expect(scheduleLinks().map((a) => a.textContent), role).toEqual(['Assign vehicles', 'Assign staff'])
      expect(scheduleLinks().map((a) => a.getAttribute('href')), role).toEqual(['/schedule', '/schedule'])
      unmount()
      localStorage.clear()
    }
  })

  // ReadOnly reaches the dashboard and the Schedule (canWrite is false for it, and the server then refuses the write), so a verb it cannot use is a promise the page breaks.
  it('offers ReadOnly "Open schedule" for both, the same page with no verb it cannot use', () => {
    asRole('ReadOnly')
    mockUseDashboard.mockReturnValue(summaryData({ tripsMissingVehicles: 1, tripsMissingStaff: 2 }))
    renderPage()

    expect(scheduleLinks().map((a) => a.textContent)).toEqual(['Open schedule', 'Open schedule'])
    expect(scheduleLinks().map((a) => a.getAttribute('href'))).toEqual(['/schedule', '/schedule'])
    expect(screen.queryByRole('link', { name: /Assign/ })).not.toBeInTheDocument()
  })

  it('leaves every other link\'s wording alone for ReadOnly', () => {
    asRole('ReadOnly')
    mockUseStaff.mockReturnValue(staffWithOneIssue)
    mockUseDashboard.mockReturnValue(summaryData({ overdueTaskCount: 1, tripsMissingAccommodation: 1, openIncidentCount: 1, qscOverdueCount: 1 }))
    renderPage()

    expect(within(band()).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Review qualifications', 'Open overdue tasks', 'Open trips', 'Open incidents', 'Review NDIS Commission reports',
    ])
  })
})

describe('DashboardPage — the All clear row and field name the items by nouns', () => {
  it('says "overdue tasks" and "overdue NDIS Commission reports": the tile labels "Overdue" and "NDIS Commission overdue" read as the same thing once they leave their tiles', () => {
    asRole('SuperAdmin')
    mockUseDashboard.mockReturnValue(summaryData({ tripsMissingStaff: 1 }))
    renderPage()

    expect(clearRow()).toHaveTextContent('overdue tasks')
    expect(clearRow()).toHaveTextContent('overdue NDIS Commission reports')
    expect(clearRow()!.textContent).not.toMatch(/Overdue/)
  })

  it('says the three trip counts are of trips: "trips missing staff", never a bare "missing staff"', () => {
    asRole('SuperAdmin')
    mockUseDashboard.mockReturnValue(summaryData({ overdueTaskCount: 1 }))
    renderPage()

    expect(clearRow()).toHaveTextContent('trips missing accommodation, trips missing vehicles, trips missing staff')
    expect(clearRow()!.textContent).not.toMatch(/(?<!trips )missing/)
  })

  it('uses the same nouns in the all-clear field\'s audit line', () => {
    asRole('SuperAdmin')
    renderPage()

    expect(screen.getByText(/^Checked and at zero: qualification issues, critical participant alerts, overdue tasks, trips missing accommodation/)).toBeInTheDocument()
    expect(screen.getByText(/overdue NDIS Commission reports, pending leave and shift completions\.$/)).toBeInTheDocument()
  })

  it('leaves the tile labels exactly as they are', () => {
    showAll()
    renderPage()

    expect(tileLabels()).toEqual(FULL_ORDER.filter((label) => label !== 'Critical participant alerts'))
    expect(screen.getByRole('group', { name: 'Overdue 3' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'NDIS Commission overdue 3' })).toBeInTheDocument()
  })
})

describe('DashboardPage — needs-attention band: accessibility', () => {
  it('is one labelled region, with a link for each action whose name says what it does, and the number and the label in every tile\'s name', () => {
    showAll()
    renderPage()

    expect(screen.getByRole('region', { name: 'Alerts' })).toBe(band())
    for (const link of within(band()).getAllByRole('link')) expect(link).toHaveAccessibleName()
    const names = within(band()).getAllByRole('group').map((group) => group.getAttribute('aria-label'))
    expect(names).toEqual(FULL_ORDER.filter((label) => label !== 'Critical participant alerts').map((label) => `${label} 3`))
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
    for (const setUp of [showAll, () => asRole('SuperAdmin')]) {
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
    asRole('SuperAdmin')
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
  it('never truncates, scrolls sideways or shrinks the type in the band', () => {
    showAll()
    renderPage()

    expect(band().innerHTML).not.toMatch(/overflow|truncate|line-clamp/)
  })
})
