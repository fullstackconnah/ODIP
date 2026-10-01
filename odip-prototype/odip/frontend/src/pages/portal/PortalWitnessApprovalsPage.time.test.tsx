import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PortalWitnessApprovalsPage from './PortalWitnessApprovalsPage'
import type { PortalWitnessRequestDto } from '@/api/types'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUsePendingWitnessRequests } = vi.hoisted(() => ({ mockUsePendingWitnessRequests: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  usePendingWitnessRequests: mockUsePendingWitnessRequests,
  useApproveWitnessRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeclineWitnessRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useApproveIncidentWitnessRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeclineIncidentWitnessRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

afterEach(() => {
  restoreZone()
  vi.clearAllMocks()
})

function incidentRequest(overrides: Partial<PortalWitnessRequestDto> = {}): PortalWitnessRequestDto {
  return {
    id: 'witness-1', sourceType: 'Incident', participantId: 'participant-1', participantName: 'Sophie Brown',
    medicationId: null, medicationName: null, strength: null, doseDescription: null, doseGiven: null,
    incidentReportId: 'incident-1', incidentTitle: 'Fall in the kitchen', incidentType: 'Injury', incidentSeverity: 'High',
    recordedByName: 'Jordan Lee', administeredAt: null, administeredAtTimeZone: null,
    incidentDateTime: '2026-10-03T08:00:00', witnessStatus: 'Pending', witnessRespondedAt: null, createdAt: '2026-10-03T09:00:00Z',
    ...overrides,
  }
}

// L4-06, the same defect on the witness-approvals queue: the incident time is a wall-clock value the reporter typed, not an instant.
describe.each(['Australia/Sydney', 'UTC', 'America/New_York'])('Witness approvals, incident time in %s', zone => {
  it('shows 8:00 am for an incident typed as 08:00', () => {
    if (!setZone(zone)) return
    mockUsePendingWitnessRequests.mockReturnValue({ data: [incidentRequest()], isLoading: false, isError: false, refetch: vi.fn() })

    render(<MemoryRouter><PortalWitnessApprovalsPage /></MemoryRouter>)

    expect(screen.getByText(/Reported by Jordan Lee · 3 Oct 2026,? 8:00\s?(am|AM)/i)).toBeInTheDocument()
  })
})
