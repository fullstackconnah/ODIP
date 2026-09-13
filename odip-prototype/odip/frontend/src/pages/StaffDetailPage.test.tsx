import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

    expect(screen.getByText('Loading...')).toBeInTheDocument()
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

  it('only shows worker screening when a number or expiry date is present', () => {
    mockUseStaffOverview.mockReturnValue({
      data: makeOverview({ staff: makeStaff({ workerScreeningNumber: 'WWC-123', workerScreeningExpiryDate: daysFromToday(400) }) }),
      isLoading: false,
    })
    renderAtTab('staff-1', 'credentials')

    expect(screen.getByText('Worker Screening')).toBeInTheDocument()
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
