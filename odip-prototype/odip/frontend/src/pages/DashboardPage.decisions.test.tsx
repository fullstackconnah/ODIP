import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { mockUseDashboard, mockUseDecisionGroups } from './dashboard/dashboardHookMocks'
import { asRole, installDashboardDefaults, renderPage, showAll, summaryData, tileLabels } from './dashboard/dashboardTestKit'
import type { GroupKey, GroupModel, QuickRow } from './dashboard/quickGroup'

vi.mock('@/api/hooks', async () => (await import('./dashboard/dashboardHookMocks')).hooks)
vi.mock('./dashboard/useDecisionGroups', async () => ({ useDecisionGroups: (await import('./dashboard/dashboardHookMocks')).mockUseDecisionGroups }))

installDashboardDefaults()

const NOUNS: Record<GroupKey, string> = {
  completions: 'shift completions', leave: 'leave requests', incidents: 'open incidents', tasks: 'tasks due', compliance: 'staff credentials to update',
}
const row = (id: string): QuickRow => ({ id, subject: `Person ${id}`, meta: [], flags: [], actions: [] })
const group = (key: GroupKey, o: Partial<GroupModel> = {}): GroupModel => ({
  key, title: key, noun: NOUNS[key], phase: 'ready', refetch: vi.fn(), count: 0, rows: [], link: { to: `/${key}`, openLabel: `Open ${key}` }, ...o,
})
const h2s = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
const ALL_GATES = { completions: true, leave: true, incidents: true, tasks: true, compliance: true, needsOrganisation: false }

describe('DashboardPage — who decides what (SHAPE §3)', () => {
  it('passes an Admin every gate, its id, today and the budget-review right', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin', id: 'u-admin' }))
    renderPage()

    expect(mockUseDecisionGroups).toHaveBeenLastCalledWith(ALL_GATES, expect.objectContaining({ viewerId: 'u-admin', warningDays: 30, mayCloseBudgetReview: true }))
  })

  it('tells the groups a Coordinator may not close the review of an emergency', () => {
    asRole('Coordinator')
    renderPage()

    expect(mockUseDecisionGroups).toHaveBeenLastCalledWith(ALL_GATES, expect.objectContaining({ mayCloseBudgetReview: false }))
  })

  it('gives a Coordinator at most the five alert tiles: no moved item is a tile for a viewer who has its group', () => {
    showAll()
    asRole('Coordinator')
    renderPage()

    expect(tileLabels()).toEqual(['Critical Participant Alerts', 'Budgets at risk', 'Missing Accommodation', 'Missing Vehicles', 'Missing Staff'])
  })

  it('shows ReadOnly no decisions at all: no heading, no line', () => {
    asRole('ReadOnly')
    mockUseDashboard.mockReturnValue(summaryData({ overdueTaskCount: 1 }))
    renderPage()

    expect(screen.queryByRole('heading', { name: 'Needs your decision' })).not.toBeInTheDocument()
    expect(mockUseDecisionGroups).toHaveBeenLastCalledWith({ ...ALL_GATES, completions: false, leave: false, incidents: false, tasks: false, compliance: false }, expect.anything())
    expect(tileLabels()).toEqual(['Overdue'])
  })

  it('asks a SuperAdmin with no organisation to choose one, and keeps all eleven tiles counted across every organisation', () => {
    showAll()
    renderPage()

    expect(screen.getByRole('heading', { level: 2, name: 'Needs your decision' })).toBeInTheDocument()
    expect(screen.getByText('Choose an organisation to see its approvals.')).toBeInTheDocument()
    expect(tileLabels()).toHaveLength(11)
  })

  it('decides as an Admin does for a SuperAdmin viewing an organisation', () => {
    asRole('SuperAdmin')
    localStorage.setItem('odip_viewing_tenant', 'tenant-1')
    renderPage()

    expect(mockUseDecisionGroups).toHaveBeenLastCalledWith(ALL_GATES, expect.objectContaining({ mayCloseBudgetReview: true }))
    expect(screen.queryByText('Choose an organisation to see its approvals.')).not.toBeInTheDocument()
  })
})

