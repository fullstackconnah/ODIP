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
})
