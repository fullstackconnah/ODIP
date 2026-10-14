import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
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

/** Stands in for the incident form: shows the router state it was opened with. */
function IncidentFormProbe() {
  return <pre data-testid="incident-form">{JSON.stringify(useLocation().state)}</pre>
}

function renderAt(id: string, search = '') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/portal/shifts/${id}${search}`]}>
        <Routes>
          <Route path="/portal/shifts/:id" element={<PortalShiftDetailPage />} />
          <Route path="/incidents/new" element={<IncidentFormProbe />} />
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
  sessionStorage.clear()
})

afterEach(() => {
  localStorage.removeItem('odip_user')
  vi.unstubAllGlobals()
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

function show(detail: PortalShiftDetailDto, search = '') {
  mockUsePortalShiftDetail.mockReturnValue({ data: detail, isLoading: false, isError: false })
  return renderAt('shift-1', search)
}

/** A desktop viewport: useIsBelowLg reads this query (jsdom has no matchMedia, which reads as a phone). */
function desktop() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 64rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}

/** A glance cell: the label's line, then the cell that holds it (FactBar glance markup). */
const glanceCell = (label: string) => screen.getByText(label).parentElement!.parentElement!

describe('PortalShiftDetailPage', () => {
  it('renders the header: participant, window, state and flags', () => {
    show(makeDetail())
    expect(screen.getByRole('heading', { level: 1, name: 'Mia Chen' })).toBeInTheDocument()
    expect(screen.getByText('Rostered')).toBeInTheDocument()
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
    show(makeDetail(), '?tab=about')
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
    const region = document.getElementById('before-contacts')!
    const names = within(region).getAllByRole('listitem', { hidden: true }).map(li => li.textContent ?? '')
    expect(names[0]).toContain('First Person')
    expect(within(region).getByRole('link', { name: /call mobile 0400 000 111/i, hidden: true })).toHaveAttribute('href', 'tel:0400000111')
    expect(within(region).getByRole('link', { name: /call mobile 0411 000 222/i, hidden: true })).toHaveAttribute('href', 'tel:0411000222')
  })

  it('shows the withheld reason instead of the handover, contacts and address', () => {
    const base = emptyShiftPackage()
    const withheld = makeDetail({
      handover: null, emergencyContacts: null, atAGlance: { ...base.atAGlance, address: null },
      sensitiveInfoWithheldReason: 'Handover and contacts show from 9:00 am on Sat 15 Aug.',
    })
    const { unmount } = show(withheld)
    expect(screen.getAllByText('Handover and contacts show from 9:00 am on Sat 15 Aug.').length).toBe(2)
    unmount()
    show(withheld, '?tab=about')
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
    expect(within(during).getByText('As needed · 1 medicine')).toBeInTheDocument()
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
    expect(screen.getByText(/^On a break since \d/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End break' })).toBeInTheDocument()
  })

  it('sits above the mobile bottom nav (same offset as the wizard footer)', () => {
    show(inProgress())
    expect(screen.getByRole('toolbar', { name: 'Shift actions' })).toHaveClass('bottom-[var(--mobile-nav-h)]', 'lg:bottom-0')
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

describe('PortalShiftDetailPage: what sits where on a phone', () => {
  const mid = (over: Partial<PortalShiftDetailDto> = {}) => makeDetail({ status: 'InProgress', completion: makeCompletion(), ...over })
  const read = { completionId: 'c', text: 'x', nothingToHandOver: false, authorUserId: 'a', authorName: 'Sam', shiftDate: '2026-08-16', submittedAt: '2026-08-16T23:00:00Z', requiresAcknowledgement: true, isRead: true, readAt: '2026-08-17T08:00:00Z' }

  it('moves a read handover to Notes, folds contacts on Now, and keeps anaphylaxis and HIDPA on the must-know line', () => {
    const base = emptyShiftPackage()
    show(mid({ handover: read, atAGlance: { ...base.atAGlance, allergies: { detail: 'Nuts', isAnaphylaxisRisk: true, managementNotes: null }, hidpa: { epilepsy: true, enteralFeeding: false, dysphagia: false } } }))
    const now = document.getElementById('shift-panel-now')!
    expect(within(now).getByText('HIDPA: Epilepsy')).toBeInTheDocument()
    expect(within(now).getAllByText('Anaphylaxis risk').length).toBeGreaterThan(0)
    expect(document.getElementById('before-contacts')?.tagName).toBe('DETAILS')
    expect(within(document.getElementById('shift-panel-notes')!).getByText('From the last shift')).toBeInTheDocument()
  })

  it('keeps an unread handover open on Now so it cannot be skipped', () => {
    show(mid({ handover: { ...read, isRead: false, readAt: null } }))
    expect(within(document.getElementById('shift-panel-now')!).getByRole('region', { name: 'Handover' })).toBeInTheDocument()
  })

  it('before the start, reads the handover on Now and folds the contacts to a count', () => {
    show(makeDetail({ emergencyContacts: [{ id: 'c1', name: 'First Person', relationship: 'Mother', phone: null, mobile: '0400 000 111', isPrimary: true, priorityOrder: 1, roleType: 'EmergencyContact', roleLabel: 'Emergency contact' }] }))
    expect(within(document.getElementById('shift-panel-now')!).getByText(/no handover from a previous shift/i)).toBeInTheDocument()
    expect(screen.getByText('1 to call')).toBeInTheDocument()
  })
})

describe('PortalShiftDetailPage: the five-step finish (SHAPE §4)', () => {
  const key = 'odip-shift-end-draft:shift-1'
  const inProgress = (over: Partial<PortalShiftDetailDto> = {}) => makeDetail({ status: 'InProgress', completion: makeCompletion(), ...over })
  const blocker = (message: string) => ({ code: 'DOSE_OUTCOME_MISSING', message, medicationId: 'med-1', medicationName: 'Paracetamol', scheduledAt: '2026-08-17T12:00:00' })
  const bar = () => within(screen.getByRole('toolbar', { name: 'Shift actions' }))
  const forward = (name: string | RegExp) => fireEvent.click(bar().getByRole('button', { name }))
  const heading = (name: string) => screen.getByRole('heading', { level: 2, name })
  const endShift = () => fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
  /** End shift, then each step's one tap, to step 5. */
  function toSubmit() {
    endShift()
    forward('Confirm times')
    forward('Next')
    forward('Skip')
    forward(/^(Nothing to note or hand over|Nothing to hand over|Nothing to note|Next)$/)
  }

  it('End shift opens step 1 of 5 with its heading focused, and hides the tabs and the glance strip', () => {
    show(inProgress())
    endShift()
    expect(screen.getByRole('navigation', { name: 'Finish shift steps' })).toHaveTextContent('Step 1 of 5')
    expect(heading('Your times')).toHaveFocus()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByText('Due now')).not.toBeInTheDocument()
  })

  it('with nothing to do every step is one tap, and Submit sends every key', async () => {
    grantGeolocation()
    show(inProgress())
    toSubmit()
    expect(heading('Check and submit')).toBeInTheDocument()
    forward('Submit shift')
    await waitFor(() => expect(finishMutateAsync).toHaveBeenCalledWith({
      id: 'shift-1',
      data: {
        latitude: -27.5, longitude: 153.02, geolocationDeclined: false,
        actualStart: null, actualEnd: null, timeAdjustmentReason: null, kilometres: null, anythingToReport: null,
        handoverText: null, nothingToHandOver: true, nothingToNote: true,
      },
    }))
  })

  it('sends a written handover trimmed, limited to 2000 characters, and the No answer', async () => {
    declineGeolocation()
    mockUseShiftNotes.mockReturnValue({ data: [noteWith()] })
    show(inProgress())
    endShift()
    forward('Confirm times')
    forward('Next')
    fireEvent.click(screen.getByRole('button', { name: 'No, nothing to report' }))
    const box = screen.getByLabelText('Your handover note')
    expect(box).toHaveAttribute('maxlength', '2000')
    fireEvent.change(box, { target: { value: '  All settled.  ' } })
    forward('Next')
    forward('Submit shift')
    await waitFor(() => expect(finishMutateAsync).toHaveBeenCalledWith({
      id: 'shift-1',
      data: {
        geolocationDeclined: true, actualStart: null, actualEnd: null, timeAdjustmentReason: null, kilometres: null, anythingToReport: false,
        handoverText: 'All settled.', nothingToHandOver: false, nothingToNote: false,
      },
    }))
  })


  it('step 1 stops only on a running break, names it, and focuses its End break', async () => {
    show(inProgress({ breaks: [{ id: 'b1', startedAt: '2026-08-17T02:00:00Z', endedAt: null, isRunning: true, minutes: 12, editedAt: null, createdByUserId: 'u' }] }))
    endShift()
    forward('Confirm times')
    expect(screen.getByRole('alert')).toHaveTextContent('End your break first.')
    await waitFor(() => expect(document.getElementById('brk-end-now-b1')).toHaveFocus())
    expect(heading('Your times')).toBeInTheDocument()
    expect(bar().getByRole('button', { name: 'Confirm times' })).toBeEnabled()
  })

  it('edits a break on step 1 with provider-zone digits sent as UTC instants with Z', async () => {
    show(inProgress({ breaks: [{ id: 'b1', startedAt: '2026-08-17T02:00:00Z', endedAt: '2026-08-17T02:30:00Z', isRunning: false, minutes: 30, editedAt: null, createdByUserId: 'u' }] }))
    endShift()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Break started')).toHaveValue('2026-08-17T12:00')   // Brisbane, UTC+10
    fireEvent.change(screen.getByLabelText('Break started'), { target: { value: '2026-08-17T12:05' } })
    fireEvent.change(screen.getByLabelText('Break ended'), { target: { value: '2026-08-17T12:40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save break' }))
    await waitFor(() => expect(editBreakMutateAsync).toHaveBeenCalledWith({
      id: 'shift-1', breakId: 'b1', data: { startedAt: '2026-08-17T02:05:00Z', endedAt: '2026-08-17T02:40:00Z' },
    }))
  })

  it('step 2 lists doses that need an outcome; Next names the count and focuses the first Record it; Not given opens the dose sheet', async () => {
    show(inProgress({ medicationsDue: [dose({ state: 'Overdue', isOverdue: true })] as never, finishBlockers: [blocker('Paracetamol at 12:00 needs an outcome.')] as never }))
    endShift()
    forward('Confirm times')
    expect(screen.getByRole('heading', { level: 3, name: 'Needs an outcome' })).toBeInTheDocument()
    expect(screen.getByText('Paracetamol at 12:00 needs an outcome.')).toBeInTheDocument()
    forward('Next')
    expect(screen.getByRole('alert')).toHaveTextContent('Record an outcome for 1 dose before you go on.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record it' })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Not given this shift' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Reason')).toBeInTheDocument()
  })

  it("step 2 shows unticked routines without blocking (owner decision 7), ticks them in place, and folds the as-needed medicines", async () => {
    const routine = (id: string, title: string, isCritical: boolean) => ({ id, title, description: '', category: 'PersonalCare', isCritical, startTime: null, endTime: null, occursAt: null, afterMidnight: false, isChecked: false, checkedAt: null, checkedByName: null, fromTickSnapshot: false })
    const prn = { medicationId: 'p', medicationName: 'Ibuprofen', strength: null, doseDescription: '1 tablet', form: 'Tablet', route: 'Oral', directions: null, supportLevel: 'Administer', isHighRisk: false, indication: 'Pain', maxDosesPer24h: 3, minIntervalMinutes: 240, dosesInLast24h: 0, lastDoseAt: null, maxDosesReached: false, nextAvailableAt: null, outcomePendingAdministrationId: null }
    show(inProgress({ shiftRoutines: [routine('r1', 'Pressure care', true), routine('r2', 'Water the plants', false)] as never, prn: [prn] as never }))
    endShift()
    forward('Confirm times')
    expect(screen.getByRole('heading', { level: 3, name: 'Routines not ticked' })).toBeInTheDocument()
    expect(screen.getByText("These don't stop you finishing. Tick any you did.")).toBeInTheDocument()
    expect(screen.getByText('As needed · 1 medicine')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Pressure care/ }))
    await waitFor(() => expect(checkRoutineMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', routineId: 'r1' }))
    forward('Next')
    expect(heading('Anything to report?')).toBeInTheDocument()
  })


  it('step 3: Yes saves the draft at step 3 and opens the incident form with the shift and a way back (Review Focus 4)', () => {
    show(inProgress())
    endShift()
    forward('Confirm times')
    forward('Next')
    expect(bar().getByRole('button', { name: 'Skip' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, report it' }))
    expect(JSON.parse(screen.getByTestId('incident-form').textContent!)).toMatchObject({
      source: 'shift', shiftId: 'shift-1', participantId: 'participant-1', participantName: 'Mia Chen', returnTo: '/portal/shifts/shift-1',
    })
    expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({ step: 'report', reached: 'report', anythingToReport: 'yes' })
  })

  it('coming back from the incident form reopens step 3 with the answer, and Next is one tap', () => {
    sessionStorage.setItem(key, JSON.stringify({ step: 'report', reached: 'report', anythingToReport: 'yes', timesSig: '' }))
    show(inProgress())
    expect(heading('Anything to report?')).toHaveFocus()
    expect(screen.getByText(/You said yes and opened the incident form\./)).toBeInTheDocument()
    forward('Next')
    expect(heading('Note & handover')).toBeInTheDocument()
  })

  it('Report incident for a flagged note leaves from step 3 and comes back to it', () => {
    mockUseShiftNotes.mockReturnValue({ data: [noteWith({ flaggedCategories: ['Falls'] })] })
    show(inProgress())
    endShift()
    forward('Confirm times')
    forward('Next')
    fireEvent.click(screen.getByRole('button', { name: 'Report incident' }))
    expect(JSON.parse(screen.getByTestId('incident-form').textContent!)).toMatchObject({ source: 'shift-note', returnTo: '/portal/shifts/shift-1' })
    expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({ step: 'report', anythingToReport: 'yes' })
  })

  it('step 4 names the missing answers on its forward button', () => {
    show(inProgress())
    endShift()
    forward('Confirm times')
    forward('Next')
    forward('Skip')
    expect(bar().getByRole('button', { name: 'Nothing to note or hand over' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Nothing to hand over'))
    expect(screen.getByLabelText('Your handover note')).toBeDisabled()
    expect(bar().getByRole('button', { name: 'Nothing to note' })).toBeInTheDocument()
  })

  it('Back goes one step back; Back to shift leaves the flow, keeps every entry, and returns focus to End shift', async () => {
    show(inProgress())
    endShift()
    forward('Confirm times')
    forward('Next')
    fireEvent.click(bar().getByRole('button', { name: 'Back' }))
    expect(heading('Doses & routines')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Back to shift' }))
    expect(screen.getByRole('tablist', { name: 'Shift' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'End shift' })).toHaveFocus())
    expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({ step: null, reached: 'report' })
  })

  it('resumes at the saved step with its entries, or at step 1 with a line when the breaks changed (Review Focus 4)', () => {
    sessionStorage.setItem(key, JSON.stringify({ step: 'handover', reached: 'handover', handoverText: 'Half written', timesSig: '' }))
    const { unmount } = show(inProgress())
    expect(heading('Note & handover')).toHaveFocus()
    expect(screen.getByLabelText('Your handover note')).toHaveValue('Half written')
    unmount()

    sessionStorage.setItem(key, JSON.stringify({ step: 'handover', reached: 'handover', handoverText: 'Half written', timesSig: 'stale' }))
    show(inProgress())
    expect(heading('Your times')).toBeInTheDocument()
    expect(screen.getByText('Your breaks changed. Check your times again.')).toBeInTheDocument()
  })


  it('a 422 lists each blocker on step 5 with a Go to step link that lands on its step', async () => {
    declineGeolocation()
    mockUseShiftNotes.mockReturnValue({ data: [noteWith()] })
    finishMutateAsync.mockRejectedValueOnce({
      response: { status: 422, data: { success: false, code: 'SHIFT_FINISH_BLOCKED', errors: ['x'], data: { ...makeDetail({ status: 'InProgress' }), finishBlockers: [blocker('Paracetamol at 12:00 needs an outcome before you finish.')] } } },
    })
    show(inProgress())
    toSubmit()
    forward('Submit shift')
    await waitFor(() => expect(screen.getByText("You can't submit yet")).toBeInTheDocument())
    expect(screen.getByText('Paracetamol at 12:00 needs an outcome before you finish.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Go to step' }))
    expect(heading('Doses & routines')).toBeInTheDocument()
  })

  it('a network failure keeps every entry and offers Try again', async () => {
    declineGeolocation()
    mockUseShiftNotes.mockReturnValue({ data: [noteWith()] })
    finishMutateAsync.mockRejectedValueOnce(new Error('network'))
    show(inProgress())
    endShift()
    forward('Confirm times')
    forward('Next')
    forward('Skip')
    fireEvent.change(screen.getByLabelText('Your handover note'), { target: { value: 'Keep me' } })
    forward('Next')
    forward('Submit shift')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Couldn't submit. Check your connection. Your entries are kept: try again."))
    expect(bar().getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({ step: 'submit', handoverText: 'Keep me' })
  })

  it('the rail lets the worker tap a visited step but not a later one', () => {
    show(inProgress())
    endShift()
    forward('Confirm times')
    forward('Next')
    const pills = within(screen.getByRole('navigation', { name: 'Finish shift steps' })).getAllByRole('button')
    expect(pills.map(p => p.hasAttribute('disabled'))).toEqual([false, false, false, true, true])
    fireEvent.click(pills[0])
    expect(heading('Your times')).toBeInTheDocument()
  })

  it('step 4 counts the notes, and Add or edit notes opens the Notes tab, keeping every entry (plan check S1)', async () => {
    mockUseShiftNotes.mockReturnValue({ data: [noteWith()] })
    show(inProgress())
    endShift()
    forward('Confirm times')
    forward('Next')
    forward('Skip')
    expect(screen.getByText('1 note on this shift.')).toBeInTheDocument()
    expect(screen.getAllByTestId('shift-notes-section')).toHaveLength(1)   // only the Notes panel's, mounted behind the flow
    fireEvent.change(screen.getByLabelText('Your handover note'), { target: { value: 'Half written' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add or edit notes' }))
    expect(screen.getByRole('tab', { name: /Notes/ })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByRole('tab', { name: /Notes/ })).toHaveFocus())
    expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({ step: null, reached: 'handover', handoverText: 'Half written' })
  })

  it('shows Submitting… and takes no second tap while the location and the save are under way (plan check S5)', async () => {
    finishMutateAsync.mockReturnValueOnce(new Promise(() => {}))
    show(inProgress())
    toSubmit()
    forward('Submit shift')
    await waitFor(() => expect(bar().getByRole('button', { name: 'Submitting…' })).toBeDisabled())
    fireEvent.click(bar().getByRole('button', { name: 'Submitting…' }))
    expect(finishMutateAsync).toHaveBeenCalledTimes(1)
  })

  it('clears the draft and leaves the flow on success', async () => {
    show(inProgress())
    toSubmit()
    forward('Submit shift')
    await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull())
    expect(screen.queryByRole('navigation', { name: 'Finish shift steps' })).not.toBeInTheDocument()
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

  it('shows the start variance once submitted', () => {
    show(makeDetail({ status: 'PendingReview', completion: makeCompletion({ varianceMinutesStart: 12, actualEnd: '2026-08-17T17:00:00Z' }) }))
    expect(screen.getByText(/\+12 min start/)).toBeInTheDocument()
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

describe('PortalShiftDetailPage: header, glance and segments (SHAPE §3)', () => {
  const inProgress = (over: Partial<PortalShiftDetailDto> = {}) => makeDetail({ status: 'InProgress', completion: makeCompletion(), ...over })

  it('makes the participant the one h1, with a meta row of status, day and times', () => {
    show(makeDetail({ ratio: 'OneToTwo' as never }))
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('Rostered')).toBeInTheDocument()
    expect(screen.getByText('Mon 17 Aug')).toBeInTheDocument()
    expect(screen.getByText('9am–5pm')).toBeInTheDocument()   // the house shift-time format
  })

  it('shows two glance figures by state: Starts and Due this shift before the start', () => {
    show(makeDetail({ medicationsDue: [dose()] as never }))
    expect(within(glanceCell('Starts')).getByText(/9:00\s?am/i)).toBeInTheDocument()
    expect(within(glanceCell('Due this shift')).getByText('1')).toBeInTheDocument()
  })

  it('in progress: On shift, and Due now tinted with Overdue only when a dose is overdue, else All done at zero', () => {
    const blocker = { code: 'DOSE_OUTCOME_MISSING', message: 'x', medicationId: 'med-1', medicationName: 'Paracetamol', scheduledAt: '2026-08-17T12:00:00' }
    const { unmount } = show(inProgress({ medicationsDue: [dose({ state: 'Overdue', isOverdue: true })] as never, finishBlockers: [blocker] as never }))
    expect(glanceCell('On shift')).toBeInTheDocument()
    expect(within(glanceCell('Due now')).getByText('Overdue')).toBeInTheDocument()
    expect(glanceCell('Due now')).toHaveAttribute('data-attention', 'warning')
    unmount()

    show(inProgress())
    expect(within(glanceCell('Due now')).getByText('All done')).toBeInTheDocument()
    expect(glanceCell('Due now')).not.toHaveAttribute('data-attention')
  })

  it('after submitting: Time worked and Breaks', () => {
    show(makeDetail({ status: 'PendingReview', completion: makeCompletion({ actualEnd: '2026-08-17T17:00:00Z', breakMinutes: 30, netWorkedMinutes: 450 } as never) }))
    expect(screen.getByText('7h 30m')).toBeInTheDocument()
    expect(screen.getByText('30 min')).toBeInTheDocument()
  })


  it('splits the page into Now, About and Notes real tabs on a phone, with every panel kept mounted', () => {
    show(inProgress())
    const tabs = within(screen.getByRole('tablist', { name: 'Shift' })).getAllByRole('tab').map(t => t.textContent)
    expect(tabs).toEqual(['Now', 'About', 'Notes'])
    expect(screen.getByRole('tabpanel', { name: 'Now' })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'At a glance' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'About' }))
    expect(screen.getByRole('region', { name: 'At a glance' })).toBeInTheDocument()
    const notes = document.getElementById('shift-panel-notes')!
    expect(notes).toHaveAttribute('hidden')
    expect(within(notes).getByTestId('shift-notes-section')).toBeInTheDocument()   // still mounted: a half-typed note survives
  })

  it('keeps the Notes panel mounted, only hidden, once End shift is tapped, so a half-typed note survives (plan check S1)', () => {
    show(inProgress())
    fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
    const notes = document.getElementById('shift-panel-notes')!
    expect(notes).toHaveAttribute('hidden')
    expect(within(notes).getByTestId('shift-notes-section')).toBeInTheDocument()
  })

  it('lands on the tab in the URL', () => {
    show(inProgress(), '?tab=notes')
    expect(screen.getByRole('tab', { name: /Notes/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('the must-know link selects About and moves focus to its tab', async () => {
    show(inProgress())
    fireEvent.click(screen.getByRole('button', { name: 'Everything about Mia' }))
    expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByRole('tab', { name: 'About' })).toHaveFocus())
  })

  it('folds a time whose doses and routines are all done, and the As needed medicines', () => {
    const given = { status: 'Administered', administeredAt: '2026-08-16T22:05:00Z', administeredAtTimeZone: null, recordedByName: 'Jack', reason: null, recordedWithoutCompetency: false }
    show(inProgress({
      medicationsDue: [dose({ scheduledAt: '2026-08-17T08:00:00', state: 'Recorded', outcome: given })] as never,
      shiftRoutines: [{ id: 'r1', title: 'Breakfast', description: '', category: 'PersonalCare', isCritical: false, startTime: null, endTime: null, occursAt: '2026-08-17T08:00:00', afterMidnight: false, isChecked: true, checkedAt: '2026-08-16T22:10:00Z', checkedByName: 'Jack', fromTickSnapshot: false }] as never,
    }))
    expect(screen.getByText('8:00 am · 2 done')).toBeInTheDocument()
  })

  it('on a desktop there are no tabs: About sits beside Now and Notes, all on screen', () => {
    desktop()
    show(inProgress())
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'At a glance' })).toBeInTheDocument()
  })
})

describe('PortalShiftDetailPage: the sticky bar by state (SHAPE §3)', () => {
  it('offers Start from an hour before the rostered start, and says when it opens before that', () => {
    const { unmount } = show(makeDetail())   // 17 Aug 2026 is past: the window is open
    expect(within(screen.getByRole('toolbar', { name: 'Shift actions' })).getByRole('button', { name: 'Start shift' })).toBeInTheDocument()
    unmount()

    show(makeDetail({ serviceDate: '2099-08-17' }))
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(screen.getByText(/^You can start from 8:00\s?am\.$/i)).toBeInTheDocument()
  })

  it('has no bar once the shift is submitted', () => {
    show(makeDetail({ status: 'PendingReview', completion: makeCompletion({ actualEnd: '2026-08-17T17:00:00Z' }) }))
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })
})

describe('PortalShiftDetailPage: your times, kilometres and drift (Review Focus 1, 2, 3, 5)', () => {
  // Brisbane, UTC+10: stamped 09:05:40, now 17:00:30.
  const stamped = () => makeCompletion({ actualStart: '2026-08-16T23:05:40Z' })
  const inProgress = (over: Partial<PortalShiftDetailDto> = {}) => makeDetail({ status: 'InProgress', completion: stamped(), ...over })
  const bar = () => within(screen.getByRole('toolbar', { name: 'Shift actions' }))
  const forward = (name: string | RegExp) => fireEvent.click(bar().getByRole('button', { name }))
  const heading = (name: string) => screen.getByRole('heading', { level: 2, name })
  const open = (over: Partial<PortalShiftDetailDto> = {}) => {
    show(inProgress(over))
    fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
  }
  const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
  const moveFinish = (value: string, reason = 'Left early.') => {
    fireEvent.click(screen.getByRole('button', { name: 'Change your finish time' }))
    change('Your finish time', value)
    change('Why did your times change?', reason)
  }
  const toStepFive = () => { forward('Confirm times'); forward('Next'); forward('Skip'); forward('Nothing to note or hand over') }

  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-08-17T07:00:30Z')) })
  afterEach(() => vi.useRealTimers())

  it('Change offers the window the server accepts, and the reason appears once a time is open', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Change your start time' }))
    const start = screen.getByLabelText('Your start time')
    expect(start).toHaveValue('2026-08-17T09:05')
    expect(start).toHaveAttribute('min', '2026-08-17T08:50')
    expect(start).toHaveAttribute('max', '2026-08-17T09:20')
    expect(screen.getByText('Between 8:50 am and 9:20 am')).toBeInTheDocument()
    expect(screen.getByLabelText('Why did your times change?')).toHaveAttribute('maxlength', '500')
    fireEvent.click(screen.getByRole('button', { name: 'Change your finish time' }))
    expect(screen.getByLabelText('Your finish time')).toHaveAttribute('max', '2026-08-17T17:00')
    expect(screen.getByText('Up to 15 minutes before you submit.')).toBeInTheDocument()
  })

  it('refuses a start outside the window, naming it and focusing the field', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Change your start time' }))
    change('Your start time', '2026-08-17T08:40')
    change('Why did your times change?', 'Early')
    forward('Confirm times')
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a time between 8:50 am and 9:20 am.')
    await waitFor(() => expect(screen.getByLabelText('Your start time')).toHaveFocus())
    expect(heading('Your times')).toBeInTheDocument()
  })

  it('asks why when a time moved, and focuses the reason', async () => {
    open()
    moveFinish('2026-08-17T16:50', '')
    forward('Confirm times')
    expect(screen.getByRole('alert')).toHaveTextContent('Say why your times changed.')
    await waitFor(() => expect(screen.getByLabelText('Why did your times change?')).toHaveFocus())
  })


  it('Use the recorded time takes a change back: no reason is needed and nothing is sent', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Change your start time' }))
    change('Your start time', '2026-08-17T08:55')
    fireEvent.click(screen.getByRole('button', { name: 'Use the recorded time for your start' }))
    expect(screen.queryByLabelText('Your start time')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Why did your times change?')).not.toBeInTheDocument()
    forward('Confirm times')
    expect(heading('Doses & routines')).toBeInTheDocument()
  })

  it('a moved start and finish, the reason and the kilometres reach the server as Z instants and numbers', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Change your start time' }))
    change('Your start time', '2026-08-17T08:55')
    moveFinish('2026-08-17T16:50', '  Arrived early, left at ten to five.  ')
    change('Kilometres driven with Mia (optional)', '12.5')
    toStepFive()
    expect(screen.getByText(/^8:55\s?am \(changed from 9:05\s?am\)$/i)).toBeInTheDocument()
    expect(screen.getByText('12.5 km')).toBeInTheDocument()
    forward('Submit shift')
    await waitFor(() => expect(finishMutateAsync).toHaveBeenCalledWith({
      id: 'shift-1',
      data: {
        geolocationDeclined: true, actualStart: '2026-08-16T22:55:00Z', actualEnd: '2026-08-17T06:50:00Z',
        timeAdjustmentReason: 'Arrived early, left at ten to five.', kilometres: 12.5, anythingToReport: null,
        handoverText: null, nothingToHandOver: true, nothingToNote: true,
      },
    }))
  })

  it("a Change left on the recorded minute sends nothing and needs no reason; '0' km sends 0", async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Change your start time' }))
    fireEvent.click(screen.getByRole('button', { name: 'Change your finish time' }))
    change('Kilometres driven with Mia (optional)', '0')
    toStepFive()
    forward('Submit shift')
    await waitFor(() => expect(finishMutateAsync).toHaveBeenCalledWith({
      id: 'shift-1',
      data: {
        geolocationDeclined: true, actualStart: null, actualEnd: null, timeAdjustmentReason: null, kilometres: 0, anythingToReport: null,
        handoverText: null, nothingToHandOver: true, nothingToNote: true,
      },
    }))
  })

  it("refuses kilometres it can't read, on step 1 with focus on the field", async () => {
    open()
    change('Kilometres driven with Mia (optional)', '12,5')
    forward('Confirm times')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter kilometres from 0 to 2,000.')
    await waitFor(() => expect(screen.getByLabelText('Kilometres driven with Mia (optional)')).toHaveFocus())
  })

  it("refuses moved times that leave a break outside, focusing that break's Edit", async () => {
    open({ breaks: [{ id: 'b1', startedAt: '2026-08-17T06:40:00Z', endedAt: '2026-08-17T06:52:00Z', isRunning: false, minutes: 12, editedAt: null, createdByUserId: 'u' }] })
    moveFinish('2026-08-17T16:50')
    forward('Confirm times')
    expect(screen.getByRole('alert')).toHaveTextContent('Your times must include your breaks. Change the break first, or your times.')
    await waitFor(() => expect(document.getElementById('brk-edit-b1')).toHaveFocus())
  })


  it('drift: an end chosen earlier that slips past 15 minutes is caught on step 5 with two choices (Review Focus 2)', async () => {
    open()
    moveFinish('2026-08-17T16:50')
    forward('Confirm times')
    forward('Next')
    forward('Skip')
    vi.setSystemTime(new Date('2026-08-17T07:06:30Z'))   // six minutes later, 16:50 is 16 minutes back
    forward('Nothing to note or hand over')
    expect(screen.getByText('Your finish time is now more than 15 minutes ago.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use the time I submit' }))
    expect(screen.queryByText('Your finish time is now more than 15 minutes ago.')).not.toBeInTheDocument()
    forward('Submit shift')
    await waitFor(() => expect(finishMutateAsync).toHaveBeenCalledWith({
      id: 'shift-1',
      data: expect.objectContaining({ actualEnd: null, timeAdjustmentReason: null }),
    }))
  })

  it('drift: Change it goes back to step 1, and Submit checks the clock again itself', () => {
    open()
    moveFinish('2026-08-17T16:50')
    toStepFive()
    expect(screen.queryByText('Your finish time is now more than 15 minutes ago.')).not.toBeInTheDocument()
    vi.setSystemTime(new Date('2026-08-17T07:06:30Z'))
    forward('Submit shift')
    expect(heading('Your times')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a time no more than 15 minutes before now.')
    expect(finishMutateAsync).not.toHaveBeenCalled()
  })

  it("a time the server refuses lands back on step 1 through Go to step", async () => {
    finishMutateAsync.mockRejectedValueOnce({
      response: { status: 400, data: { success: false, code: 'SHIFT_TIME_ADJUSTMENT_TOO_LARGE', errors: ['You can change your times by up to 15 minutes.'] } },
    })
    open()
    moveFinish('2026-08-17T16:50')
    toStepFive()
    forward('Submit shift')
    await waitFor(() => expect(screen.getByText('You can change your times by up to 15 minutes.')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Go to step' }))
    expect(heading('Your times')).toBeInTheDocument()
    expect(screen.getByLabelText('Your finish time')).toHaveValue('2026-08-17T16:50')   // the entry is kept
  })
})

describe('PortalShiftDetailPage: submitted (SHAPE §4)', () => {
  const bar = () => within(screen.getByRole('toolbar', { name: 'Shift actions' }))
  const forward = (name: string | RegExp) => fireEvent.click(bar().getByRole('button', { name }))

  it('leads Now with Shift submitted, moves focus to it, announces once, and shows no bar', async () => {
    show(makeDetail({ status: 'InProgress', completion: makeCompletion() }))
    fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
    forward('Confirm times')
    forward('Next')
    forward('Skip')
    forward('Nothing to note or hand over')
    forward('Submit shift')

    await waitFor(() => expect(screen.getByText('Shift submitted')).toHaveFocus())
    expect(screen.getByText('Shift submitted').closest('[role="status"],[role="alert"]')).toBeNull()   // the callout itself is quiet
    expect(screen.getAllByRole('status').some(s => s.textContent === 'Shift submitted. A coordinator will review it.')).toBe(true)
    expect(screen.getByText('A coordinator will review it. You can still add notes.')).toBeInTheDocument()
    // The page's BackButton has the same name; this is the callout's, on Now.
    expect(within(document.getElementById('shift-panel-now')!).getByRole('link', { name: 'Back to my shifts' })).toHaveAttribute('href', '/portal')
    expect(screen.getByRole('tab', { name: 'Now' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('ignores a finish draft left on another device once the shift is submitted: no flow, the summary shows', () => {
    sessionStorage.setItem('odip-shift-end-draft:shift-1', JSON.stringify({ step: 'submit', reached: 'submit' }))
    show(makeDetail({ status: 'PendingReview', completion: makeCompletion({ actualEnd: '2026-08-17T17:00:00Z' }) }))
    expect(screen.queryByRole('navigation', { name: 'Finish shift steps' })).not.toBeInTheDocument()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(screen.getByText(/waiting for a coordinator/i)).toBeInTheDocument()
  })

  it("the summary shows the worker's changed times with what they replaced, the reason and the kilometres", () => {
    show(makeDetail({
      status: 'PendingReview',
      completion: makeCompletion({
        actualStart: '2026-08-16T22:55:00Z', originalActualStart: '2026-08-16T23:05:40Z', actualEnd: '2026-08-17T06:50:00Z',
        originalActualEnd: '2026-08-17T07:00:30Z', timesAdjusted: true, timeAdjustmentReason: 'Left early.', kilometres: 12.5,
      }),
    }))
    expect(screen.getByText('Start changed from')).toBeInTheDocument()
    expect(screen.getByText('Finish changed from')).toBeInTheDocument()
    expect(screen.getByText('Left early.')).toBeInTheDocument()
    expect(screen.getByText('12.5 km')).toBeInTheDocument()
  })
})
