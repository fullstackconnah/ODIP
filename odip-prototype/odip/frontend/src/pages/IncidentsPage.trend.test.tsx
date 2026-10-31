import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import IncidentsPage from './IncidentsPage'

const { mockUseIncidentTrend, mockUseIncidents, mockUseOverdueQscIncidents } = vi.hoisted(() => ({
  mockUseIncidentTrend: vi.fn(),
  mockUseIncidents: vi.fn(),
  mockUseOverdueQscIncidents: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useIncidents: mockUseIncidents,
  useOverdueQscIncidents: mockUseOverdueQscIncidents,
  useRestoreIncident: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteIncident: () => ({ mutate: vi.fn(), isPending: false }),
  useFlaggedShiftNotes: () => ({ data: [], isLoading: false }),
  useIncidentTrend: mockUseIncidentTrend,
}))

const incident = { id: 'inc-1', title: 'Slip in kitchen', tripName: null, incidentType: 'Injury', severity: 'Low', status: 'Draft', reportedByName: 'Alex Rivera', incidentDateTime: '2026-09-01T10:00:00Z', qscReportingStatus: 'Required', isOverdue24h: true }

function renderPage(role: string, entry = '/incidents') {
  localStorage.setItem('odip_user', JSON.stringify({ id: 'user-1', role }))
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/incidents" element={<IncidentsPage />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseIncidentTrend.mockReturnValue({ data: undefined, isLoading: true, isError: false })
  mockUseIncidents.mockReturnValue({ data: [incident], isLoading: false })
  mockUseOverdueQscIncidents.mockReturnValue({ data: [incident] })
})
afterEach(() => { localStorage.clear(); vi.clearAllMocks() })

describe('IncidentsPage incidents-by-month card', () => {
  it.each(['SuperAdmin', 'Admin', 'Coordinator'])('shows for %s', role => {
    renderPage(role)
    expect(document.querySelector('[data-incident-trend]')).toBeTruthy()
  })

  it.each(['SupportWorker', 'ReadOnly'])('is absent for %s, which also makes no request for it', role => {
    renderPage(role)
    expect(document.querySelector('[data-incident-trend]')).toBeNull()
    expect(mockUseIncidentTrend).not.toHaveBeenCalled()
  })

  it.each([
    ['the overdue filter', '/incidents?qsc=overdue'],
    ['Flagged notes', '/incidents?view=flagged-notes'],
  ])('is hidden on %s', (_name, entry) => {
    renderPage('Admin', entry)
    expect(document.querySelector('[data-incident-trend]')).toBeNull()
  })

  it('is hidden on the Archived view', async () => {
    renderPage('Admin')
    await userEvent.click(screen.getByRole('radio', { name: 'Archived' }))
    expect(document.querySelector('[data-incident-trend]')).toBeNull()
  })

  it('sits after the NDIS Commission banner and before the list', () => {
    renderPage('Admin')
    const banner = document.querySelector('[role="alert"]')!
    const card = document.querySelector('[data-incident-trend]')!
    const list = document.querySelector('table, [role="table"], ul')!
    expect(banner.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(card.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
