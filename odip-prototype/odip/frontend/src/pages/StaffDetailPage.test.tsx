import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import StaffDetailPage from './StaffDetailPage'
import type { StaffOverviewDto } from '@/api/types/staff'
import type { StaffDetailDto } from '@/api/types/staff'

const { mockUseStaffOverview, mockUseSettings } = vi.hoisted(() => ({
  mockUseStaffOverview: vi.fn(),
  mockUseSettings: vi.fn(() => ({ data: { qualificationWarningDays: 30 } })),
}))

vi.mock('@/api/hooks', () => ({
  useStaffOverview: mockUseStaffOverview,
  useSettings: mockUseSettings,
}))

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

function makeStaff(overrides: Partial<StaffDetailDto> = {}): StaffDetailDto {
  return {
    id: 'staff-1', firstName: 'Alex', lastName: 'Rivera', fullName: 'Alex Rivera', username: 'alex',
    role: 'SupportWorker', position: 'SupportWorker', email: 'alex@example.com', mobile: null,
    region: 'North', isDriverEligible: false, isFirstAidQualified: false, isMedicationCompetent: false,
    isManualHandlingCompetent: false, isOvernightEligible: false, isActive: true,
    firstAidExpiryDate: null, driverLicenceExpiryDate: null, manualHandlingExpiryDate: null,
    medicationCompetencyExpiryDate: null, workerScreeningNumber: null, workerScreeningExpiryDate: null,
    hasExpiredQualifications: false, notes: null,
    ...overrides,
  } as StaffDetailDto
}

function makeOverview(overrides: Partial<StaffOverviewDto> = {}): StaffOverviewDto {
  return {
    staff: makeStaff(),
    availability: [],
    upcomingShifts: [],
    upcomingTripAssignments: [],
    recentIncidents: [],
    recentCompletions: [],
    ...overrides,
  }
}

