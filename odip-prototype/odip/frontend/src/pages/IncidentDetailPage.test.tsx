import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import IncidentDetailPage from './IncidentDetailPage'
import type { IncidentDetailDto } from '@/api/types/incidents'

const { mockUseIncident } = vi.hoisted(() => ({
  mockUseIncident: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useIncident: mockUseIncident,
}))

function renderPage(id = 'inc-1') {
  return render(
    <MemoryRouter initialEntries={[`/incidents/${id}`]}>
      <Routes>
        <Route path="/incidents/:id" element={<IncidentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function baseIncident(overrides: Partial<IncidentDetailDto> = {}): IncidentDetailDto {
  return {
    id: 'inc-1', serviceType: 'None', tripInstanceId: null, tripName: null,
    incidentType: 'MedicationError', otherTypeSpecify: null,
    severity: 'Medium', status: 'Draft', title: 'Missed evening medication dose',
    incidentDateTime: '2026-07-11T20:15:00Z', location: 'Accommodation — Byron Bay',
    reportedByName: 'Mei Zhang', involvedParticipantId: 'participant-4', involvedParticipantName: 'Grace Palmer-Hughes',
    qscReportingStatus: 'NotRequired', isOverdue24h: false, createdAt: '2026-07-11T21:05:00Z',
    medicationAdministrationId: null, shiftId: null, shiftNoteId: null,
    participantBookingId: null, involvedStaffId: null, involvedStaffName: null, reportedByStaffId: 'staff-4',
    restrictivePracticeType: null, restrictivePracticeId: null, restrictivePracticeDescription: null,
    restrictivePracticeReviewDate: null, unapprovedRestrictivePracticeDetails: null, isRestrictivePracticeAuthorised: null,
    description: 'Evening insulin dose administered 90 minutes late after dinner ran over schedule.',
    immediateActionsTaken: 'BGL checked, on-call nurse consulted, dose given per protocol.',
    wereEmergencyServicesCalled: false, emergencyServicesDetails: null,
    witnessNames: null, witnessStatements: null, injuries: [], witnesses: [],
    qscReportedAt: null, qscReferenceNumber: null,
    reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null,
    resolvedAt: null, familyNotified: true, familyNotifiedAt: '2026-07-12T08:30:00Z',
    supportCoordinatorNotified: true, supportCoordinatorNotifiedAt: '2026-07-12T08:45:00Z',
    updatedAt: '2026-07-25T10:00:00Z',
    medicationContext: null, shiftContext: null, shiftNoteContext: null,
    ...overrides,
  }
}

describe('IncidentDetailPage — Context panel', () => {
  it('shows a loading state before the incident resolves', () => {
    mockUseIncident.mockReturnValue({ data: undefined, isLoading: true })
    renderPage()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('shows a not-found state when the incident fails to resolve', () => {
    mockUseIncident.mockReturnValue({ data: undefined, isLoading: false })
    renderPage()
    expect(screen.getByText('Incident not found')).toBeInTheDocument()
  })

  it('renders no Context panel when medication/shift/shiftNote are all null', () => {
    mockUseIncident.mockReturnValue({ data: baseIncident(), isLoading: false })
    renderPage()

    expect(screen.getByText('Missed evening medication dose')).toBeInTheDocument()
    expect(screen.queryByText('Context')).not.toBeInTheDocument()
  })

  it('shows the medication context — name, status, timestamp, recorded-by, and a link to the participant\'s Medications tab', () => {
    mockUseIncident.mockReturnValue({
      data: baseIncident({
        medicationContext: {
          medicationAdministrationId: 'admin-1',
          medicationName: 'Insulin',
          status: 'Missed',
          administeredAt: '2026-07-11T20:15:00Z',
          recordedByName: 'Tom Beattie',
        },
      }),
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Context')).toBeInTheDocument()
    expect(screen.getByText('Insulin · Missed')).toBeInTheDocument()
    expect(screen.getByText(/Tom Beattie/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open medications' })).toHaveAttribute(
      'href',
      '/participants/participant-4?tab=medications',
    )
  })

  it('shows the shift context as plain text — date, time range, participant, staff', () => {
    mockUseIncident.mockReturnValue({
      data: baseIncident({
        shiftContext: {
          shiftId: 'shift-1', date: '2026-07-11', startTime: '08:00', endTime: '16:00',
          participantName: 'Grace Palmer-Hughes', staffName: 'Tom Beattie',
        },
      }),
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Context')).toBeInTheDocument()
    expect(screen.getByText('11/07/2026 · 08:00–16:00')).toBeInTheDocument()
    expect(screen.getByText('Grace Palmer-Hughes · Tom Beattie')).toBeInTheDocument()
    // Plain text, not a link — there is no coordinator shift detail page.
    expect(screen.queryByRole('link', { name: /Tom Beattie/i })).not.toBeInTheDocument()
  })

  it('shows the shift-note context — excerpt, flagged category chips, and created date', () => {
    mockUseIncident.mockReturnValue({
      data: baseIncident({
        shiftNoteContext: {
          shiftNoteId: 'note-1', excerpt: 'She had a fall near the bathroom.',
          flaggedCategories: ['Falls', 'Injury'], createdAt: '2026-07-11T18:00:00Z',
        },
      }),
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Context')).toBeInTheDocument()
    expect(screen.getByText('"She had a fall near the bathroom."')).toBeInTheDocument()
    expect(screen.getByText('falls')).toBeInTheDocument()
    expect(screen.getByText('injury')).toBeInTheDocument()
  })

  it('shows every present context block together when more than one is set', () => {
    mockUseIncident.mockReturnValue({
      data: baseIncident({
        medicationContext: {
          medicationAdministrationId: 'admin-1', medicationName: 'Insulin', status: 'Missed',
          administeredAt: '2026-07-11T20:15:00Z', recordedByName: 'Tom Beattie',
        },
        shiftNoteContext: {
          shiftNoteId: 'note-1', excerpt: 'Note text.', flaggedCategories: ['Medication'], createdAt: '2026-07-11T18:00:00Z',
        },
      }),
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Insulin · Missed')).toBeInTheDocument()
    expect(screen.getByText('"Note text."')).toBeInTheDocument()
  })
})
