import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { mockUseDashboard } from './dashboard/dashboardHookMocks'
import { installDashboardDefaults, renderPage, summaryData, asRole, tileLabels, tileFor } from './dashboard/dashboardTestKit'

vi.mock('@/api/hooks', async () => (await import('./dashboard/dashboardHookMocks')).hooks)
vi.mock('./dashboard/useDecisionGroups', async () => ({ useDecisionGroups: (await import('./dashboard/dashboardHookMocks')).mockUseDecisionGroups }))

installDashboardDefaults()

describe('DashboardPage: RP monthly reports overdue tile', () => {
  it('is a danger tile linking to the monthly reports tab, with the server count, for a role that can lodge them', () => {
    asRole('Coordinator')
    mockUseDashboard.mockReturnValue(summaryData({ rpMonthlyReportsOverdueCount: 2 }))
    renderPage()

    expect(tileLabels()).toContain('RP monthly reports overdue')
    const tile = tileFor('RP monthly reports overdue')
    expect(within(tile).getByText('2')).toBeInTheDocument()
    expect(within(tile).getByRole('link', { name: /Open monthly reports/ })).toHaveAttribute('href', '/incidents?view=rp-reports')
  })

  it('is not a tile at zero, or when the summary has no figure', () => {
    asRole('Coordinator')
    mockUseDashboard.mockReturnValue(summaryData({ rpMonthlyReportsOverdueCount: 0 }))
    renderPage()
    expect(screen.queryByText(/RP monthly reports overdue/)).not.toBeInTheDocument()
  })

  it('is not shown to a role that cannot lodge them, whatever the figure', () => {
    asRole('ReadOnly')
    mockUseDashboard.mockReturnValue(summaryData({ rpMonthlyReportsOverdueCount: 2 }))
    renderPage()
    expect(screen.queryByText(/RP monthly reports overdue/)).not.toBeInTheDocument()
  })
})
