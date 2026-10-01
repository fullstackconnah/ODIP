import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import PortalShiftDetailPage from './PortalShiftDetailPage'
import type { PortalShiftDetailDto } from '@/api/types'
import { emptyShiftPackage, emptyCompletionPackage } from '@/test/fixtures/shiftPackage'

const {
  mockUsePortalShiftDetail, mockUseShiftNotes, mockUseStartShift, mockUseFinishShift,
  startMutateAsync, finishMutateAsync,
} = vi.hoisted(() => ({
  mockUsePortalShiftDetail: vi.fn(),
  mockUseShiftNotes: vi.fn(),
  mockUseStartShift: vi.fn(),
  mockUseFinishShift: vi.fn(),
  startMutateAsync: vi.fn(),
  finishMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  usePortalShiftDetail: mockUsePortalShiftDetail,
  useShiftNotes: mockUseShiftNotes,
  useStartShift: mockUseStartShift,
  useFinishShift: mockUseFinishShift,
}))

// The Shift notes section is covered in its own test file (ShiftNotesSection.test.tsx) — stubbed
// here so this page's tests stay about page composition, not notes hooks.
vi.mock('./components/ShiftNotesSection', () => ({
  ShiftNotesSection: ({ shiftId }: { shiftId: string }) => <div data-testid="shift-notes-section">{shiftId}</div>,
}))

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/portal/shifts/${id}`]}>
      <Routes>
        <Route path="/portal/shifts/:id" element={<PortalShiftDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function makeDetail(overrides: Partial<PortalShiftDetailDto> = {}): PortalShiftDetailDto {
  return {
    id: 'shift-1',
    serviceDate: '2026-08-17',
    startTime: '09:00:00',
    endTime: '17:00:00',
    endsNextDay: false,
    durationHours: 8,
    ratio: 'OneToOne',
    nightType: 'None',
    status: 'Published',
    notes: null,
    participant: {
      id: 'participant-1',
      fullName: 'Mia Chen',
      isHighSupport: true,
      isIntensiveSupport: false,
      hasRestrictivePracticeFlag: false,
      supportRatio: 'OneToOne',
      overnightSupport: 'None',
      mobilityAidWheelchair: true,
      mobilityAidWalker: false,
      mobilitySupportOptions: [],
      requiresHiLoBed: false,
      requiresHoist: true,
      requiresShowerChair: false,
      requiresCommode: false,
      requiresStandingMachine: false,
      mobilityNotes: 'Two-person transfer required.',
      equipmentRequirements: null,
      transportRequirements: null,
      medicalSummary: null,
      behaviourRiskSummary: null,
    },
    routines: [
      {
        id: 'routine-1',
        participantId: 'participant-1',
        title: 'Morning routine',
        description: 'Gentle wake, warm drink.',
        category: 'PersonalCare',
        days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        startTime: null,
        endTime: null,
        isCritical: true,
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'routine-2',
        participantId: 'participant-1',
        title: 'Wednesday evening routine',
        description: 'Only relevant on Wednesday evenings — should be filtered out for this Monday day shift.',
        category: 'Sleep',
        days: ['Wednesday'],
        startTime: '20:00:00',
        endTime: '21:00:00',
        isCritical: false,
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    riskEntries: [
      {
        id: 'risk-1',
        participantId: 'participant-1',
        atRiskParty: 'Staff',
        description: 'Risk of aggression towards support staff during transfers.',
        mitigationNotes: 'Two-person support during personal care.',
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    medications: [
      {
        id: 'med-1',
        name: 'Paracetamol',
        strength: '500mg',
        doseDescription: '2 tablets',
        type: 'Regular',
        timesOfDay: '08:00,20:00',
        isHighRisk: true,
        isPsychotropic: false,
        isChemicalRestraint: false,
        drugSchedule: 'Unscheduled',
        supportLevel: 'Assist',
        prnIndication: null,
      },
    ],
    completion: null,
    returnCount: 0,
    lastReturnReason: null,
    ...emptyShiftPackage(),
    ...overrides,
  }
}

function makeCompletion(overrides: Partial<NonNullable<PortalShiftDetailDto['completion']>> = {}) {
  return {
    id: 'sc-1',
    shiftId: 'shift-1',
    actualStart: '2026-08-17T08:58:00Z',
    actualEnd: null,
    timeZoneId: 'Australia/Brisbane',
    geolocationDeclined: false,
    startWasManual: false,
    submittedByUserId: 'staff-1',
    submittedByName: "Jack O'Sullivan",
    startedAt: '2026-08-17T08:58:00Z',
    submittedAt: null,
    reviewedByUserId: null,
    reviewedByName: null,
    reviewedAt: null,
    reviewOutcome: null,
    returnReason: null,
    varianceMinutesStart: -2,
    varianceMinutesEnd: 0,
    isOutlierVariance: false,
    varianceReviewMinutes: 15,
    shiftReturnCount: 0,
    incidents: [],
    ...emptyCompletionPackage(),
    ...overrides,
  }
}

beforeEach(() => {
  mockUsePortalShiftDetail.mockReset()
  mockUseShiftNotes.mockReset().mockReturnValue({ data: [] })
  startMutateAsync.mockReset().mockResolvedValue(undefined)
  finishMutateAsync.mockReset().mockResolvedValue(undefined)
  mockUseStartShift.mockReset().mockReturnValue({ mutateAsync: startMutateAsync, isPending: false })
  mockUseFinishShift.mockReset().mockReturnValue({ mutateAsync: finishMutateAsync, isPending: false })
  localStorage.removeItem('odip_user')
})

afterEach(() => {
  localStorage.removeItem('odip_user')
})

describe('PortalShiftDetailPage', () => {
  it('renders the shift time/status and participant summary flags', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: makeDetail(), isLoading: false, isError: false })
    renderAt('shift-1')

    expect(screen.getByRole('heading', { name: 'Mia Chen' })).toBeInTheDocument()
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(screen.getByText(/high support/i)).toBeInTheDocument()
    expect(screen.getByText(/wheelchair/i)).toBeInTheDocument()
    expect(screen.getByText(/hoist/i)).toBeInTheDocument()
    expect(screen.getByText('Two-person transfer required.')).toBeInTheDocument()
  })

  it('renders the shift notes section for the current shift', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: makeDetail(), isLoading: false, isError: false })
    renderAt('shift-1')

    expect(screen.getByTestId('shift-notes-section')).toHaveTextContent('shift-1')
  })

  it('shows only the shift-relevant routine (untimed critical), filtering out the unrelated one', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: makeDetail(), isLoading: false, isError: false })
    renderAt('shift-1')

    expect(screen.getByText('Morning routine')).toBeInTheDocument()
    expect(screen.queryByText('Wednesday evening routine')).not.toBeInTheDocument()
  })

  it('renders active risk entries with a party badge and description', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: makeDetail(), isLoading: false, isError: false })
    renderAt('shift-1')

    expect(screen.getByText(/aggression towards support staff/i)).toBeInTheDocument()
    expect(screen.getByText('Staff')).toBeInTheDocument()
    expect(screen.getByText(/two-person support during personal care/i)).toBeInTheDocument()
  })

  it('shows an empty-state message when there are no risk entries', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: makeDetail({ riskEntries: [] }), isLoading: false, isError: false })
    renderAt('shift-1')

    expect(screen.getByText(/no risks recorded for this participant/i)).toBeInTheDocument()
  })

  it('renders the active medications summary with badges', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: makeDetail(), isLoading: false, isError: false })
    renderAt('shift-1')

    expect(screen.getByText(/Paracetamol 500mg/)).toBeInTheDocument()
    expect(screen.getByText(/2 tablets/)).toBeInTheDocument()
    expect(screen.getByText(/high risk/i)).toBeInTheDocument()
  })

  it('shows a not-found message when the shift errors (foreign/nonexistent shift id)', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true })
    renderAt('someone-elses-shift')

    expect(screen.getByText(/couldn't be found/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('offers a retry action on the error state, for a failed request as much as a real 404', () => {
    const refetch = vi.fn()
    mockUsePortalShiftDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    renderAt('shift-1')

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('announces a loading state rather than a silent gap', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    renderAt('shift-1')

    expect(screen.getByRole('status')).toHaveTextContent(/loading shift/i)
  })
})

// ── Shift completion card (design spec §4) ──────────────────
function grantGeolocation(latitude = -27.5, longitude = 153.02) {
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (success: (pos: unknown) => void) => success({ coords: { latitude, longitude } }) },
  })
}

function declineGeolocation() {
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (_success: unknown, error: (err: unknown) => void) => error(new Error('User denied Geolocation')) },
  })
}

describe('PortalShiftDetailPage — shift completion card', () => {
  afterEach(() => {
    // @ts-expect-error - test-only cleanup of a property this suite itself defines per-test
    delete global.navigator.geolocation
  })

  it('shows a Start shift button for a Published shift', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: makeDetail({ status: 'Published' }), isLoading: false, isError: false })
    renderAt('shift-1')

    expect(screen.getByRole('button', { name: /start shift/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /finish shift/i })).not.toBeInTheDocument()
  })

  it('starts the shift with a geolocation stamp when permission is granted', async () => {
    grantGeolocation(-27.5, 153.02)
    mockUsePortalShiftDetail.mockReturnValue({ data: makeDetail({ status: 'Published' }), isLoading: false, isError: false })
    renderAt('shift-1')

    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))

    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledWith({
      id: 'shift-1',
      data: { latitude: -27.5, longitude: 153.02, geolocationDeclined: false },
    }))
  })

  it('starts the shift with geolocationDeclined and no coordinates when permission is denied', async () => {
    declineGeolocation()
    mockUsePortalShiftDetail.mockReturnValue({ data: makeDetail({ status: 'Published' }), isLoading: false, isError: false })
    renderAt('shift-1')

    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))

    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledWith({
      id: 'shift-1',
      data: { geolocationDeclined: true },
    }))
  })

  it('shows the elapsed time and a Finish shift button for an InProgress shift', () => {
    mockUsePortalShiftDetail.mockReturnValue({
      data: makeDetail({ status: 'InProgress', completion: makeCompletion() }),
      isLoading: false,
      isError: false,
    })
    renderAt('shift-1')

    expect(screen.getByText(/in progress/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /finish shift/i })).toBeInTheDocument()
  })

  it('disables Finish with an inline hint until a shift note exists', () => {
    mockUseShiftNotes.mockReturnValue({ data: [] })
    mockUsePortalShiftDetail.mockReturnValue({
      data: makeDetail({ status: 'InProgress', completion: makeCompletion() }),
      isLoading: false,
      isError: false,
    })
    renderAt('shift-1')

    expect(screen.getByRole('button', { name: /finish shift/i })).toBeDisabled()
    expect(screen.getByText(/add a shift note before finishing/i)).toBeInTheDocument()
  })

  it('enables Finish once useShiftNotes returns a row, and submits with a geolocation stamp', async () => {
    grantGeolocation(-27.4, 153.03)
    mockUseShiftNotes.mockReturnValue({
      data: [{ id: 'note-1', shiftId: 'shift-1', authorUserId: 's-1', authorName: 'A', body: 'ok', createdAt: '2026-08-17T09:00:00Z', updatedAt: '2026-08-17T09:00:00Z', flaggedCategories: [], flagsAcknowledgedAt: null, incidentId: null }],
    })
    mockUsePortalShiftDetail.mockReturnValue({
      data: makeDetail({ status: 'InProgress', completion: makeCompletion() }),
      isLoading: false,
      isError: false,
    })
    renderAt('shift-1')

    const finishButton = screen.getByRole('button', { name: /finish shift/i })
    expect(finishButton).not.toBeDisabled()
    fireEvent.click(finishButton)

    await waitFor(() => expect(finishMutateAsync).toHaveBeenCalledWith({
      id: 'shift-1',
      data: { latitude: -27.4, longitude: 153.03, geolocationDeclined: false },
    }))
  })

  it('shows a static submitted banner for PendingReview, with no Start/Finish actions', () => {
    mockUsePortalShiftDetail.mockReturnValue({
      data: makeDetail({ status: 'PendingReview', completion: makeCompletion({ actualEnd: '2026-08-17T17:05:00Z', submittedAt: '2026-08-17T17:05:00Z' }) }),
      isLoading: false,
      isError: false,
    })
    renderAt('shift-1')

    expect(screen.getByText(/submitted.*awaiting review/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start shift/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /finish shift/i })).not.toBeInTheDocument()
  })

  it('shows a Returned banner with the reason above Start, when returnCount > 0 on a Published shift', () => {
    mockUsePortalShiftDetail.mockReturnValue({
      data: makeDetail({ status: 'Published', returnCount: 1, lastReturnReason: 'Actual times looked off by an hour — please recheck.' }),
      isLoading: false,
      isError: false,
    })
    renderAt('shift-1')

    expect(screen.getByText(/actual times looked off by an hour/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start shift/i })).toBeInTheDocument()
  })

  it('shows a read-only completed summary with variance and approver, and no action buttons', () => {
    mockUsePortalShiftDetail.mockReturnValue({
      data: makeDetail({
        status: 'Completed',
        completion: makeCompletion({
          actualEnd: '2026-08-17T17:05:00Z',
          varianceMinutesStart: -2,
          varianceMinutesEnd: 5,
          reviewOutcome: 'Approved',
          reviewedByName: 'Callum Radford',
        }),
      }),
      isLoading: false,
      isError: false,
    })
    renderAt('shift-1')

    expect(screen.getByText(/-2 min/)).toBeInTheDocument()
    expect(screen.getByText(/\+5 min/)).toBeInTheDocument()
    expect(screen.getByText(/Callum Radford/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start shift/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /finish shift/i })).not.toBeInTheDocument()
  })

  it('hides the Start button for a ReadOnly user, per canCompleteOwnShifts', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    mockUsePortalShiftDetail.mockReturnValue({ data: makeDetail({ status: 'Published' }), isLoading: false, isError: false })
    renderAt('shift-1')

    expect(screen.queryByRole('button', { name: /start shift/i })).not.toBeInTheDocument()
  })

  it('shows an error message and lets the worker retry when Start fails', async () => {
    grantGeolocation()
    startMutateAsync.mockRejectedValueOnce(new Error('network'))
    mockUsePortalShiftDetail.mockReturnValue({ data: makeDetail({ status: 'Published' }), isLoading: false, isError: false })
    renderAt('shift-1')

    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn't start this shift/i))
  })
})
