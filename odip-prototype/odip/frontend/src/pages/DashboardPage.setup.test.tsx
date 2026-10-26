import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { mockUseDashboard, mockUseDecisionGroups, mockUseProviderSettings, mockUseSetupStatus } from './dashboard/dashboardHookMocks'
import { asRole, FINISHED_ORG, installDashboardDefaults, renderPage, settled } from './dashboard/dashboardTestKit'
import type { GroupModel } from './dashboard/quickGroupModel'

vi.mock('@/api/hooks', async () => (await import('./dashboard/dashboardHookMocks')).hooks)
vi.mock('./dashboard/useDecisionGroups', async () => ({ useDecisionGroups: (await import('./dashboard/dashboardHookMocks')).mockUseDecisionGroups }))

installDashboardDefaults()

const EMPTY_ORG = { staffCount: 0, participantCount: 0, participantsWithPlanCount: 0, firstPublishedWeekStart: null, hasInvoice: false, employmentHeroAvailable: false }
const waiting = { data: undefined, isPending: true, isError: false, isFetching: true, fetchStatus: 'fetching', errorUpdateCount: 0 }
const failed = { data: undefined, isPending: false, isError: true, isFetching: false, fetchStatus: 'idle', errorUpdateCount: 1 }
const retrying = { data: undefined, isPending: true, isError: false, isFetching: true, fetchStatus: 'fetching', errorUpdateCount: 1 }
const leaveGroup = (): GroupModel => ({
  key: 'leave', title: 'leave', noun: 'leave requests', subjectHeader: 'Staff', columns: [], phase: 'ready', refetch: vi.fn(), count: 1,
  rows: [{ id: 'a', subject: 'Person a', facts: [], flags: [], actions: [] }], link: { to: '/leave', openLabel: 'Open leave' },
})
const emptyOrg = () => mockUseSetupStatus.mockReturnValue(settled(EMPTY_ORG))

describe('DashboardPage: setup card', () => {
  it('waiting: one spinner in place of the Alerts block, no card, no Alerts heading, the groups still shown', () => {
    asRole('Admin')
    mockUseSetupStatus.mockReturnValue(waiting)
    mockUseDecisionGroups.mockReturnValue([leaveGroup()])
    const { container } = renderPage()

    expect(container.querySelectorAll('.animate-spin')).toHaveLength(1)
    expect(screen.queryByRole('heading', { level: 2, name: 'Alerts' })).toBeNull()
    expect(screen.queryByText('No staff yet')).toBeNull()
    expect(screen.queryByText('0 of 5 done')).toBeNull()
    expect(screen.getByText('Person a')).toBeInTheDocument()
  })

  it('settled as a finished org with the summary pending: the Alerts heading sits above the spinner and the groups render', () => {
    asRole('Admin')
    mockUseDashboard.mockReturnValue({ data: undefined, isPending: true, isLoading: true, isError: false })
    mockUseSetupStatus.mockReturnValue(settled(FINISHED_ORG))
    mockUseDecisionGroups.mockReturnValue([leaveGroup()])
    const { container } = renderPage()

    const spinner = container.querySelector('.animate-spin')!
    expect(screen.getByRole('heading', { level: 2, name: 'Alerts' }).compareDocumentPosition(spinner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Person a')).toBeInTheDocument()
  })

  it('errored then retrying: no held spinner, no card, not clear, the Alerts band shown', () => {
    asRole('Admin')
    mockUseSetupStatus.mockReturnValue(retrying)
    const { container } = renderPage()

    expect(container.querySelectorAll('.animate-spin')).toHaveLength(0)
    expect(screen.queryByText('0 of 5 done')).toBeNull()
    expect(screen.queryByText('All clear. Nothing needs you right now.')).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Alerts' })).toBeInTheDocument()
  })

  it('a failed setup query: no card, no All clear field, the Alerts band shown', () => {
    asRole('Admin')
    mockUseSetupStatus.mockReturnValue(failed)
    renderPage()

    expect(screen.queryByText('Get set up')).toBeNull()
    expect(screen.queryByText('All clear. Nothing needs you right now.')).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Alerts' })).toBeInTheDocument()
  })

  it('card shown: it precedes #dashboard-alerts, and the empty org is not also "All clear. Nothing needs you right now."', () => {
    asRole('Admin')
    emptyOrg()
    const { container } = renderPage()

    const card = screen.getByRole('heading', { level: 2, name: 'Get set up' })
    expect(card.compareDocumentPosition(container.querySelector('#dashboard-alerts')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('All clear. Nothing needs you right now.')).toBeNull()
    expect(screen.getByText('1 of 5 done')).toBeInTheDocument()
  })

  it('Hide: the card goes, the always-mounted region says so, focus lands on #dashboard-alerts', () => {
    asRole('Admin')
    emptyOrg()
    const { container } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Hide setup steps' }))

    expect(screen.queryByText('Get set up')).toBeNull()
    expect(screen.getByText('Setup steps hidden. Show them again from Settings, Organisation setup.')).toBeInTheDocument()
    expect(container.querySelector('#dashboard-alerts')).toHaveFocus()
  })

  it('hidden flag set on mount: no hide sentence is left in the page for a later visit', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    localStorage.setItem('bunya-setup-hidden:none', '1')
    emptyOrg()
    renderPage()

    expect(screen.queryByText('Setup steps hidden. Show them again from Settings, Organisation setup.')).toBeNull()
  })

  it('hidden flag set: the setup query is asked not to run', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    localStorage.setItem('bunya-setup-hidden:none', '1')
    emptyOrg()
    renderPage()

    expect(mockUseSetupStatus).toHaveBeenLastCalledWith(false)
    expect(screen.queryByText('Get set up')).toBeNull()
  })

  it.each(['Coordinator', 'ReadOnly', 'SupportWorker'])('%s: no setup query, no card', (role) => {
    asRole(role)
    emptyOrg()
    renderPage()

    expect(mockUseSetupStatus).toHaveBeenLastCalledWith(false)
    expect(screen.queryByText('Get set up')).toBeNull()
  })

  it('a SuperAdmin with no organisation: no setup query, no card', () => {
    asRole('SuperAdmin')
    emptyOrg()
    mockUseProviderSettings.mockReturnValue(settled(null))
    renderPage()

    expect(mockUseSetupStatus).toHaveBeenLastCalledWith(false)
    expect(screen.queryByText('Get set up')).toBeNull()
  })
})
