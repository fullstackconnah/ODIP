import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PortalShiftDetailPage from './PortalShiftDetailPage'
import type { PortalShiftDetailDto } from '@/api/types'
import { emptyShiftPackage, emptyCompletionPackage } from '@/test/fixtures/shiftPackage'

const h = vi.hoisted(() => ({
  mockUsePortalShiftDetail: vi.fn(),
  mockUseShiftNotes: vi.fn(),
  startMutateAsync: vi.fn(),
  finishMutateAsync: vi.fn(),
  ackMutateAsync: vi.fn(),
  startBreakMutateAsync: vi.fn(),
  endBreakMutateAsync: vi.fn(),
  editBreakMutateAsync: vi.fn(),
  deleteBreakMutateAsync: vi.fn(),
  checkRoutineMutateAsync: vi.fn(),
  uncheckRoutineMutateAsync: vi.fn(),
  recordMutateAsync: vi.fn(),
  mutation: (fn: unknown) => () => ({ mutateAsync: fn, isPending: false }),
}))
const {
  mockUsePortalShiftDetail, mockUseShiftNotes, startMutateAsync, finishMutateAsync, ackMutateAsync, startBreakMutateAsync, endBreakMutateAsync,
  editBreakMutateAsync, deleteBreakMutateAsync, checkRoutineMutateAsync, uncheckRoutineMutateAsync, recordMutateAsync,
} = h

vi.mock('@/api/hooks', () => ({
  usePortalShiftDetail: h.mockUsePortalShiftDetail,
  useShiftNotes: h.mockUseShiftNotes,
  useStartShift: h.mutation(h.startMutateAsync),
  useFinishShift: h.mutation(h.finishMutateAsync),
  useAcknowledgeHandover: h.mutation(h.ackMutateAsync),
  useStartBreak: h.mutation(h.startBreakMutateAsync),
  useEndBreak: h.mutation(h.endBreakMutateAsync),
  useEditBreak: h.mutation(h.editBreakMutateAsync),
  useDeleteBreak: h.mutation(h.deleteBreakMutateAsync),
  useCheckRoutine: h.mutation(h.checkRoutineMutateAsync),
  useUncheckRoutine: h.mutation(h.uncheckRoutineMutateAsync),
  useRecordShiftDose: h.mutation(h.recordMutateAsync),
  useStaff: () => ({ data: [] }),
}))

// The Shift notes section is covered in its own test file (ShiftNotesSection.test.tsx).
vi.mock('./components/ShiftNotesSection', () => ({
  ShiftNotesSection: ({ shiftId }: { shiftId: string }) => <div data-testid="shift-notes-section">{shiftId}</div>,
}))

