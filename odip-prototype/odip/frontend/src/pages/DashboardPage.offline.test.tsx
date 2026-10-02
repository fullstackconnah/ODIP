import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardPage from './DashboardPage'

// The REAL hooks on a real query client, with the browser reporting offline. TanStack Query PAUSES a request while it is offline: the query is pending with a
// fetchStatus of "paused", and isLoading, isError and data all say "nothing", so a screen that tested only isLoading read an unasked question as a settled zero
// and the dashboard's band said "All clear. Nothing needs you right now." over no data at all. The page's other tests mock the hooks and cannot see this.

// The hooks index re-exports the sign-in hooks, which read Firebase env at import; none of it is used here.
vi.mock('@/lib/firebase', () => ({ auth: null, devAuthEnabled: true }))

const { apiGet, apiGetWithDefault } = vi.hoisted(() => ({ apiGet: vi.fn(), apiGetWithDefault: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGet, apiGetWithDefault }))

const ZERO_SUMMARY = {
  upcomingTripCount: 0, activeParticipantCount: 0, outstandingTaskCount: 0, overdueTaskCount: 0, conflictCount: 0,
  tripsMissingAccommodation: 0, tripsMissingVehicles: 0, tripsMissingStaff: 0, openIncidentCount: 0, qscOverdueCount: 0,
  upcomingTrips: [], overdueTasks: [],
}
const EMPTY_PAGE = { items: [], totalCount: 0, page: 1, pageSize: 1, totalPages: 0, hasNext: false, hasPrevious: false }

// What the API says once the network is back: everything answered, and nothing needs anybody.
const answer = (url: string): Promise<unknown> => {
  if (url === '/dashboard/summary') return Promise.resolve(ZERO_SUMMARY)
  if (url === '/rostering/completions') return Promise.resolve(EMPTY_PAGE)
  return Promise.resolve([])
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })

function renderDashboard(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const band = () => screen.getByRole('region', { name: 'Needs attention' })

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator', fullName: 'Sarah Mitchell' }))
  apiGet.mockImplementation(answer)
  apiGetWithDefault.mockImplementation((_url: string, fallback: unknown) => Promise.resolve(fallback))
  onlineManager.setOnline(false)
})

afterEach(() => {
  cleanup()
  onlineManager.setOnline(true)
  localStorage.clear()
  vi.clearAllMocks()
})

describe('DashboardPage — offline: a paused request is not a settled zero', () => {
  it('has no band and no all-clear while the summary itself is paused: it is waiting, and says nothing about data it never asked for', () => {
    const { container } = renderDashboard(newClient())

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument()
    expect(screen.queryByText(/All clear/)).not.toBeInTheDocument()
    // The requests really were paused, not answered: this is the state the mocked tests cannot reach.
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('shows an en dash, busy, for staff, alerts, leave and completions while they are paused, and never names them clear or claims "Nothing needs you"', () => {
    const client = newClient()
    client.setQueryData(['dashboard'], ZERO_SUMMARY) // the summary is on screen (stale, its refetch paused); everything else has never answered
    renderDashboard(client)

    for (const [label, href] of [
      ['Qualification Issues', '/qualifications'],
      ['Critical Participant Alerts', '/participants'],
      ['Pending Leave', '/rostering/leave'],
      ['Shift Completions', '/rostering/completions'],
    ]) {
      const tile = within(band()).getByRole('link', { name: `${label} Loading` })
      expect(tile, label).toHaveAttribute('href', href)
      expect(tile, label).toHaveAttribute('aria-busy', 'true')
      expect(tile, label).not.toHaveAttribute('data-attention')
      expect(within(tile).getByText('–'), label).toBeInTheDocument()
    }
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
    // The row names only what the summary answered, not one of the four that are waiting.
    const row = screen.getByText('All clear', { selector: 'span.font-semibold' }).closest('p') as HTMLElement
    expect(row).toHaveTextContent('Overdue')
    for (const waiting of ['Qualification Issues', 'Critical Participant Alerts', 'Pending Leave', 'Shift Completions']) expect(row).not.toHaveTextContent(waiting)
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('stays honest for a role that sees fewer items: the staff list is the only waiting item for ReadOnly', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    const client = newClient()
    client.setQueryData(['dashboard'], ZERO_SUMMARY)
    renderDashboard(client)

    expect(within(band()).getByRole('link', { name: 'Qualification Issues Loading' })).toBeInTheDocument()
    expect(within(band()).getAllByText('Loading')).toHaveLength(1)
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it('settles when the browser comes back online: the requests run, and an all-clear is then said over real zeros', async () => {
    const client = newClient()
    renderDashboard(client)
    expect(screen.queryByText(/All clear/)).not.toBeInTheDocument()

    await act(async () => {
      onlineManager.setOnline(true)
    })

    expect(await screen.findByText('All clear. Nothing needs you right now.')).toBeInTheDocument()
    expect(apiGet).toHaveBeenCalledWith('/dashboard/summary')
    expect(apiGet).toHaveBeenCalledWith('/rostering/completions', { status: 'PendingReview', page: 1, pageSize: 1 })
    expect(screen.queryByText('–')).not.toBeInTheDocument()
  })
})