describe('DashboardPage — the order of the page (SHAPE §3)', () => {
  it('orders the page: the greeting, Needs your decision, Alerts, Upcoming trips', () => {
    asRole('Admin')
    mockUseDecisionGroups.mockReturnValue([group('leave', { count: 1, rows: [row('a')] })])
    mockUseDashboard.mockReturnValue(summaryData({ overdueTaskCount: 1 }))
    renderPage()

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(h2s()).toEqual(['Needs your decision', 'Alerts', 'Upcoming trips'])
    expect(screen.getByRole('heading', { level: 2, name: 'Alerts' })).toHaveAttribute('tabindex', '-1')
  })

  it('runs Upcoming trips the full width, as an h2 section after Alerts, and has no Overdue Tasks panel', () => {
    asRole('Admin')
    const { container } = renderPage()

    expect(screen.queryByRole('heading', { name: 'Overdue Tasks' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Upcoming trips' })).toBeInTheDocument()
    expect(container.querySelector('[class*="xl:grid-cols-2"]')).toBeNull()
  })

  it('holds one polite AnnouncementRegion for a viewer with groups, ahead of the groups', () => {
    asRole('Admin')
    mockUseDecisionGroups.mockReturnValue([group('leave', { count: 1, rows: [row('a')] })])
    renderPage()

    const region = document.querySelector('.sr-only[role="status"][aria-live="polite"]')!
    expect(region).not.toBeNull()
    expect(region.compareDocumentPosition(screen.getByRole('heading', { name: 'Needs your decision' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('DashboardPage — the summary no longer holds the page hostage (SHAPE §6)', () => {
  it('keeps the groups deciding while the summary fails: its error and Try again sit in the Alerts slot', () => {
    asRole('Admin')
    const refetch = vi.fn()
    mockUseDashboard.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    mockUseDecisionGroups.mockReturnValue([group('leave', { count: 1, rows: [row('a')] })])
    renderPage()

    expect(screen.getByText('Person a')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this dashboard summary.")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Upcoming trips' })).not.toBeInTheDocument()
  })

  it('shows the spinner in the Alerts slot, under its heading, while the groups render above it', () => {
    asRole('Admin')
    mockUseDashboard.mockReturnValue({ data: undefined, isPending: true, isLoading: true, isError: false })
    mockUseDecisionGroups.mockReturnValue([group('leave', { count: 1, rows: [row('a')] })])
    const { container } = renderPage()

    const spinner = container.querySelector('.animate-spin')!
    expect(screen.getByRole('heading', { level: 2, name: 'Alerts' }).compareDocumentPosition(spinner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Person a')).toBeInTheDocument()
  })
})

describe('DashboardPage — groups at zero (SHAPE §6)', () => {
  it('names the groups at zero in one All clear row at the foot of the card, and never a waiting or failed one', () => {
    asRole('Admin')
    mockUseDecisionGroups.mockReturnValue([
      group('completions', { count: 1, rows: [row('a')] }), group('leave'), group('incidents', { phase: 'loading' }), group('tasks', { phase: 'error' }), group('compliance'),
    ])
    renderPage()

    // Scoped to the decisions: the band below draws its own All clear row (its alerts are at zero here).
    const decisions = screen.getByRole('heading', { level: 2, name: 'Needs your decision' }).parentElement!
    const foot = within(decisions).getByText('All clear', { selector: 'span.font-semibold' }).closest('p')!
    expect(foot).toHaveTextContent('All clear on leave requests and staff credentials to update')
    expect(screen.getByText('Loading open incidents…')).toBeInTheDocument()
    expect(screen.getByText("Couldn't load tasks due.")).toBeInTheDocument()
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it('shows only the All clear row under Needs your decision when every group is at zero but an alert is not, and the band below it', () => {
    asRole('Admin')
    mockUseDecisionGroups.mockReturnValue((Object.keys(NOUNS) as GroupKey[]).map((key) => group(key)))
    mockUseDashboard.mockReturnValue(summaryData({ tripsMissingStaff: 2 }))
    renderPage()

    const decisions = screen.getByRole('heading', { level: 2, name: 'Needs your decision' }).parentElement!
    expect(within(decisions).getByText(/^All clear/).closest('p')).toHaveTextContent(
      'All clear on shift completions, leave requests, open incidents, tasks due and staff credentials to update')
    expect(within(decisions).queryAllByRole('listitem')).toHaveLength(0)
    expect(tileLabels()).toEqual(['Missing Staff'])
  })
})

describe('DashboardPage — the whole page clear (SHAPE §6)', () => {
  const allClearGroups = () => (Object.keys(NOUNS) as GroupKey[]).map((key) => group(key))

  it('turns into the one field when every group and every alert has data and is at zero, naming them all, with no section headings', () => {
    asRole('Admin')
    mockUseDecisionGroups.mockReturnValue(allClearGroups())
    renderPage()

    expect(screen.getByText('All clear. Nothing needs you right now.')).toBeInTheDocument()
    expect(screen.getByText('Checked and at zero: shift completions, leave requests, open incidents, tasks due, staff credentials to update, critical participant alerts, trips missing accommodation, trips missing vehicles and trips missing staff.')).toBeInTheDocument()
    expect(h2s()).toEqual(['Upcoming trips'])
  })

  it('never says it while a group is waiting or has failed', () => {
    asRole('Admin')
    for (const phase of ['loading', 'error'] as const) {
      mockUseDecisionGroups.mockReturnValue([...allClearGroups().slice(1), group('completions', { phase })])
      const { unmount } = renderPage()
      expect(screen.queryByText('All clear. Nothing needs you right now.'), phase).not.toBeInTheDocument()
      unmount()
    }
  })

  it('waits for a held notice to be dismissed before it says it', async () => {
    asRole('Admin')
    const notice = { title: 'Person a', message: 'Leave approved. It overlaps 1 shift, and it has a cover task.', link: { label: 'Open roster', to: '/rostering' } }
    const approve = { kind: 'tap' as const, label: 'Approve', busyLabel: 'Approving…', name: 'Approve leave: Person a', failText: "Couldn't approve. Try again.", run: async () => ({ notice }) }
    mockUseDecisionGroups.mockReturnValue([...allClearGroups().filter((g) => g.key !== 'leave'), group('leave', { count: 1, rows: [{ ...row('a'), actions: [approve] }] })])
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Approve leave: Person a' }))
    expect(await screen.findByText(notice.message)).toBeInTheDocument()
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice about Person a' }))
    expect(await screen.findByText('All clear. Nothing needs you right now.')).toBeInTheDocument()
  })
})

describe('DashboardPage — focus when a group leaves the page (SHAPE §10)', () => {
  const tap = (id: string) => ({ kind: 'tap' as const, label: 'Approve', busyLabel: 'Approving…', name: `Approve: Person ${id}`, failText: "Couldn't approve. Try again.", run: async () => ({ announce: `Approved Person ${id}.` }) })

  it("moves focus to the next group's link when a group's last row leaves", async () => {
    asRole('Admin')
    mockUseDashboard.mockReturnValue(summaryData({ tripsMissingStaff: 1 }))
    mockUseDecisionGroups.mockReturnValue([
      group('completions', { count: 1, rows: [{ ...row('a'), actions: [tap('a')] }] }),
      group('leave', { count: 1, rows: [row('b')] }),
    ])
    renderPage()
    const button = screen.getByRole('button', { name: 'Approve: Person a' })
    button.focus()

    fireEvent.click(button)

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Open leave' })))
  })

  it('moves focus to the Alerts heading when the last group leaves the page', async () => {
    asRole('Admin')
    mockUseDashboard.mockReturnValue(summaryData({ tripsMissingStaff: 1 }))
    mockUseDecisionGroups.mockReturnValue([group('completions', { count: 1, rows: [{ ...row('a'), actions: [tap('a')] }] })])
    renderPage()
    const button = screen.getByRole('button', { name: 'Approve: Person a' })
    button.focus()

    fireEvent.click(button)

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Alerts' })))
    expect(document.querySelector('.sr-only[role="status"]')).toHaveTextContent('Approved Person a.')
  })

  it('moves focus to the All clear field when the last decision turns the whole page clear, never to the top of the page', async () => {
    asRole('Admin')
    mockUseDecisionGroups.mockReturnValue([group('completions', { count: 1, rows: [{ ...row('a'), actions: [tap('a')] }] })])
    renderPage()
    const button = screen.getByRole('button', { name: 'Approve: Person a' })
    button.focus()

    fireEvent.click(button)

    const field = await screen.findByText('All clear. Nothing needs you right now.')
    expect(document.activeElement).toBe(document.getElementById('dashboard-alerts'))
    expect(document.activeElement).toContainElement(field)
    expect(document.querySelector('.sr-only[role="status"]')).toHaveTextContent('Approved Person a.')
  })
})
