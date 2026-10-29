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
  upcomingTrips: [],
}
const EMPTY_PAGE = { items: [], totalCount: 0, page: 1, pageSize: 1, totalPages: 0, hasNext: false, hasPrevious: false }

// What the API says once the network is back: everything answered, and nothing needs anybody.
const answer = (url: string): Promise<unknown> => {
  if (url === '/dashboard/summary') return Promise.resolve(ZERO_SUMMARY)
  if (url === '/rostering/completions') return Promise.resolve(EMPTY_PAGE)
  // The Incidents group reads a paged list (fetchPagedList fails on a bare []); /tasks falls through to [], which is right.
  if (url === '/incidents') return Promise.resolve(EMPTY_PAGE)
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

const band = () => screen.getByRole('region', { name: 'Alerts' })

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
    // The greeting needs no data, so offline the page still opens with it (and still says nothing about numbers it never had).
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Good (morning|afternoon|evening), Sarah/)
    expect(screen.queryByText(/upcoming trip/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Alerts' })).not.toBeInTheDocument()
    expect(screen.queryByText(/All clear/)).not.toBeInTheDocument()
    // The decision groups wait too: never absent, never clear.
    expect(screen.getByText('Loading leave requests…')).toBeInTheDocument()
    // The requests really were paused, not answered: this is the state the mocked tests cannot reach.
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('shows an en dash, busy, for alerts, and a loading line for every group while they are paused, and never names them clear or claims "Nothing needs you"', () => {
    const client = newClient()
    client.setQueryData(['dashboard'], ZERO_SUMMARY) // the summary is on screen (stale, its refetch paused); everything else has never answered
    renderDashboard(client)

    const tile = within(band()).getByRole('link', { name: 'Critical participant alerts Loading' })
    expect(tile).toHaveAttribute('href', '/participants')
    expect(tile).toHaveAttribute('aria-busy', 'true')
    expect(tile).not.toHaveAttribute('data-attention')
    expect(within(tile).getByText('–')).toBeInTheDocument()
    // A Coordinator decides the moved items in their groups: each one is waiting, never absent and never clear.
    for (const line of ['Loading shift completions…', 'Loading leave requests…', 'Loading open incidents…', 'Loading tasks due…', 'Loading staff credentials to update…']) {
      expect(screen.getByText(line)).toBeInTheDocument()
    }
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
    // The row names only what the summary answered, and none of the groups that are waiting.
    const row = screen.getByText('All clear', { selector: 'span.font-semibold' }).closest('p') as HTMLElement
    expect(row).toHaveTextContent('trips missing accommodation')
    for (const waiting of ['shift completions', 'leave requests', 'open incidents', 'tasks due', 'staff credentials to update']) expect(row).not.toHaveTextContent(waiting)
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('stays honest for a role that sees fewer items: the staff list is the only waiting item for ReadOnly', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    const client = newClient()
    client.setQueryData(['dashboard'], ZERO_SUMMARY)
    renderDashboard(client)

    expect(within(band()).getByRole('link', { name: 'Qualification issues Loading' })).toBeInTheDocument()
    expect(within(band()).getAllByText('Loading')).toHaveLength(1)
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it('settles when the browser comes back online: the requests run, and an all-clear is then said over real zeros', async () => {
    // ReadOnly has no decision groups, so the band alone decides the field here.
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    const client = newClient()
    renderDashboard(client)
    expect(screen.queryByText(/All clear/)).not.toBeInTheDocument()

    await act(async () => {
      onlineManager.setOnline(true)
    })

    expect(await screen.findByText('All clear. Nothing needs you right now.')).toBeInTheDocument()
    expect(apiGet).toHaveBeenCalledWith('/dashboard/summary')
    expect(screen.queryByText('–')).not.toBeInTheDocument()
  })

  it('settles to the field for a Coordinator too, once the summary, the alerts and every group answer at zero', async () => {
    renderDashboard(newClient())   // the beforeEach signs in a Coordinator
    expect(screen.queryByText(/All clear/)).not.toBeInTheDocument()

    await act(async () => {
      onlineManager.setOnline(true)
    })

    expect(await screen.findByText('All clear. Nothing needs you right now.')).toBeInTheDocument()
    expect(apiGet).toHaveBeenCalledWith('/rostering/completions', { status: 'PendingReview', page: 1, pageSize: 200 })
    expect(apiGet).toHaveBeenCalledWith('/incidents', { needsAttention: 'true', page: '1', pageSize: '5' })
    expect(screen.queryByText('–')).not.toBeInTheDocument()
  })
})
