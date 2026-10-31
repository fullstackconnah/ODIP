import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
    awareAt: '2026-10-03T09:05:00Z', reportableClass: 'None', reportableClassReason: null, notifyDueAt: null, detailedReportDueAt: null, dueCountedWithoutHolidays: false,
    commissionDetailedReportedAt: null, commissionFinalReportRequested: false, commissionFinalReportedAt: null, timeZoneId: 'Australia/Sydney',
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
    expect(screen.getByRole('status')).toHaveTextContent('Loading incident…')
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

describe('IncidentDetailPage — Back', () => {
  it('is the icon Back before the title, a real link to the incident list named for where it goes', () => {
    mockUseIncident.mockReturnValue({ data: baseIncident(), isLoading: false })
    renderPage()
    const back = screen.getByRole('link', { name: 'Back to incidents' })
    expect(back).toHaveAttribute('href', '/incidents')
    // The icon Back left of the title (UI survey s.1), not a "Back" button beside Edit.
    expect(back).toHaveClass('min-w-[var(--tap-min)]')
    expect(back.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('IncidentDetailPage — failed request vs. missing record (PageState)', () => {
  it('names a failed request as a failure, with a retry, and does not call it "Incident not found"', () => {
    mockUseIncident.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 500 } }, refetch: vi.fn() })
    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this incident")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('Incident not found')).not.toBeInTheDocument()
  })

  it('shows "Incident not found" for a 404, with nothing to retry', () => {
    mockUseIncident.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 404 } }, refetch: vi.fn() })
    renderPage()

    expect(screen.getByText('Incident not found')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to incidents' })).toHaveAttribute('href', '/incidents')
  })

  it('shows "Incident not found" for an answer with no record, and says "Loading incident…" while it loads', () => {
    mockUseIncident.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() })
    const { unmount } = renderPage()
    expect(screen.getByText('Incident not found')).toBeInTheDocument()
    unmount()

    mockUseIncident.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading incident…')
  })
})