// Local Y/M/D, never toISOString (UTC) — the component compares against a local-midnight `today`,
// so a UTC-based string can silently land on the wrong side of midnight depending on the local
// timezone/time of day the suite runs (same hazard ClaimsTab.tsx's own toIsoDate helper documents).
function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function daysFromToday(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return toIsoDate(d)
}

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/staff/${id}`]}>
      <Routes>
        <Route path="/staff/:id" element={<StaffDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderAtTab(id: string, tab: string) {
  return render(
    <MemoryRouter initialEntries={[`/staff/${id}?tab=${tab}`]}>
      <Routes>
        <Route path="/staff/:id" element={<StaffDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseStaffOverview.mockReset()
  mockUseSettings.mockReturnValue({ data: { qualificationWarningDays: 30 } })
  setUserRole('Admin')
})

afterEach(() => {
  localStorage.clear()
})

describe('StaffDetailPage — loading/empty states', () => {
  it('shows a loading state', () => {
    mockUseStaffOverview.mockReturnValue({ data: undefined, isLoading: true })
    renderAt('staff-1')

    expect(screen.getByRole('status')).toHaveTextContent('Loading staff member…')
  })

  it('shows a not-found state when the overview is missing', () => {
    mockUseStaffOverview.mockReturnValue({ data: undefined, isLoading: false })
    renderAt('staff-1')

    expect(screen.getByText('Staff member not found')).toBeInTheDocument()
  })
})

describe('StaffDetailPage — header', () => {
  it('renders the name, active status, position/region, and Edit + Leave links for a write-capable role', () => {
    mockUseStaffOverview.mockReturnValue({ data: makeOverview(), isLoading: false })
    renderAt('staff-1')

    expect(screen.getByRole('heading', { name: 'Alex Rivera' })).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText(/SupportWorker.*North/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute('href', '/staff/staff-1/edit')
    expect(screen.getByRole('link', { name: /leave.*availability/i })).toHaveAttribute('href', '/rostering/leave?userId=staff-1')
  })

  it('starts the meta row at the region, with no stray leading separator, when the staff member has no position', () => {
    mockUseStaffOverview.mockReturnValue({ data: makeOverview({ staff: makeStaff({ position: undefined }) }), isLoading: false })
    renderAt('staff-1')

    // The span holds just the region — not " · North".
    expect(screen.getByText('North')).toBeInTheDocument()
    expect(screen.queryByText(/^\s*·/)).not.toBeInTheDocument()
  })

  it('shows Inactive status for an inactive staff member', () => {
    mockUseStaffOverview.mockReturnValue({ data: makeOverview({ staff: makeStaff({ isActive: false }) }), isLoading: false })
    renderAt('staff-1')

    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('hides the Edit link for a SupportWorker role', () => {
    setUserRole('SupportWorker')
    mockUseStaffOverview.mockReturnValue({ data: makeOverview(), isLoading: false })
    renderAt('staff-1')

    expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument()
  })
})

describe('StaffDetailPage — Availability tab (default)', () => {
  it('renders the AvailabilityList for the staff member', () => {
    mockUseStaffOverview.mockReturnValue({ data: makeOverview(), isLoading: false })
    renderAt('staff-1')

    // "Availability" itself is ambiguous — it's both the active TabNav button's label and
    // AvailabilityList's own section heading — so assert on the manage-link text unique to
    // AvailabilityList instead. It's ambiguous too (the header link plus the empty-state's own
    // repeated link), hence getAllByText rather than getByText.
    expect(screen.getAllByText(/manage on leave page/i).length).toBeGreaterThan(0)
  })

  it('flushes the list to the Card padding — AvailabilityList\'s own pl-8 indent (built for the Schedule accordion) read as a blank ~30px icon slot here', () => {
    mockUseStaffOverview.mockReturnValue({ data: makeOverview(), isLoading: false })
    renderAt('staff-1')

    // The list's own label sits under a wrapper carrying `[&>div]:p-0`, which zeroes the padding of
    // the wrapper's direct child (AvailabilityList's root) — jsdom has no CSS, so the class is the proof.
    const label = screen.getByText('Availability', { selector: 'p' })
    expect(label.closest('[class~="[&>div]:p-0"]')).not.toBeNull()
  })
})

describe('StaffDetailPage — Credentials tab', () => {
  it('shows an empty state when the staff member has no credentials on file', () => {
    mockUseStaffOverview.mockReturnValue({ data: makeOverview(), isLoading: false })
    renderAtTab('staff-1', 'credentials')

    expect(screen.getByText('No credentials on file')).toBeInTheDocument()
  })

  it('shows Expired for a past expiry date and Current for a far-future one', () => {
    mockUseStaffOverview.mockReturnValue({
      data: makeOverview({
        staff: makeStaff({
          isFirstAidQualified: true, firstAidExpiryDate: daysFromToday(-5),
          isDriverEligible: true, driverLicenceExpiryDate: daysFromToday(400),
        }),
      }),
      isLoading: false,
    })
    renderAtTab('staff-1', 'credentials')

    expect(screen.getByText('First Aid')).toBeInTheDocument()
    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.getByText('Driver Licence')).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument()
  })

  it('shows an expiring badge within the settings warning-day threshold', () => {
    mockUseSettings.mockReturnValue({ data: { qualificationWarningDays: 30 } })
    mockUseStaffOverview.mockReturnValue({
      data: makeOverview({
        staff: makeStaff({ isManualHandlingCompetent: true, manualHandlingExpiryDate: daysFromToday(10) }),
      }),
      isLoading: false,
    })
    renderAtTab('staff-1', 'credentials')

    expect(screen.getByText(/expires in 10 days/i)).toBeInTheDocument()
  })

  it('shows "No date set" for a qualification flag with no expiry date', () => {
    mockUseStaffOverview.mockReturnValue({
      data: makeOverview({ staff: makeStaff({ isMedicationCompetent: true, medicationCompetencyExpiryDate: null }) }),
      isLoading: false,
    })
    renderAtTab('staff-1', 'credentials')

    expect(screen.getByText('No date set')).toBeInTheDocument()
  })

  it('shows worker screening once an expiry date is present', () => {
    mockUseStaffOverview.mockReturnValue({
      data: makeOverview({ staff: makeStaff({ workerScreeningNumber: 'WWC-123', workerScreeningExpiryDate: daysFromToday(400) }) }),
      isLoading: false,
    })
    renderAtTab('staff-1', 'credentials')

    expect(screen.getByText('Worker Screening')).toBeInTheDocument()
  })

  // The one rule (lib/credentials.ts) the Qualifications list and the Dashboard count use too: worker screening has no qualification flag, so
  // it applies once it has an expiry date. A number alone is not a credential with something to expire.
  it('does not list worker screening for a number with no expiry date', () => {
    mockUseStaffOverview.mockReturnValue({
      data: makeOverview({ staff: makeStaff({ workerScreeningNumber: 'WWC-123', workerScreeningExpiryDate: null }) }),
      isLoading: false,
    })
    renderAtTab('staff-1', 'credentials')

    expect(screen.queryByText('Worker Screening')).not.toBeInTheDocument()
    expect(screen.getByText('No credentials on file')).toBeInTheDocument()
  })

  it('says "Expires today" on the day and "Expires in 1 day" the day before', () => {
    mockUseStaffOverview.mockReturnValue({
      data: makeOverview({
        staff: makeStaff({
          isFirstAidQualified: true, firstAidExpiryDate: daysFromToday(0),
          isDriverEligible: true, driverLicenceExpiryDate: daysFromToday(1),
        }),
      }),
      isLoading: false,
    })
    renderAtTab('staff-1', 'credentials')

    expect(screen.getByText('Expires today')).toBeInTheDocument()
    expect(screen.getByText('Expires in 1 day')).toBeInTheDocument()
  })
})

describe('StaffDetailPage — Upcoming tab', () => {
  it('renders upcoming shifts with a participant link and trip assignments with a trip link', () => {
    mockUseStaffOverview.mockReturnValue({
      data: makeOverview({
        upcomingShifts: [
          {
            shiftId: 'shift-1', serviceDate: '2026-09-20', startTime: '08:00:00', endTime: '16:00:00',
            endsNextDay: false, participantId: 'participant-1', participantName: 'Mia Chen', status: 'Published',
          },
        ],
        upcomingTripAssignments: [
          { assignmentId: 'assign-1', tripInstanceId: 'trip-1', tripName: 'Byron Bay Winter Weekender', startDate: '2026-09-21', endDate: '2026-09-24' },
        ],
      }),
      isLoading: false,
    })
    renderAtTab('staff-1', 'upcoming')

    expect(screen.getByRole('link', { name: 'Mia Chen' })).toHaveAttribute('href', '/participants/participant-1')
    expect(screen.getByRole('link', { name: 'Byron Bay Winter Weekender' })).toHaveAttribute('href', '/trips/trip-1')
  })

  it('shows empty messages when there is nothing upcoming', () => {
    mockUseStaffOverview.mockReturnValue({ data: makeOverview(), isLoading: false })
    renderAtTab('staff-1', 'upcoming')

    expect(screen.getByText('No shifts in the next 14 days')).toBeInTheDocument()
    expect(screen.getByText('No upcoming trip assignments')).toBeInTheDocument()
  })
})

describe('StaffDetailPage — Incidents tab', () => {
  it('links an incident row to its detail page', () => {
    mockUseStaffOverview.mockReturnValue({
      data: makeOverview({
        recentIncidents: [
          {
            id: 'inc-1', serviceType: 'Trip', tripInstanceId: null, tripName: null, incidentType: 'Injury',
            otherTypeSpecify: null, severity: 'Low', status: 'Closed', title: 'Minor graze',
            incidentDateTime: '2026-09-01T10:00:00Z', location: null, reportedByName: 'Jack',
            involvedParticipantId: null, involvedParticipantName: null, qscReportingStatus: 'NotRequired',
            isOverdue24h: false, createdAt: '2026-09-01T11:00:00Z', medicationAdministrationId: null,
            shiftId: null, shiftNoteId: null,
          },
        ],
      }),
      isLoading: false,
    })
    renderAtTab('staff-1', 'incidents')

    expect(screen.getByRole('link', { name: 'Minor graze' })).toHaveAttribute('href', '/incidents/inc-1')
  })

  it('shows an empty state when there are no recent incidents', () => {
    mockUseStaffOverview.mockReturnValue({ data: makeOverview(), isLoading: false })
    renderAtTab('staff-1', 'incidents')

    expect(screen.getByText('No recent incidents')).toBeInTheDocument()
  })
})

describe('StaffDetailPage — Completions tab', () => {
  it('renders recent completions with variance and links to the completions review page', () => {
    mockUseStaffOverview.mockReturnValue({
      data: makeOverview({
        recentCompletions: [
          {
            shiftId: 'shift-1', completionId: 'sc-1', participantName: 'Mia Chen', staffName: 'Alex Rivera',
            serviceDate: '2026-09-08', rosteredStart: '2026-09-08T08:00:00Z', rosteredEnd: '2026-09-08T16:00:00Z',
            actualStart: '2026-09-08T08:02:00Z', actualEnd: '2026-09-08T16:05:00Z',
            varianceMinutesStart: 2, varianceMinutesEnd: 5, status: 'Completed', timeZoneId: 'Australia/Brisbane',
            isOutlierVariance: false, varianceReviewMinutes: 15, returnCount: 0,
          },
        ],
      }),
      isLoading: false,
    })
    renderAtTab('staff-1', 'completions')

    expect(screen.getByText('Mia Chen')).toBeInTheDocument()
    expect(screen.getByText('+2 min')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open completions review/i })).toHaveAttribute('href', '/rostering/completions')
  })

  it('shows an empty state when there are no recent completions', () => {
    mockUseStaffOverview.mockReturnValue({ data: makeOverview(), isLoading: false })
    renderAtTab('staff-1', 'completions')

    expect(screen.getByText('No recent completions')).toBeInTheDocument()
  })
})

// Density verdict (mobile) — the header used to keep the Back / Leave & availability / Edit cluster
// `shrink-0` beside the H1, which squeezed the name to "C…" and pushed the page 10-41px wider than a
// phone (scrollWidth 400 at 390, 401 at 360). PageHeader now stacks the cluster on its own row below
// md; the cluster itself must be allowed to wrap. jsdom applies no CSS, so these assert the class contract.
describe('StaffDetailPage — mobile header and tap targets', () => {
  it('lets the Back / Leave / Edit cluster wrap instead of holding it at its full width', () => {
    mockUseStaffOverview.mockReturnValue({ data: makeOverview(), isLoading: false })
    renderAt('staff-1')

    const cluster = screen.getByRole('link', { name: /edit/i }).parentElement!
    expect(cluster).toContainElement(screen.getByRole('link', { name: /back to staff/i }))
    expect(cluster).toHaveClass('flex', 'flex-wrap')
    expect(cluster).not.toHaveClass('shrink-0')
  })

  it('gives the completions-review link the --tap-min floor (44px under a coarse pointer, unchanged on a mouse)', () => {
    mockUseStaffOverview.mockReturnValue({ data: makeOverview(), isLoading: false })
    renderAtTab('staff-1', 'completions')

    expect(screen.getByRole('link', { name: /open completions review/i })).toHaveClass('min-h-[var(--tap-min)]')
  })

  it('gives the participant, trip and incident row links the --tap-min floor', () => {
    mockUseStaffOverview.mockReturnValue({
      data: makeOverview({
        upcomingShifts: [
          {
            shiftId: 'shift-1', serviceDate: '2026-09-20', startTime: '08:00:00', endTime: '16:00:00',
            endsNextDay: false, participantId: 'participant-1', participantName: 'Mia Chen', status: 'Published',
          },
        ],
        upcomingTripAssignments: [
          { assignmentId: 'assign-1', tripInstanceId: 'trip-1', tripName: 'Byron Bay Winter Weekender', startDate: '2026-09-21', endDate: '2026-09-24' },
        ],
        recentIncidents: [
          {
            id: 'inc-1', serviceType: 'Trip', tripInstanceId: null, tripName: null, incidentType: 'Injury',
            otherTypeSpecify: null, severity: 'Low', status: 'Closed', title: 'Minor graze',
            incidentDateTime: '2026-09-01T10:00:00Z', location: null, reportedByName: 'Jack',
            involvedParticipantId: null, involvedParticipantName: null, qscReportingStatus: 'NotRequired',
            isOverdue24h: false, createdAt: '2026-09-01T11:00:00Z', medicationAdministrationId: null,
            shiftId: null, shiftNoteId: null,
          },
        ],
      }),
      isLoading: false,
    })

    renderAtTab('staff-1', 'upcoming')
    expect(screen.getByRole('link', { name: 'Mia Chen' })).toHaveClass('min-h-[var(--tap-min)]')
    expect(screen.getByRole('link', { name: 'Byron Bay Winter Weekender' })).toHaveClass('min-h-[var(--tap-min)]')

    cleanup()
    renderAtTab('staff-1', 'incidents')
    expect(screen.getByRole('link', { name: 'Minor graze' })).toHaveClass('min-h-[var(--tap-min)]')
  })
})

describe('StaffDetailPage — failed request vs. missing record (PageState)', () => {
  it('names a failed request as a failure, with a retry, and does not call it "Staff member not found"', () => {
    mockUseStaffOverview.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 500 } }, refetch: vi.fn() })
    renderAt('staff-1')

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this staff member")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('Staff member not found')).not.toBeInTheDocument()
  })

  it('shows "Staff member not found" for a 404, with nothing to retry', () => {
    mockUseStaffOverview.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 404 } }, refetch: vi.fn() })
    renderAt('staff-1')

    expect(screen.getByText('Staff member not found')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to staff' })).toHaveAttribute('href', '/staff')
  })

  it('shows "Staff member not found" for an answer with no record, and says "Loading staff member…" while it loads', () => {
    mockUseStaffOverview.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() })
    const { unmount } = renderAt('staff-1')
    expect(screen.getByText('Staff member not found')).toBeInTheDocument()
    unmount()

    mockUseStaffOverview.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    renderAt('staff-1')
    expect(screen.getByRole('status')).toHaveTextContent('Loading staff member…')
  })
})
