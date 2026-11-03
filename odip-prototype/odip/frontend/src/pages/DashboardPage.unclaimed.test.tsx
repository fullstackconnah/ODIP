import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { mockUseUnclaimedShifts } from './dashboard/dashboardHookMocks'
import { installDashboardDefaults, renderPage, asRole, unclaimedShifts, tileLabels, clearRow } from './dashboard/dashboardTestKit'

vi.mock('@/api/hooks', async () => (await import('./dashboard/dashboardHookMocks')).hooks)
vi.mock('./dashboard/useDecisionGroups', async () => ({ useDecisionGroups: (await import('./dashboard/dashboardHookMocks')).mockUseDecisionGroups }))

installDashboardDefaults()

// The Alerts band's Unclaimed shifts item: completed shifts in the claim run's window that no live claim has taken.
describe('DashboardPage: Unclaimed shifts', () => {
  it('shows the count, what it means, and a link straight to the claim run', () => {
    asRole('Coordinator')
    mockUseUnclaimedShifts.mockReturnValue(unclaimedShifts(6, 2))
    renderPage()

    const tile = screen.getByRole('group', { name: 'Unclaimed shifts 6' })
    expect(within(tile).getByText('6')).toBeInTheDocument()
    expect(within(tile).getByText('Last 14 days, across 2 participants.')).toBeInTheDocument()
    expect(within(tile).getByRole('link', { name: 'Claim shifts' })).toHaveAttribute('href', '/claims?run=shifts')
    expect(tile).toHaveAttribute('data-attention')
  })

  it.each([
    ['older and recent', unclaimedShifts(6, 2, { older: 3, oldestDate: '2026-10-06' }), '9', '3 are more than 14 days old.', '/claims?run=shifts&from=2026-10-06'],
    ['older only', unclaimedShifts(0, 0, { older: 3, oldestDate: '2026-10-06' }), '3', '3 are more than 14 days old.', '/claims?run=shifts&from=2026-10-06'],
    ['one older', unclaimedShifts(6, 2, { older: 1, oldestDate: '2026-10-06' }), '7', '1 is more than 14 days old.', '/claims?run=shifts&from=2026-10-06'],
    ['past 90 days', unclaimedShifts(6, 2, { older: 3, overdue: 1, oldestDate: '2026-07-21' }), '9', '1 is more than 90 days old.', '/claims?run=shifts&from=2026-07-21'],
    ['several past 90 days', unclaimedShifts(6, 2, { older: 3, overdue: 2, oldestDate: '2026-07-21' }), '9', '2 are more than 90 days old.', '/claims?run=shifts&from=2026-07-21'],
  ])('older shifts, %s: the figure is the total, the line names the older part, the link starts at the oldest', (_name, kit, figure, detail, href) => {
    asRole('Coordinator')
    mockUseUnclaimedShifts.mockReturnValue(kit)
    renderPage()

    const tile = screen.getByRole('group', { name: `Unclaimed shifts ${figure}` })
    expect(within(tile).getByText(figure)).toBeInTheDocument()
    expect(within(tile).getByText(detail)).toBeInTheDocument()
    expect(within(tile).queryByText(/Last 14 days/)).toBeNull()
    expect(within(tile).getByRole('link', { name: 'Claim shifts' })).toHaveAttribute('href', href)
    expect(tile).toHaveAttribute('data-attention')
  })

  it('says "1 participant" for one', () => {
    asRole('Admin')
    mockUseUnclaimedShifts.mockReturnValue(unclaimedShifts(1, 1))
    renderPage()
    expect(screen.getByText('Last 14 days, across 1 participant.')).toBeInTheDocument()
  })

  it('sits after Shift completions among the warnings', () => {
    asRole('Coordinator')
    mockUseUnclaimedShifts.mockReturnValue(unclaimedShifts(6, 2))
    renderPage()
    expect(tileLabels().slice(-1)).toEqual(['Unclaimed shifts'])
  })

  it('at zero is no tile: the All clear row names it', () => {
    asRole('Coordinator')
    mockUseUnclaimedShifts.mockReturnValue(unclaimedShifts(0, 0))
    renderPage()
    expect(screen.queryByRole('group', { name: /Unclaimed shifts/ })).not.toBeInTheDocument()
    expect(screen.getByText(/^Checked and at zero:.*unclaimed shifts/)).toBeInTheDocument()
  })

  it('shows an en dash while loading and after a failure, never an all-clear', () => {
    asRole('Coordinator')
    mockUseUnclaimedShifts.mockReturnValue(unclaimedShifts(0, 0, { loading: true }))
    const { unmount } = renderPage()
    const loading = screen.getByRole('link', { name: 'Unclaimed shifts Loading' })
    expect(loading).toHaveAttribute('href', '/claims')
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(within(loading).getByText('–')).toBeInTheDocument()
    expect(clearRow()?.textContent ?? '').not.toContain('unclaimed shifts')
    unmount()

    mockUseUnclaimedShifts.mockReturnValue(unclaimedShifts(0, 0, { error: true }))
    renderPage()
    const failed = screen.getByRole('link', { name: "Unclaimed shifts Couldn't load" })
    expect(failed).not.toHaveAttribute('aria-busy')
    expect(within(failed).getByText('–')).toBeInTheDocument()
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it.each(['ReadOnly', 'SupportWorker'])('is hidden from a %s, and the request is not made', role => {
    asRole(role)
    mockUseUnclaimedShifts.mockReturnValue(unclaimedShifts(6, 2))
    renderPage()
    expect(screen.queryByText(/unclaimed shifts/i)).not.toBeInTheDocument()
    expect(mockUseUnclaimedShifts).toHaveBeenCalledWith(false)
  })

  it('is hidden from a SuperAdmin who has not chosen an organisation, and the request is not made', () => {
    asRole('SuperAdmin')
    mockUseUnclaimedShifts.mockReturnValue(unclaimedShifts(6, 2))
    renderPage()
    expect(screen.queryByText(/unclaimed shifts/i)).not.toBeInTheDocument()
    expect(mockUseUnclaimedShifts).toHaveBeenCalledWith(false)
    expect(mockUseUnclaimedShifts).not.toHaveBeenCalledWith(true)
  })
})
