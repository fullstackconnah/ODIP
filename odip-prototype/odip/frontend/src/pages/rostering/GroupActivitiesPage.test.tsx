import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import GroupActivitiesPage from './GroupActivitiesPage'
import { makeActivity } from './test-fixtures'

const h = vi.hoisted(() => ({ list: vi.fn(), visibility: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useGroupActivities: h.list, useModuleVisibility: h.visibility }))

const ok = (items: ReturnType<typeof makeActivity>[], totalCount = items.length) => ({ data: { items, totalCount }, isLoading: false, isError: false, refetch: vi.fn() })

function renderPage() {
  const router = createMemoryRouter([{ path: '/rostering/group-activities', element: <GroupActivitiesPage /> }, { path: '/rostering', element: <p>the board</p> }], { initialEntries: ['/rostering/group-activities'] })
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  // Wednesday 2026-08-19, so the default range is Monday 2026-08-17 to Sunday 2026-08-23.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 7, 19, 10, 0) })
  h.visibility.mockReturnValue({ data: { groupActivitiesEnabled: true }, isLoading: false })
  h.list.mockReturnValue(ok([makeActivity()]))
})
afterEach(() => { vi.useRealTimers(); h.list.mockReset() })

describe('GroupActivitiesPage', () => {
  it('reads this week, Monday to Sunday, every status, page 1 by default', () => {
    renderPage()
    expect(h.list).toHaveBeenLastCalledWith({ from: '2026-08-17', to: '2026-08-23' }, 1, 25, true)
    expect(screen.getByRole('heading', { level: 1, name: 'Group activities' })).toBeInTheDocument()
  })

  it('shows date, time, activity, staff, participants and status, with the shortfall in the staff cell', () => {
    h.list.mockReturnValue(ok([makeActivity({
      title: 'Bowling', location: 'Strike Zone', status: 'Draft', staffNeeded: 3, staffAssigned: 3,
      staff: ['Alex Rivera', 'Sam Wilson', 'Jo Lee'].map((staffName, i) => ({ id: `r${i}`, staffId: `s${i}`, staffName, startTime: '10:00:00', endTime: '14:00:00', endsNextDay: false, findings: [] })),
      participants: [{ participantId: 'p1', participantName: 'Mia', ratio: 'OneToOne', shiftIds: [], timesDiffer: false, didNotAttend: false }, { participantId: 'p2', participantName: 'Ben', ratio: 'OneToOne', shiftIds: [], timesDiffer: false, didNotAttend: true }],
    }), makeActivity({ id: 'activity-2', title: 'Picnic', staff: [], staffAssigned: 0, staffNeeded: 2 })]))
    renderPage()
    const [, first, second] = screen.getAllByRole('row')
    expect(within(first).getByText('Bowling')).toBeInTheDocument()
    expect(within(first).getByText('Strike Zone')).toBeInTheDocument()
    expect(within(first).getByText('Mon 17 Aug')).toBeInTheDocument()
    expect(within(first).getByText('Alex Rivera, Sam Wilson +1')).toBeInTheDocument()
    expect(within(first).getByText('Draft')).toBeInTheDocument()
    expect(within(first).getByText('1')).toBeInTheDocument()
    expect(within(second).getByText('Nobody yet')).toBeInTheDocument()
    expect(within(second).getByText(/2 more needed/)).toBeInTheDocument()
  })

  it('opens the activity on the roster board, at its week, from a click on the row', async () => {
    const router = renderPage()
    await userEvent.click(screen.getByText('Bowling'))
    expect(router.state.location.pathname).toBe('/rostering')
    expect(router.state.location.search).toBe('?date=2026-08-17&activity=activity-1')
  })

  it('sends the chosen status, and goes back to page 1', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /Status/ }))
    await user.click(await screen.findByRole('option', { name: 'Cancelled' }))
    expect(h.list).toHaveBeenLastCalledWith({ from: '2026-08-17', to: '2026-08-23', status: 'Cancelled' }, 1, 25, true)
  })

  it('says there is nothing this week with the default filters, and nothing matches once one changed', async () => {
    h.list.mockReturnValue(ok([]))
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByText('No group activities this week')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open roster board' })).toHaveAttribute('href', '/rostering')
    await user.click(screen.getByRole('button', { name: /Status/ }))
    await user.click(await screen.findByRole('option', { name: 'Draft' }))
    expect(screen.getByText('No group activities match these filters')).toBeInTheDocument()
    expect(screen.getByText('Try a different status or date range.')).toBeInTheDocument()
  })

  it('asks nothing while the switch is off, and says so', () => {
    h.visibility.mockReturnValue({ data: { groupActivitiesEnabled: false }, isLoading: false })
    h.list.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    expect(h.list).toHaveBeenLastCalledWith(expect.anything(), 1, 25, false)
    expect(screen.getByText('Group activities are turned off')).toBeInTheDocument()
    expect(screen.getByText('An admin can turn them on in Settings, under Workspace.')).toBeInTheDocument()
  })

  it('treats a server refusal for the switch as the same off state', () => {
    h.list.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 409 } }, refetch: vi.fn() })
    renderPage()
    expect(screen.getByText('Group activities are turned off')).toBeInTheDocument()
  })

  it('shows the loading state', () => {
    h.list.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    renderPage()
    expect(screen.getByText(/Loading group activities/i)).toBeInTheDocument()
  })

  it('offers Try again after a failed load', async () => {
    const refetch = vi.fn()
    h.list.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 500 } }, refetch })
    renderPage()
    expect(screen.getByText("Couldn't load group activities. Check your connection and try again.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('shows the server message when the range is refused', () => {
    h.list.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 400, data: { errors: ['Choose a range of 93 days or fewer.'] } } }, refetch: vi.fn() })
    renderPage()
    expect(screen.getByText('Choose a range of 93 days or fewer.')).toBeInTheDocument()
  })
})
