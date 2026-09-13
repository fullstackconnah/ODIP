import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import IncidentsPage from './IncidentsPage'

const { mockUseIncidents, mockUseOverdueQscIncidents } = vi.hoisted(() => ({
  mockUseIncidents: vi.fn(),
  mockUseOverdueQscIncidents: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useIncidents: mockUseIncidents,
  useOverdueQscIncidents: mockUseOverdueQscIncidents,
  useUpdateIncident: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteIncident: () => ({ mutate: vi.fn(), isPending: false }),
}))

function baseIncident(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inc-1',
    title: 'Slip in kitchen',
    tripName: null,
    incidentType: 'Injury',
    severity: 'Low',
    status: 'Draft',
    reportedByName: 'Alex Rivera',
    incidentDateTime: '2026-09-01T10:00:00Z',
    qscReportingStatus: 'Required',
    isOverdue24h: false,
    ...overrides,
  }
}

function renderPage(initialEntry = '/incidents') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/incidents" element={<IncidentsPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  mockUseIncidents.mockReturnValue({ data: [], isLoading: false })
  mockUseOverdueQscIncidents.mockReturnValue({ data: [] })
})

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('IncidentsPage — QSC overdue banner (C-1)', () => {
  it('does not render a banner when there are no overdue QSC incidents', () => {
    renderPage()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the overdue QSC banner with role="alert" and destructive design tokens, not raw Tailwind reds', () => {
    mockUseOverdueQscIncidents.mockReturnValue({ data: [baseIncident({ isOverdue24h: true })] })
    renderPage()

    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent(/1 incident/)
    expect(banner).toHaveTextContent(/require QSC reporting/)
    expect(banner.className).toMatch(/bg-error-container/)
    expect(banner.className).not.toMatch(/red-500/)
    expect(banner.className).not.toMatch(/text-red-400/)
  })

  it('contains a link into the incident list filtered to qsc=overdue (the alert itself stays a plain landmark, not an anchor)', () => {
    mockUseOverdueQscIncidents.mockReturnValue({ data: [baseIncident({ isOverdue24h: true })] })
    renderPage()

    const banner = screen.getByRole('alert')
    expect(banner.tagName).not.toBe('A')
    const link = within(banner).getByRole('link', { name: /view overdue incidents/i })
    expect(link).toHaveAttribute('href', '/incidents?qsc=overdue')
  })

  it('offers a "Show all incidents" link back out of the filter when qsc=overdue is active', () => {
    mockUseOverdueQscIncidents.mockReturnValue({ data: [baseIncident({ isOverdue24h: true })] })
    renderPage('/incidents?qsc=overdue')

    expect(screen.getByRole('link', { name: /show all incidents/i })).toHaveAttribute('href', '/incidents')
  })

  it('does not render the "Show all incidents" link when no filter is active', () => {
    renderPage()
    expect(screen.queryByRole('link', { name: /show all incidents/i })).not.toBeInTheDocument()
  })

  it('shows only overdue incidents when visiting /incidents?qsc=overdue', () => {
    mockUseIncidents.mockReturnValue({
      data: [
        baseIncident({ id: 'inc-1', title: 'Overdue one', isOverdue24h: true }),
        baseIncident({ id: 'inc-2', title: 'On-time one', isOverdue24h: false }),
      ],
      isLoading: false,
    })
    mockUseOverdueQscIncidents.mockReturnValue({ data: [baseIncident({ id: 'inc-1', isOverdue24h: true })] })
    renderPage('/incidents?qsc=overdue')

    expect(screen.getByText('Overdue one')).toBeInTheDocument()
    expect(screen.queryByText('On-time one')).not.toBeInTheDocument()
  })

  it('final review I3(a): the QSC overdue view ignores the status filter, matching what the banner counted', () => {
    // useIncidents is a single mock, so if the page were still passing statusFilter/severityFilter
    // through to the query it would receive this pre-filtered (empty) list instead of the full one.
    mockUseIncidents.mockReturnValue({
      data: [
        baseIncident({ id: 'inc-1', title: 'Overdue one', status: 'Resolved', isOverdue24h: true }),
      ],
      isLoading: false,
    })
    mockUseOverdueQscIncidents.mockReturnValue({ data: [baseIncident({ id: 'inc-1', status: 'Resolved', isOverdue24h: true })] })
    renderPage('/incidents?qsc=overdue')

    // Even though no status filter UI selection was made, the query params passed to useIncidents
    // must not carry a stale status/severity filter while in the QSC overdue view.
    const paramsArg = mockUseIncidents.mock.calls.at(-1)?.[0]
    expect(paramsArg).not.toHaveProperty('status')
    expect(paramsArg).not.toHaveProperty('severity')
    expect(screen.getByText('Overdue one')).toBeInTheDocument()
  })

  it('final review I3(b): shows a QSC-specific empty state, not the generic "no incidents" copy, when nothing is overdue', () => {
    mockUseIncidents.mockReturnValue({ data: [], isLoading: false })
    mockUseOverdueQscIncidents.mockReturnValue({ data: [] })
    renderPage('/incidents?qsc=overdue')

    expect(screen.getByText('No overdue QSC reports')).toBeInTheDocument()
    expect(screen.queryByText('No incidents reported')).not.toBeInTheDocument()
    expect(screen.queryByText(/report one to get started/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /show all incidents/i })).toHaveAttribute('href', '/incidents')
  })
})

describe('IncidentsPage — cross-domain links', () => {
  it('links the trip cell to the trip detail page when tripInstanceId is set', () => {
    mockUseIncidents.mockReturnValue({
      data: [baseIncident({ tripInstanceId: 'trip-1', tripName: 'Beach Day' })],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByRole('link', { name: 'Beach Day' })).toHaveAttribute('href', '/trips/trip-1')
  })

  it('renders plain text (not a link) for the trip cell when tripInstanceId is not set', () => {
    mockUseIncidents.mockReturnValue({
      data: [baseIncident({ tripInstanceId: null, tripName: null })],
      isLoading: false,
    })
    renderPage()

    expect(screen.queryByRole('link', { name: 'Beach Day' })).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows the involved participant name as plain text — IncidentListDto has no participant id to link to', () => {
    mockUseIncidents.mockReturnValue({
      data: [baseIncident({ involvedParticipantName: 'Priya Nair' })],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Priya Nair')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Priya Nair' })).not.toBeInTheDocument()
  })

  it('shows an em dash when no participant is involved', () => {
    mockUseIncidents.mockReturnValue({
      data: [baseIncident({ involvedParticipantName: null })],
      isLoading: false,
    })
    renderPage()

    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
