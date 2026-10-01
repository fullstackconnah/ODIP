import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import IncidentDetailPage from './IncidentDetailPage'
import type { IncidentDetailDto } from '@/api/types/incidents'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUseIncident } = vi.hoisted(() => ({ mockUseIncident: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useIncident: mockUseIncident }))

afterEach(() => {
  restoreZone()
  vi.clearAllMocks()
})

function baseIncident(overrides: Partial<IncidentDetailDto> = {}): IncidentDetailDto {
  return {
    id: 'inc-1', serviceType: 'None', tripInstanceId: null, tripName: null,
    incidentType: 'MedicationError', otherTypeSpecify: null,
    severity: 'Medium', status: 'Draft', title: 'Missed evening medication dose',
    incidentDateTime: '2026-10-03T08:00:00', location: 'Accommodation — Byron Bay',
    reportedByName: 'Mei Zhang', involvedParticipantId: 'participant-4', involvedParticipantName: 'Grace Palmer-Hughes',
    qscReportingStatus: 'NotRequired', isOverdue24h: false, createdAt: '2026-10-03T09:05:00Z',
    medicationAdministrationId: null, shiftId: null, shiftNoteId: null,
    participantBookingId: null, involvedStaffId: null, involvedStaffName: null, reportedByStaffId: 'staff-4',
    restrictivePracticeType: null, restrictivePracticeId: null, restrictivePracticeDescription: null,
    restrictivePracticeReviewDate: null, unapprovedRestrictivePracticeDetails: null, isRestrictivePracticeAuthorised: null,
    description: 'Evening insulin dose administered 90 minutes late.',
    immediateActionsTaken: 'BGL checked, on-call nurse consulted.',
    wereEmergencyServicesCalled: false, emergencyServicesDetails: null,
    witnessNames: null, witnessStatements: null, injuries: [], witnesses: [],
    qscReportedAt: null, qscReferenceNumber: null,
    reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null,
    resolvedAt: null, familyNotified: false, familyNotifiedAt: null,
    supportCoordinatorNotified: false, supportCoordinatorNotifiedAt: null,
    updatedAt: '2026-10-03T10:00:00Z',
    medicationContext: null, shiftContext: null, shiftNoteContext: null,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/incidents/inc-1']}>
      <Routes><Route path="/incidents/:id" element={<IncidentDetailPage />} /></Routes>
    </MemoryRouter>,
  )
}

const ZONES = ['Australia/Sydney', 'UTC', 'America/New_York'] as const

// L4-06. A reporter types 08:00 into the datetime-local field. The API stores those digits and sends them back with no zone
// ("2026-10-03T08:00:00": a provider-local wall-clock value). The detail page used to read the digits as UTC and convert, so Sydney
// showed "3 Oct 2026, 6:00 pm" for an incident at 08:00, and the edit form (which slices the digits) said 08:00. They must agree.
describe.each(ZONES)('IncidentDetailPage "Date & time" in %s', zone => {
  it.each([
    ['as the API sends it (zone-less wall clock)', '2026-10-03T08:00:00'],
    ['with 7 fraction digits (what .NET writes)', '2026-10-03T08:00:00.0000000'],
    ['even if a Z were ever appended (the digits are the answer)', '2026-10-03T08:00:00Z'],
  ])('shows the time that was typed, %s', (_label, incidentDateTime) => {
    if (!setZone(zone)) return
    mockUseIncident.mockReturnValue({ data: baseIncident({ incidentDateTime }), isLoading: false })

    renderPage()

    expect(screen.getByText(/^3 Oct 2026,? 8:00\s?(am|AM)$/)).toBeInTheDocument()
  })
})

// L4-07. The shift note's created time is an INSTANT; 22:00Z on the 2nd is 08:00 on Sat 3 Oct in Sydney, and the date line must say the 3rd.
describe('IncidentDetailPage shift-note date (an instant shown as a date)', () => {
  it.each([
    ['Australia/Sydney', '03/10/2026'],
    ['UTC', '02/10/2026'],
    ['America/New_York', '02/10/2026'],
  ])('in %s reads %s', (zone, expected) => {
    if (!setZone(zone)) return
    mockUseIncident.mockReturnValue({
      data: baseIncident({
        shiftNoteContext: { shiftNoteId: 'n1', excerpt: 'Fall near the bathroom.', flaggedCategories: ['Falls'], createdAt: '2026-10-02T22:00:00Z' },
      }),
      isLoading: false,
    })

    renderPage()

    expect(screen.getByText(expected)).toBeInTheDocument()
  })
})