// PUT /incidents/:id is Admin, Coordinator and SuperAdmin only (IncidentsController.Update): ReadOnly and SupportWorker read the incident without an Edit.
describe('IncidentDetailPage — Edit by role', () => {
  it.each([['ReadOnly', false], ['SupportWorker', false], ['Admin', true], ['Coordinator', true]] as const)('%s: Edit offered %s', (role, offered) => {
    localStorage.setItem('odip_user', JSON.stringify({ role }))
    mockUseIncident.mockReturnValue({ data: baseIncident(), isLoading: false })
    renderPage()

    expect(screen.getByRole('heading', { name: 'Missed evening medication dose' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit' }) !== null).toBe(offered)
    localStorage.clear()
  })
})

// A read-only "Restrictive practice" block: the type, the linked practice or the text of one not on the register, and the stored determination.
describe('IncidentDetailPage — restrictive practice', () => {
  function block() {
    // The Card: its title row, then the card itself.
    return screen.getByRole('heading', { name: 'Restrictive practice' }).parentElement!.parentElement!
  }

  it('shows no restrictive practice block for another incident type', () => {
    mockUseIncident.mockReturnValue({ data: baseIncident(), isLoading: false })
    renderPage()
    expect(screen.queryByRole('heading', { name: 'Restrictive practice' })).not.toBeInTheDocument()
  })

  it('shows the type, the linked practice and Not authorised for a use that was not authorised', () => {
    mockUseIncident.mockReturnValue({ data: baseIncident({
      incidentType: 'RestrictivePracticeUse', restrictivePracticeType: 'PhysicalRestraint', restrictivePracticeId: 'rp-1',
      restrictivePracticeDescription: 'Two-person hold during transfers.', isRestrictivePracticeAuthorised: false,
    }), isLoading: false })
    renderPage()

    const card = block()
    expect(within(card).getByText('Physical restraint')).toBeInTheDocument()
    expect(within(card).getByText('Linked practice')).toBeInTheDocument()
    expect(within(card).getByText('Two-person hold during transfers.')).toBeInTheDocument()
    expect(within(card).getByText('Not authorised')).toBeInTheDocument()
  })

  it('shows the text of a practice not on the register, and Authorised when it was', () => {
    mockUseIncident.mockReturnValue({ data: baseIncident({
      incidentType: 'RestrictivePracticeUse', restrictivePracticeType: 'Seclusion', restrictivePracticeId: null,
      unapprovedRestrictivePracticeDetails: 'Locked the back door.', isRestrictivePracticeAuthorised: false,
    }), isLoading: false })
    const { unmount } = renderPage()
    expect(within(block()).getByText('Practice not on the register')).toBeInTheDocument()
    expect(within(block()).getByText('Locked the back door.')).toBeInTheDocument()
    unmount()

    mockUseIncident.mockReturnValue({ data: baseIncident({
      incidentType: 'RestrictivePracticeUse', restrictivePracticeType: 'Seclusion', restrictivePracticeId: 'rp-2',
      restrictivePracticeDescription: 'Seclusion room.', isRestrictivePracticeAuthorised: true,
    }), isLoading: false })
    renderPage()
    expect(within(block()).getByText('Authorised')).toBeInTheDocument()
  })
})

// Review S1: the API leaves a null flag out of the JSON, so "not determined" arrives as a missing key, not null.
describe('IncidentDetailPage — restrictive practice not determined', () => {
  it('shows "Not determined", not a Not authorised badge, when the flag is missing from the payload', () => {
    const { isRestrictivePracticeAuthorised: _omitted, ...incident } = baseIncident({
      incidentType: 'RestrictivePracticeUse', restrictivePracticeType: 'Seclusion', restrictivePracticeId: null,
      unapprovedRestrictivePracticeDetails: 'Locked the back door.',
    })
    void _omitted
    mockUseIncident.mockReturnValue({ data: incident, isLoading: false })
    renderPage()

    const card = screen.getByRole('heading', { name: 'Restrictive practice' }).parentElement!.parentElement!
    expect(within(card).getByText('Not determined')).toBeInTheDocument()
    expect(within(card).queryByText('Not authorised')).not.toBeInTheDocument()
  })
})

describe('IncidentDetailPage - NDIS Commission reporting row', () => {
  const required = {
    reportableClass: 'Within24h' as const, qscReportingStatus: 'Required' as const,
    notifyDueAt: '2026-11-03T04:15:00Z', detailedReportDueAt: '2026-11-09T12:59:59Z',
  }

  it('says Not reportable for class None', () => {
    mockUseIncident.mockReturnValue({ data: baseIncident(), isLoading: false })
    renderPage()
    expect(screen.getByText('NDIS Commission')).toBeInTheDocument()
    expect(screen.getByText('Not reportable')).toBeInTheDocument()
  })

  it('marks an empty value cell with a dash the screen reader names', () => {
    mockUseIncident.mockReturnValue({ data: baseIncident({ ...required, notifyDueAt: null, detailedReportDueAt: null }), isLoading: false })
    renderPage()
    expect(screen.getByLabelText('No reporting deadline')).toHaveTextContent('–')
  })

  it('shows the overdue line in words and the 5-day line when the deadline has passed', () => {
    mockUseIncident.mockReturnValue({ data: baseIncident({ ...required, notifyDueAt: '2020-01-01T00:00:00Z', detailedReportDueAt: '2099-01-01T00:00:00Z' }), isLoading: false })
    renderPage()
    expect(screen.getByText(/^Overdue by \d+ days?$/)).toBeInTheDocument()
    expect(screen.getByText(/^5-day report due by /)).toBeInTheDocument()
  })

  it('names the zone-aware deadline while it is still ahead, and the without-holidays note', () => {
    mockUseIncident.mockReturnValue({ data: baseIncident({ ...required, notifyDueAt: '2099-01-02T04:15:00Z', dueCountedWithoutHolidays: true }), isLoading: false })
    renderPage()
    expect(screen.getByText(/^Tell the NDIS Commission by Fri 2 Jan 2099, 3:15 pm \(in /)).toBeInTheDocument()
    expect(screen.getByText('Counted without public holidays')).toBeInTheDocument()
  })
})