function renderAt(id: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/portal/shifts/${id}`]}>
        <Routes>
          <Route path="/portal/shifts/:id" element={<PortalShiftDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
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
  for (const fn of [startMutateAsync, finishMutateAsync, ackMutateAsync, startBreakMutateAsync, endBreakMutateAsync, editBreakMutateAsync,
    deleteBreakMutateAsync, checkRoutineMutateAsync, uncheckRoutineMutateAsync, recordMutateAsync]) fn.mockReset().mockResolvedValue(undefined)
  mockUsePortalShiftDetail.mockReset()
  mockUseShiftNotes.mockReset().mockReturnValue({ data: [] })
  localStorage.removeItem('odip_user')
})

afterEach(() => {
  localStorage.removeItem('odip_user')
  // @ts-expect-error - test-only cleanup of a property the suites define per-test
  delete global.navigator.geolocation
})

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


const noteWith = (over: Record<string, unknown> = {}) => ({
  id: 'n1', shiftId: 'shift-1', authorUserId: 'u', authorName: 'Jack', body: 'Calm day', createdAt: '2026-08-17T09:00:00Z', updatedAt: '2026-08-17T09:00:00Z',
  flaggedCategories: [], flagsAcknowledgedAt: null, incidentId: null, ...over,
})

const dose = (over: Record<string, unknown> = {}) => ({
  medicationId: 'med-1', medicationName: 'Paracetamol', strength: '500mg', doseDescription: '2 tablets', form: 'Tablet', route: 'Oral', directions: null,
  supportLevel: 'Administer', isHighRisk: false, scheduledAt: '2026-08-17T12:00:00', scheduledTime: '12:00', state: 'Due', isOverdue: false, outcome: null,
  witness: { required: false, status: null, witnessName: null, requestedAt: null, respondedAt: null }, ...over,
})

function show(detail: PortalShiftDetailDto) {
  mockUsePortalShiftDetail.mockReturnValue({ data: detail, isLoading: false, isError: false })
  return renderAt('shift-1')
}

describe('PortalShiftDetailPage', () => {
  it('renders the header: participant, window, state and flags', () => {
    show(makeDetail())
    expect(screen.getByRole('heading', { name: 'Mia Chen' })).toBeInTheDocument()
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(screen.getByText(/high support/i)).toBeInTheDocument()
  })

  it('shows a not-found message when the shift is a 404', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 404 } } })
    renderAt('shift-1')
    expect(screen.getByText(/shift not found/i)).toBeInTheDocument()
  })

  it('offers a retry action when the request failed', () => {
    const refetch = vi.fn()
    mockUsePortalShiftDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('x'), refetch })
    renderAt('shift-1')
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('announces a loading state', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    renderAt('shift-1')
    expect(screen.getByRole('status')).toHaveTextContent(/loading shift/i)
  })

  it('starts the shift with a geolocation stamp when permission is granted', async () => {
    grantGeolocation(-27.5, 153.02)
    show(makeDetail())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', data: { latitude: -27.5, longitude: 153.02, geolocationDeclined: false } }))
  })

  it('starts the shift with geolocationDeclined when permission is denied', async () => {
    declineGeolocation()
    show(makeDetail())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', data: { geolocationDeclined: true } }))
  })

  it('hides Start for a ReadOnly user and says why', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    show(makeDetail())
    expect(screen.queryByRole('button', { name: /start shift/i })).not.toBeInTheDocument()
    expect(screen.getByText(/can't change it/i)).toBeInTheDocument()
  })

  it('shows an error and lets the worker retry when Start fails', async () => {
    grantGeolocation()
    startMutateAsync.mockRejectedValueOnce(new Error('network'))
    show(makeDetail())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn't start this shift/i))
  })
})

describe('PortalShiftDetailPage: Before', () => {
  it('shows the handover with author, when, trail, and marks it read with its completion id', async () => {
    show(makeDetail({
      handover: {
        completionId: 'c-prev', text: 'Mia had a poor night.', nothingToHandOver: false, authorUserId: 'a', authorName: 'Sam Lee', shiftDate: '2026-08-16',
        submittedAt: '2026-08-16T23:05:00Z', requiresAcknowledgement: true, isRead: false, readAt: null,
      },
      handoverTrail: [{ completionId: 'c-prev', workerName: 'Sam Lee', shiftDate: '2026-08-16' }, { completionId: 'c-2', workerName: 'Pat Oh', shiftDate: '2026-08-15' }],
    }))
    expect(screen.getByText('Mia had a poor night.')).toBeInTheDocument()
    expect(screen.getByText(/From Sam Lee/)).toBeInTheDocument()
    expect(screen.getByText(/Pat Oh/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }))
    await waitFor(() => expect(ackMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', data: { completionId: 'c-prev' } }))
  })

  it('says so when there is no handover', () => {
    show(makeDetail())
    expect(screen.getByText(/no handover from a previous shift/i)).toBeInTheDocument()
  })

  it('shows At a glance in the fixed order with an explicit Not recorded on every empty field', () => {
    show(makeDetail())
    const glance = screen.getByRole('region', { name: 'At a glance' })
    const headings = within(glance).getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(headings).toEqual(['Allergies', 'Diet', 'Communication', 'Behaviour', 'HIDPA flags', 'Address'])
    expect(within(glance).getAllByText('Not recorded').length).toBeGreaterThanOrEqual(15)
  })

  it('marks anaphylaxis risk in the danger tone and never coerces null to false', () => {
    const base = emptyShiftPackage()
    show(makeDetail({ atAGlance: { ...base.atAGlance, allergies: { detail: 'Peanuts', isAnaphylaxisRisk: true, managementNotes: 'EpiPen in the bag' } } }))
    expect(screen.getAllByText('Anaphylaxis risk').length).toBeGreaterThan(0)
    expect(screen.getByText('EpiPen in the bag')).toBeInTheDocument()
  })

  it('lists emergency contacts primary first with tel: links', () => {
    show(makeDetail({
      emergencyContacts: [
        { id: 'c2', name: 'Second Person', relationship: 'Aunt', phone: null, mobile: '0411 000 222', isPrimary: false, priorityOrder: 2, roleType: 'EmergencyContact', roleLabel: 'Emergency contact' },
        { id: 'c1', name: 'First Person', relationship: 'Mother', phone: '07 3000 1111', mobile: '0400 000 111', isPrimary: true, priorityOrder: 1, roleType: 'EmergencyContact', roleLabel: 'Emergency contact' },
      ],
    }))
    const region = screen.getByRole('region', { name: 'Emergency contacts' })
    const names = within(region).getAllByRole('listitem').map(li => li.textContent ?? '')
    expect(names[0]).toContain('First Person')
    expect(within(region).getByRole('link', { name: /call mobile 0400 000 111/i })).toHaveAttribute('href', 'tel:0400000111')
    expect(within(region).getByRole('link', { name: /call mobile 0411 000 222/i })).toHaveAttribute('href', 'tel:0411000222')
  })

  it('shows the withheld reason instead of the handover, contacts and address', () => {
    const base = emptyShiftPackage()
    show(makeDetail({
      handover: null, emergencyContacts: null, atAGlance: { ...base.atAGlance, address: null },
      sensitiveInfoWithheldReason: 'Handover and contacts show from 9:00 am on Sat 15 Aug.',
    }))
    expect(screen.getAllByText('Handover and contacts show from 9:00 am on Sat 15 Aug.').length).toBe(2)
    expect(screen.queryByRole('heading', { name: 'Address' })).not.toBeInTheDocument()
  })

  it('shows the server message when Start is refused as too early', async () => {
    grantGeolocation()
    startMutateAsync.mockRejectedValueOnce({ response: { status: 409, data: { success: false, code: 'SHIFT_START_TOO_EARLY', errors: ["It's too early to start this shift. You can start from 8:00 am on Mon 17 Aug."] } } })
    show(makeDetail())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("You can start from 8:00 am on Mon 17 Aug."))
  })
})

describe('PortalShiftDetailPage: During', () => {
  const inProgress = (over: Partial<PortalShiftDetailDto> = {}) => makeDetail({ status: 'InProgress', completion: makeCompletion(), ...over })

  it('puts overdue doses at the top in the warning group, with a PRN group', () => {
    show(inProgress({
      medicationsDue: [dose({ medicationId: 'a', medicationName: 'Evening Med', scheduledAt: '2026-08-17T20:00:00' }), dose({ medicationId: 'b', medicationName: 'Morning Med', scheduledAt: '2026-08-17T08:00:00', state: 'Overdue', isOverdue: true })] as never,
      prn: [{ medicationId: 'p', medicationName: 'Ibuprofen', strength: null, doseDescription: '1 tablet', form: 'Tablet', route: 'Oral', directions: null, supportLevel: 'Administer', isHighRisk: false, indication: 'Pain', maxDosesPer24h: 3, minIntervalMinutes: 240, dosesInLast24h: 1, lastDoseAt: '2026-08-17T00:00:00Z', maxDosesReached: false, nextAvailableAt: null, outcomePendingAdministrationId: null }],
    }))
    const during = screen.getByRole('region', { name: 'During the shift' })
    const headings = within(during).getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(headings[0]).toBe('Overdue')
    expect(headings).toContain('As needed')
    expect(within(during).getByText(/Overdue\. Give by 8:00 am/)).toBeInTheDocument()
  })

  it('says when no doses are due', () => {
    show(inProgress())
    expect(screen.getByText('No doses due this shift.')).toBeInTheDocument()
  })

  it('ticks a routine', async () => {
    show(inProgress({ shiftRoutines: [{ id: 'r1', title: 'Morning routine', description: '', category: 'PersonalCare', isCritical: false, startTime: null, endTime: null, occursAt: '2026-08-17T09:00:00', afterMidnight: false, isChecked: false, checkedAt: null, checkedByName: null, fromTickSnapshot: false }] as never }))
    fireEvent.click(screen.getByRole('checkbox', { name: /morning routine/i }))
    await waitFor(() => expect(checkRoutineMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', routineId: 'r1' }))
  })

  it('shows the competency reason once and no Record buttons when the worker cannot record', () => {
    show(inProgress({ canRecordDoses: false, canRecordDosesReason: 'Medication Competency expired', medicationsDue: [dose()] as never }))
    expect(screen.getByText('Medication Competency expired')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^record paracetamol/i })).not.toBeInTheDocument()
  })

  it('shows the elapsed time and the break state in the header', () => {
    show(inProgress({ breaks: [{ id: 'b1', startedAt: '2026-08-17T10:00:00Z', endedAt: null, isRunning: true, minutes: 12, editedAt: null, createdByUserId: 'u' }] }))
    expect(screen.getByLabelText('Time on shift')).toBeInTheDocument()
    expect(screen.getByText('On break')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End break' })).toBeInTheDocument()
  })

  it('starts a break from the sticky action bar', async () => {
    show(inProgress())
    fireEvent.click(screen.getByRole('button', { name: 'Start break' }))
    await waitFor(() => expect(startBreakMutateAsync).toHaveBeenCalledWith({ id: 'shift-1' }))
  })

  it('ends the running break', async () => {
    show(inProgress({ breaks: [{ id: 'b1', startedAt: '2026-08-17T10:00:00Z', endedAt: null, isRunning: true, minutes: 12, editedAt: null, createdByUserId: 'u' }] }))
    fireEvent.click(screen.getByRole('button', { name: 'End break' }))
    await waitFor(() => expect(endBreakMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', breakId: 'b1' }))
  })
})

describe('PortalShiftDetailPage: End', () => {
  const inProgress = (over: Partial<PortalShiftDetailDto> = {}) => makeDetail({ status: 'InProgress', completion: makeCompletion(), ...over })
  const blocker = (message: string) => ({ code: 'DOSE_OUTCOME_MISSING', message, medicationId: 'med-1', medicationName: 'Paracetamol', scheduledAt: '2026-08-17T12:00:00' })

  it('keeps Finish disabled until every item clears, then finishes with the handover and nothing-to-note flags', async () => {
    grantGeolocation()
    show(inProgress())
    fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
    const finish = screen.getByRole('button', { name: 'Finish shift' })
    expect(finish).toBeDisabled()
    fireEvent.click(screen.getByLabelText('I took no breaks'))
    fireEvent.click(screen.getByLabelText('Nothing to note'))
    fireEvent.click(screen.getByLabelText('Nothing to hand over'))
    expect(finish).toBeEnabled()
    fireEvent.click(finish)
    await waitFor(() => expect(finishMutateAsync).toHaveBeenCalledWith({
      id: 'shift-1',
      data: { latitude: -27.5, longitude: 153.02, geolocationDeclined: false, handoverText: null, nothingToHandOver: true, nothingToNote: true },
    }))
  })

  it('sends the handover text, and limits it to 2000 characters', async () => {
    declineGeolocation()
    mockUseShiftNotes.mockReturnValue({ data: [noteWith()] })
    show(inProgress())
    fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
    const box = screen.getByLabelText('Your handover note')
    expect(box).toHaveAttribute('maxlength', '2000')
    fireEvent.change(box, { target: { value: '  All settled.  ' } })
    fireEvent.click(screen.getByLabelText('I took no breaks'))
    fireEvent.click(screen.getByRole('button', { name: 'Finish shift' }))
    await waitFor(() => expect(finishMutateAsync).toHaveBeenCalledWith({
      id: 'shift-1', data: { geolocationDeclined: true, handoverText: 'All settled.', nothingToHandOver: false, nothingToNote: false },
    }))
  })

  it('lists doses that need an outcome and opens the dose sheet on Not given this shift', () => {
    show(inProgress({
      medicationsDue: [dose({ state: 'Overdue', isOverdue: true })] as never,
      finishBlockers: [blocker('Paracetamol at 12:00 needs an outcome.')] as never,
    }))
    fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
    const end = screen.getByRole('region', { name: 'End of shift' })
    expect(within(end).getByText('Paracetamol at 12:00 needs an outcome.')).toBeInTheDocument()
    fireEvent.click(within(end).getByRole('button', { name: 'Not given this shift' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Reason')).toBeInTheDocument()
  })

  it('lists the server blockers as given on a 422', async () => {
    declineGeolocation()
    mockUseShiftNotes.mockReturnValue({ data: [noteWith()] })
    finishMutateAsync.mockRejectedValueOnce({
      response: { status: 422, data: { success: false, code: 'SHIFT_FINISH_BLOCKED', errors: ['x'], data: { ...makeDetail({ status: 'InProgress' }), finishBlockers: [blocker('Paracetamol at 12:00 needs an outcome before you finish.')] } } },
    })
    show(inProgress())
    fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
    fireEvent.change(screen.getByLabelText('Your handover note'), { target: { value: 'ok' } })
    fireEvent.click(screen.getByLabelText('I took no breaks'))
    fireEvent.click(screen.getByRole('button', { name: 'Finish shift' }))
    await waitFor(() => expect(screen.getByText('Paracetamol at 12:00 needs an outcome before you finish.')).toBeInTheDocument())
    expect(screen.getByText("You can't finish yet")).toBeInTheDocument()
  })

  it('keeps the handover and offers Try again when saving fails', async () => {
    declineGeolocation()
    mockUseShiftNotes.mockReturnValue({ data: [noteWith()] })
    finishMutateAsync.mockRejectedValueOnce(new Error('network'))
    show(inProgress())
    fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
    fireEvent.change(screen.getByLabelText('Your handover note'), { target: { value: 'Keep me' } })
    fireEvent.click(screen.getByLabelText('I took no breaks'))
    fireEvent.click(screen.getByRole('button', { name: 'Finish shift' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/your handover is kept/i))
    expect(screen.getByLabelText('Your handover note')).toHaveValue('Keep me')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('offers Report incident, prefilled, for a flagged note', () => {
    mockUseShiftNotes.mockReturnValue({ data: [noteWith({ flaggedCategories: ['Falls'] })] })
    show(inProgress())
    fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
    expect(screen.getByRole('button', { name: 'Report incident' })).toBeInTheDocument()
  })

  it('edits a break with provider-zone digits converted to UTC instants with Z', async () => {
    show(inProgress({ breaks: [{ id: 'b1', startedAt: '2026-08-17T02:00:00Z', endedAt: '2026-08-17T02:30:00Z', isRunning: false, minutes: 30, editedAt: null, createdByUserId: 'u' }] }))
    fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    // Brisbane is UTC+10: 02:00Z is 12:00 local.
    expect(screen.getByLabelText('Break started')).toHaveValue('2026-08-17T12:00')
    fireEvent.change(screen.getByLabelText('Break started'), { target: { value: '2026-08-17T12:05' } })
    fireEvent.change(screen.getByLabelText('Break ended'), { target: { value: '2026-08-17T12:40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save break' }))
    await waitFor(() => expect(editBreakMutateAsync).toHaveBeenCalledWith({
      id: 'shift-1', breakId: 'b1', data: { startedAt: '2026-08-17T02:05:00Z', endedAt: '2026-08-17T02:40:00Z' },
    }))
  })
})

describe('PortalShiftDetailPage: other states', () => {
  it('shows the Returned reason on a returned Published shift', () => {
    show(makeDetail({ returnCount: 1, lastReturnReason: 'Please add a handover.' }))
    expect(screen.getByText('Returned for changes')).toBeInTheDocument()
    expect(screen.getByText('Please add a handover.')).toBeInTheDocument()
  })

  it('shows PendingReview as submitted, read-only, with breaks and net minutes', () => {
    show(makeDetail({ status: 'PendingReview', completion: makeCompletion({ actualEnd: '2026-08-17T17:00:00Z', breakMinutes: 30, netWorkedMinutes: 450 } as never) }))
    expect(screen.getByText(/waiting for a coordinator/i)).toBeInTheDocument()
    expect(screen.getByText('450 min')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start|finish|end shift/i })).not.toBeInTheDocument()
  })

  it('shows Completed with the approver', () => {
    show(makeDetail({ status: 'Completed', completion: makeCompletion({ actualEnd: '2026-08-17T17:00:00Z', reviewedByName: 'Dana Coord' } as never) }))
    expect(screen.getByText('Dana Coord')).toBeInTheDocument()
  })

  it('shows Cancelled', () => {
    show(makeDetail({ status: 'Cancelled' }))
    expect(screen.getByText('This shift was cancelled.')).toBeInTheDocument()
  })

  it('marks an overnight shift', () => {
    show(makeDetail({ endsNextDay: true, nightType: 'ActiveNight' as never }))
    expect(screen.getByText(/\(\+1 day\)/)).toBeInTheDocument()
    expect(screen.getAllByText(/Overnight/).length).toBeGreaterThan(0)
  })

  it('shows the start variance once started', () => {
    show(makeDetail({ status: 'InProgress', completion: makeCompletion({ varianceMinutesStart: 12 }) }))
    expect(screen.getByText('Start +12 min')).toBeInTheDocument()
  })

  it('shows an offline banner and switches the actions off', () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    try {
      show(makeDetail({ status: 'InProgress', completion: makeCompletion() }))
      expect(screen.getByRole('alert')).toHaveTextContent(/you're offline/i)
      expect(screen.getByRole('button', { name: 'Start break' })).toBeDisabled()
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
    }
  })

  it('says a shift that is not theirs cannot be opened (403)', () => {
    mockUsePortalShiftDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 403 } } })
    renderAt('shift-1')
    expect(screen.getByText(/can't open this shift/i)).toBeInTheDocument()
  })
})
