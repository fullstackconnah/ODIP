import { describe, it, expect, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from './DashboardPage'
import { mockUseDashboard, mockUseStaff, mockUseParticipantAlertsAggregate, mockUsePendingLeaveQueue, mockUsePendingCompletionQueue } from './dashboard/dashboardHookMocks'
import { installDashboardDefaults, renderPage, summaryData, asRole, pendingLeave, pendingCompletions, criticalAlertFor, staffWithOneIssue, threeAlertsOnTwoParticipantsAndThreeBudgetsAtRisk, showAll, band, tiles, tileLabels, tileFor, clearRow, routeExists } from './dashboard/dashboardTestKit'

vi.mock('@/api/hooks', async () => (await import('./dashboard/dashboardHookMocks')).hooks)

installDashboardDefaults()

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
    expect(screen.getByText(/^Checked and at zero:.*pending leave/)).toBeInTheDocument()
  })

  it('does not call the queue clear while it is still loading, or after it failed (its count is 0 in both)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })

    mockUsePendingLeaveQueue.mockReturnValue(pendingLeave(0, { loading: true }))
    const { unmount } = renderPage()
    expect(screen.getByRole('link', { name: 'Pending Leave Loading' })).toHaveAttribute('href', '/rostering/leave')
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
    expect(screen.getByText('All clear', { selector: 'span.font-semibold' }).closest('p')).not.toHaveTextContent('pending leave')
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
    expect(clearNames()).not.toMatch(/qualification issues/)
    expect(clearNames()).toMatch(/critical participant alerts/)
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it('shows an en dash and "Couldn\'t load" on Qualification Issues when the staff request fails: not busy, no "All clear"', () => {
    asRole('Coordinator')
    mockUseStaff.mockReturnValue(failed)
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    expectPlaceholder(qualification(), { busy: false, say: "Couldn't load" })
    expect(within(band()).getByRole('link', { name: "Qualification Issues Couldn't load" })).toHaveAttribute('href', '/qualifications')
    expect(clearNames()).not.toMatch(/qualification issues/)
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it('shows an en dash and "Couldn\'t load" on Critical Participant Alerts when the alerts request fails: not busy, no "All clear"', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue(failed)
    renderPage()

    expectPlaceholder(alerts(), { busy: false, say: "Couldn't load" })
    expect(within(band()).getByRole('link', { name: "Critical Participant Alerts Couldn't load" })).toHaveAttribute('href', '/participants')
    expect(clearNames()).not.toMatch(/critical participant alerts/)
    expect(clearNames()).toMatch(/qualification issues/)
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
    expect(clearNames()).not.toMatch(/pending leave/)
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
    expect(clearNames()).toBe('All clear on overdue tasks, trips missing accommodation, trips missing vehicles, trips missing staff, open incidents and overdue QSC reports')
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
    expect(clearNames()).not.toMatch(/qualification issues|critical participant alerts|pending leave|shift completions/)
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
    expect(clearNames()).toMatch(/qualification issues/)
    expect(clearNames()).toMatch(/pending leave/)
    expect(within(band()).queryByText("Couldn't load")).not.toBeInTheDocument()

    // Later the staff list is refreshed with an expiring credential: the item is a tile, not clear.
    mockUseStaff.mockReturnValue({ ...staffWithOneIssue, isLoading: false, isError: false })
    rerender(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(qualification()).toHaveAttribute('data-attention', 'error')
    expect(within(qualification()).getByText('1')).toBeInTheDocument()
    expect(clearNames()).not.toMatch(/qualification issues/)
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
      'All clear on qualification issues, critical participant alerts, overdue tasks, trips missing accommodation, trips missing vehicles, trips missing staff, open incidents, overdue QSC reports and pending leave',
    )
    expect(clearRow()).not.toHaveTextContent('shift completions')
  })

  it('names Shift Completions among the items it checked once the queue is empty', () => {
    asRole('Coordinator')
    mockUsePendingCompletionQueue.mockReturnValue(pendingCompletions(0))
    renderPage()

    expect(screen.getByText('All clear. Nothing needs you right now.')).toBeInTheDocument()
    expect(screen.getByText(/^Checked and at zero:.*shift completions\.$/)).toBeInTheDocument()
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
    expect(clearRow()).not.toHaveTextContent('shift completions')
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

// Budgets at risk (budget phase 2b): one more item in the page's existing needs-attention band, counted from the participant alerts the page already reads. A tile only when somebody is over or forecast
// to go over; at zero a name in the All clear row; while the alerts load or fail no tile at all (the Critical Participant Alerts tile, from the same request, is already the en dash that says so).
describe('DashboardPage — Budgets at risk (budget phase 2b)', () => {
  const critical = (type: string) => type === 'budget-over' || type === 'budget-ndia-exhausted'
  const budgetParticipant = (id: string, name: string, type: string, extra: Record<string, unknown> = {}) => ({
    participantId: id, participantName: name, isActive: true,
    criticalCount: critical(type) ? 1 : 0, warningCount: critical(type) ? 0 : 1, infoCount: 0,
    alerts: [{ type, severity: critical(type) ? 'Critical' : 'Warning', message: `${name}: ${type}`, deepLinkTab: 'funding' }],
    ...extra,
  })
  const withAlerts = (...data: Array<ReturnType<typeof budgetParticipant>>) => mockUseParticipantAlertsAggregate.mockReturnValue({ data, isLoading: false })
  const budgetTile = () => tileFor('Budgets at risk')

  it('is a tile whose figure is the participants over or forecast to go over, with the line "{n} participants: {a} over, {b} forecast to go over" and a link to the Budgets list', () => {
    asRole('Coordinator')
    withAlerts(budgetParticipant('p1', 'Olive Over', 'budget-over'), budgetParticipant('p2', 'Olga Over', 'budget-over'), budgetParticipant('p3', 'Ford Cast', 'budget-forecast-over'))
    renderPage()

    expect(budgetTile()).toHaveAccessibleName('Budgets at risk 3')
    expect(budgetTile()).toHaveTextContent('3 participants: 2 over, 1 forecast to go over')
    expect(within(budgetTile()).getByRole('link', { name: 'Review budgets' })).toHaveAttribute('href', '/budgets')
  })

  it('is in the danger tone when any participant is already over', () => {
    asRole('Coordinator')
    withAlerts(budgetParticipant('p1', 'Olive Over', 'budget-over'), budgetParticipant('p3', 'Ford Cast', 'budget-forecast-over'))
    renderPage()

    expect(budgetTile()).toHaveAttribute('data-attention', 'error')
  })

  it('is in the warning tone when nobody is over and some are only forecast to go over', () => {
    asRole('Coordinator')
    withAlerts(budgetParticipant('p3', 'Ford Cast', 'budget-forecast-over'), budgetParticipant('p4', 'Fern Cast', 'budget-forecast-over'))
    renderPage()

    expect(budgetTile()).toHaveAttribute('data-attention', 'warning')
    expect(budgetTile()).toHaveTextContent('2 participants forecast to go over')
    expect(budgetTile()).not.toHaveTextContent('0 over')   // a clause that is zero is dropped
  })

  it('counts a participant once however many pools are at risk, in their worst state', () => {
    asRole('Coordinator')
    withAlerts(budgetParticipant('p1', 'Two Pools', 'budget-forecast-over', {
      alerts: [
        { type: 'budget-forecast-over', severity: 'Warning', message: 'Pool A', deepLinkTab: 'funding' },
        { type: 'budget-over', severity: 'Critical', message: 'Pool B', deepLinkTab: 'funding' },
      ],
    }))
    renderPage()

    expect(budgetTile()).toHaveAccessibleName('Budgets at risk 1')
    expect(budgetTile()).toHaveTextContent('1 participant over')
    expect(budgetTile()).not.toHaveTextContent('0 forecast')
  })

  // At zero the band names an item in its All clear row, "checked, and nothing": true only of a budget somebody has recorded. A participant on track has no alert, so the alerts say who has a budget in
  // force (budgetInForce), and the item is named only where somebody does.
  it('is not a tile at zero, and is a name in the one All clear row instead, where a budget is in force; approaching does not make it a tile', () => {
    asRole('Coordinator')
    withAlerts(budgetParticipant('p1', 'Appa Roach', 'budget-approaching', { budgetInForce: true }), budgetParticipant('p2', 'Ontrack Olive', 'budget-approaching', { budgetInForce: true, alerts: [], warningCount: 0 }))
    renderPage()

    // Everything else is at zero too, so the whole band is the all-clear field, and it names the budgets among what it checked.
    expect(screen.queryByRole('group', { name: /Budgets at risk/ })).not.toBeInTheDocument()
    expect(screen.getByText(/^Checked and at zero:/)).toHaveTextContent('budgets over or forecast to go over')
  })

  it('is not named at all where no budget is in force for anybody: the band cannot say it checked what nobody recorded', () => {
    asRole('Coordinator')
    withAlerts(budgetParticipant('p1', 'No Plan', 'plan-expiring-soon', { budgetInForce: false }), budgetParticipant('p2', 'Older Answer', 'plan-expiring-soon'))
    renderPage()

    expect(screen.queryByRole('group', { name: /Budgets at risk/ })).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/budgets/i)
  })

  it('is not named at zero while the NDIA says the funds ran out for somebody: an all clear about budgets would contradict the Critical tile beside it', () => {
    asRole('Coordinator')
    withAlerts(budgetParticipant('p1', 'Noor Refused', 'budget-ndia-exhausted', { budgetInForce: true }))
    renderPage()

    expect(tileLabels()).toContain('Critical Participant Alerts')
    expect(tileLabels()).not.toContain('Budgets at risk')
    expect(band()).not.toHaveTextContent(/budgets over or forecast to go over/)
  })

  it('is still a tile when somebody is over, whether or not the NDIA has also refused a claim', () => {
    asRole('Coordinator')
    withAlerts(budgetParticipant('p1', 'Olive Over', 'budget-over', { budgetInForce: true }), budgetParticipant('p2', 'Noor Refused', 'budget-ndia-exhausted', { budgetInForce: true }))
    renderPage()

    expect(budgetTile()).toHaveAccessibleName('Budgets at risk 1')
  })

  it('is not a tile while the alerts are loading, and the band is not an all clear: the Critical alerts tile is the en dash that says so', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: undefined, isPending: true, isLoading: true, isError: false })
    renderPage()

    expect(tileLabels()).toEqual(['Critical Participant Alerts'])
    expect(tileFor('Critical Participant Alerts')).toHaveAttribute('aria-busy', 'true')
    expect(band()).not.toHaveTextContent('Budgets at risk')
    expect(band()).not.toHaveTextContent('budgets at risk')
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it('is not a tile when the alerts failed to load, and the band is not an all clear', () => {
    asRole('Coordinator')
    mockUseParticipantAlertsAggregate.mockReturnValue({ data: undefined, isLoading: false, isError: true })
    renderPage()

    expect(tileLabels()).toEqual(['Critical Participant Alerts'])
    expect(within(tileFor('Critical Participant Alerts')).getByText("Couldn't load")).toBeInTheDocument()
    expect(band()).not.toHaveTextContent('Budgets at risk')
    expect(band()).not.toHaveTextContent('budgets at risk')
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it('leaves out an archived participant', () => {
    asRole('Coordinator')
    withAlerts(budgetParticipant('p1', 'Archie Gone', 'budget-over', { isActive: false }))
    renderPage()

    // Nobody counts, not even as having a budget in force, so the whole band is the all-clear field and it does not name budgets among what it checked.
    expect(screen.getByText(/^Checked and at zero:/)).not.toHaveTextContent(/budgets/)
    expect(screen.queryByRole('group', { name: /Budgets at risk/ })).not.toBeInTheDocument()
  })

  it('is offered only to a role that can open the Budgets list: SuperAdmin, Admin and Coordinator', () => {
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator']) {
      asRole(role)
      withAlerts(budgetParticipant('p1', 'Olive Over', 'budget-over'))
      const { unmount } = renderPage()
      expect(tileLabels(), role).toContain('Budgets at risk')
      unmount()
      localStorage.clear()
    }
    for (const role of ['ReadOnly', 'SupportWorker']) {
      asRole(role)
      withAlerts(budgetParticipant('p1', 'Olive Over', 'budget-over'))
      const { unmount } = renderPage()
      expect(screen.queryByText(/budgets at risk/i), role).not.toBeInTheDocument()
      unmount()
      localStorage.clear()
    }
  })

  it('links to a route the app really has', () => {
    asRole('Coordinator')
    withAlerts(budgetParticipant('p1', 'Olive Over', 'budget-over'))
    renderPage()

    expect(routeExists(new URL(within(budgetTile()).getByRole('link', { name: 'Review budgets' }).getAttribute('href')!, 'http://odip.test').pathname)).toBe(true)
  })

  describe('and the Critical alerts beside it', () => {
    it('does not count an over-budget alert a second time: the tile is where "over" reaches the dashboard', () => {
      asRole('Coordinator')
      withAlerts(budgetParticipant('p1', 'Olive Over', 'budget-over', { alerts: [{ type: 'budget-over', severity: 'Critical', message: 'Core is $1,000 over this period\'s $8,000 (to 31 Dec 2026)', deepLinkTab: 'funding' }] }))
      renderPage()

      expect(budgetTile()).toHaveAccessibleName('Budgets at risk 1')
      expect(tileLabels()).not.toContain('Critical Participant Alerts')   // its only Critical alert is the one the budget tile counts
      expect(screen.queryByText('Core is $1,000 over this period\'s $8,000 (to 31 Dec 2026)')).not.toBeInTheDocument()   // nor is it listed with the Critical alerts below the band
    })

    it('still counts and lists the NDIA’s "the funds ran out" alert, a different fact, as a Critical alert', () => {
      asRole('Coordinator')
      withAlerts(budgetParticipant('p1', 'Noor Refused', 'budget-ndia-exhausted', {
        alerts: [{ type: 'budget-ndia-exhausted', severity: 'Critical', message: 'NDIA rejected a claim for Core on 8 Oct 2026: not enough funds in the funding period (V27)', deepLinkTab: 'funding' }],
      }))
      renderPage()

      expect(tileFor('Critical Participant Alerts')).toHaveAccessibleName('Critical Participant Alerts 1')
      expect(tileLabels()).not.toContain('Budgets at risk')
      expect(screen.getByText('NDIA says the funds ran out')).toBeInTheDocument()
      const card = screen.getByText('NDIA rejected a claim for Core on 8 Oct 2026: not enough funds in the funding period (V27)').closest('a')!
      expect(card).toHaveAttribute('href', '/participants/p1?tab=funding')
    })

    it('counts a participant who is both over and refused once in each tile, for two different facts', () => {
      asRole('Coordinator')
      withAlerts(budgetParticipant('p1', 'Both', 'budget-over', {
        criticalCount: 2,
        alerts: [
          { type: 'budget-ndia-exhausted', severity: 'Critical', message: 'Core: NDIA rejected a claim', deepLinkTab: 'funding' },
          { type: 'budget-over', severity: 'Critical', message: 'Core is over', deepLinkTab: 'funding' },
        ],
      }))
      renderPage()

      expect(budgetTile()).toHaveAccessibleName('Budgets at risk 1')
      expect(tileFor('Critical Participant Alerts')).toHaveAccessibleName('Critical Participant Alerts 1')
    })

    it('keeps counting the Critical alerts that are not about budgets, as before', () => {
      asRole('Coordinator')
      mockUseParticipantAlertsAggregate.mockReturnValue(threeAlertsOnTwoParticipantsAndThreeBudgetsAtRisk)
      renderPage()

      expect(tileFor('Critical Participant Alerts')).toHaveAccessibleName('Critical Participant Alerts 3')
      expect(tileFor('Critical Participant Alerts')).toHaveTextContent('Critical alerts across 2 participants')
      expect(budgetTile()).toHaveAccessibleName('Budgets at risk 3')
    })
  })
})
