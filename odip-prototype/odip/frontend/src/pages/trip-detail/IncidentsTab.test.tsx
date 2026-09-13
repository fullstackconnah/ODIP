import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import IncidentsTab from './IncidentsTab'
import type { IncidentListDto } from '@/api/types'

function baseIncident(overrides: Partial<IncidentListDto> = {}): IncidentListDto {
  return {
    id: 'inc-1',
    serviceType: 'Trip',
    tripInstanceId: 'trip-1',
    tripName: 'Gold Coast Beach Break',
    incidentType: 'Injury',
    otherTypeSpecify: null,
    severity: 'Low',
    status: 'Draft',
    title: 'Slip in kitchen',
    incidentDateTime: '2026-09-01T10:00:00Z',
    location: null,
    reportedByName: 'Alex Rivera',
    involvedParticipantId: null,
    involvedParticipantName: null,
    qscReportingStatus: 'NotRequired',
    isOverdue24h: false,
    createdAt: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

function renderTab(incidents: IncidentListDto[]) {
  return render(
    <MemoryRouter>
      <IncidentsTab incidents={incidents} />
    </MemoryRouter>,
  )
}

describe('IncidentsTab', () => {
  it('renders a row per incident with date, title, severity and status', () => {
    renderTab([baseIncident()])

    expect(screen.getByText('Slip in kitchen')).toBeInTheDocument()
    expect(screen.getByText('Low')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  it('links each row to the incident detail page', () => {
    renderTab([baseIncident({ id: 'inc-42', title: 'Slip in kitchen' })])

    expect(screen.getByRole('link', { name: /slip in kitchen/i })).toHaveAttribute('href', '/incidents/inc-42')
  })

  it('shows the empty-state copy when there are no incidents', () => {
    renderTab([])

    expect(screen.getByText('No incidents recorded for this trip.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
