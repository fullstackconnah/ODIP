import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PortalShiftDetailPage from './PortalShiftDetailPage'
import { buttonClasses } from '@/components/buttonClasses'
import type { PortalShiftDetailDto } from '@/api/types'
import { emptyShiftPackage, emptyCompletionPackage } from '@/test/fixtures/shiftPackage'

const h = vi.hoisted(() => ({
  mockUsePortalShiftDetail: vi.fn(),
  mockUseShiftNotes: vi.fn(),
  startMutateAsync: vi.fn(),
  finishMutateAsync: vi.fn(),
  saveDetailsMutateAsync: vi.fn(),
  ackMutateAsync: vi.fn(),
  startBreakMutateAsync: vi.fn(),
  endBreakMutateAsync: vi.fn(),
  editBreakMutateAsync: vi.fn(),
  deleteBreakMutateAsync: vi.fn(),
  checkRoutineMutateAsync: vi.fn(),
  uncheckRoutineMutateAsync: vi.fn(),
  recordMutateAsync: vi.fn(),
  saveReasonMutateAsync: vi.fn(),
  mutation: (fn: unknown) => () => ({ mutateAsync: fn, isPending: false }),
}))
const {
  mockUsePortalShiftDetail, mockUseShiftNotes, startMutateAsync, finishMutateAsync, saveDetailsMutateAsync, ackMutateAsync, startBreakMutateAsync, endBreakMutateAsync,
  editBreakMutateAsync, deleteBreakMutateAsync, checkRoutineMutateAsync, uncheckRoutineMutateAsync, recordMutateAsync, saveReasonMutateAsync,
} = h

vi.mock('@/api/hooks', () => ({
  usePortalShiftDetail: h.mockUsePortalShiftDetail,
  useShiftNotes: h.mockUseShiftNotes,
  useStartShift: h.mutation(h.startMutateAsync),
  useFinishShift: h.mutation(h.finishMutateAsync),
  useSaveFinishDetails: h.mutation(h.saveDetailsMutateAsync),
  useAcknowledgeHandover: h.mutation(h.ackMutateAsync),
  useStartBreak: h.mutation(h.startBreakMutateAsync),
  useEndBreak: h.mutation(h.endBreakMutateAsync),
  useEditBreak: h.mutation(h.editBreakMutateAsync),
  useDeleteBreak: h.mutation(h.deleteBreakMutateAsync),
  useCheckRoutine: h.mutation(h.checkRoutineMutateAsync),
  useUncheckRoutine: h.mutation(h.uncheckRoutineMutateAsync),
  useRecordShiftDose: h.mutation(h.recordMutateAsync),
  useSaveLocationReason: h.mutation(h.saveReasonMutateAsync),
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
    missingDetails: [],
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
    deleteBreakMutateAsync, checkRoutineMutateAsync, uncheckRoutineMutateAsync, recordMutateAsync, saveReasonMutateAsync]) fn.mockReset().mockResolvedValue(undefined)
  saveDetailsMutateAsync.mockReset().mockResolvedValue({})   // a sent PUT answers with the shift; undefined means it was queued
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  mockUsePortalShiftDetail.mockReset()
  mockUseShiftNotes.mockReset().mockReturnValue({ data: [] })
  localStorage.removeItem('odip_user')
  sessionStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-16T23:00:30Z'))   // 09:00:30 in Brisbane: 30 seconds into the rostered start
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.removeItem('odip_user')
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'isSecureContext')
  // @ts-expect-error - test-only cleanup of a property the suites define per-test
  delete global.navigator.geolocation
})

function grantGeolocation(latitude = -27.5, longitude = 153.02) {
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (success: (pos: unknown) => void) => success({ coords: { latitude, longitude, accuracy: 12 } }) },
  })
}

function declineGeolocation() {
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (_success: unknown, error: (err: unknown) => void) => error({ code: 1 }) },
  })
}

const AT_LIBRARY = { name: 'Southside Library', address: null }
/** A shift at a saved place: the only kind of Start that asks the phone where it is. */
const placed = (over: Partial<PortalShiftDetailDto> = {}) => makeDetail({ serviceLocation: AT_LIBRARY, ...over })


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

/** Every answer the finish page asks for, as a worker would have typed them: a draft the page opens with. */
const ANSWERED = {
  open: true, touched: true, tappedAt: '2026-08-16T23:00:30Z', kilometres: '0', preTravelNone: true, postTravelNone: true,
  anythingToReport: 'no', handoverText: '', nothingToHandOver: true, nothingToNote: true,
}
const saveDraft = (over: Record<string, unknown> = {}) => sessionStorage.setItem('odip-shift-end-draft:shift-1', JSON.stringify({ ...ANSWERED, ...over }))

/** A glance cell: the label's line, then the cell that holds it (FactBar glance markup). */
const glanceCell = (label: string) => screen.getByText(label).parentElement!.parentElement!

describe('PortalShiftDetailPage', () => {
  it('renders the header: participant, window, state and flags', () => {
    show(makeDetail())
    expect(screen.getByRole('heading', { level: 1, name: 'Mia Chen' })).toBeInTheDocument()
    expect(screen.getByText('Rostered')).toBeInTheDocument()
    expect(screen.getByText(/high support/i)).toBeInTheDocument()
  })

  it('shows the office notes read-only under "From the office"', () => {
    show(makeDetail({ notes: 'Bring the red bag.' }))
    expect(screen.getByText('From the office')).toBeInTheDocument()
    expect(screen.getByText('Bring the red bag.')).toBeInTheDocument()
    expect(screen.queryByText('From the roster')).not.toBeInTheDocument()
  })

  it('hides the "From the office" block when the shift has no notes', () => {
    show(makeDetail({ notes: null }))
    expect(screen.queryByText('From the office')).not.toBeInTheDocument()
  })

  it('shows the service location name and address above the office notes', () => {
    show(makeDetail({ notes: 'Bring the red bag.', serviceLocation: { name: 'Southside day centre', address: '12 Park Rd, Southside' } }))
    expect(screen.getByText('Southside day centre')).toBeInTheDocument()
    expect(screen.getByText('12 Park Rd, Southside')).toBeInTheDocument()
    const where = screen.getByText('Southside day centre').closest('section')!
    const office = screen.getByText('From the office').closest('section')!
    expect(where.compareDocumentPosition(office) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows no place block when the shift has no service location', () => {
    show(makeDetail({ serviceLocation: null }))
    expect(screen.queryByText('Where')).not.toBeInTheDocument()
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

  it('starts a shift at a place with the phone fix and its accuracy', async () => {
    grantGeolocation(-27.5, 153.02)
    show(placed())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', data: { latitude: -27.5, longitude: 153.02, accuracyMetres: 12, geolocationDeclined: false } }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('never asks the phone where it is when the shift has no service location', async () => {
    const ask = vi.fn()
    Object.defineProperty(global.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: ask } })
    show(makeDetail())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', data: { geolocationDeclined: false } }))
    expect(ask).not.toHaveBeenCalled()
  })

  it('opens the no-fix sheet before Start when permission is denied, and does not start yet', async () => {
    declineGeolocation()
    show(placed())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    const sheet = await screen.findByRole('dialog', { name: "We couldn't check your location" })
    expect(within(sheet).getByText('Location is turned off for Bunya Support on this phone.')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(startMutateAsync).not.toHaveBeenCalled()
  })

  it('starts from the no-fix sheet as declined, carrying the typed reason', async () => {
    declineGeolocation()
    show(placed())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    const sheet = await screen.findByRole('dialog', { name: "We couldn't check your location" })
    fireEvent.change(within(sheet).getByLabelText('Tell your coordinator why (optional)'), { target: { value: '  Phone location is off  ' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start shift' }))
    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', data: { geolocationDeclined: true, locationReason: 'Phone location is off' } }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('starts from the no-fix sheet with no reason when none is typed', async () => {
    declineGeolocation()
    show(placed())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start shift' }))
    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', data: { geolocationDeclined: true, locationReason: null } }))
  })

  it('Try again asks the phone once more and starts with the fix when it answers', async () => {
    declineGeolocation()
    show(placed())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    const sheet = await screen.findByRole('dialog')
    grantGeolocation(-27.5, 153.02)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', data: { latitude: -27.5, longitude: 153.02, accuracyMetres: 12, geolocationDeclined: false } }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('the insecure sheet says why and offers no Try again', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    show(placed())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    const sheet = await screen.findByRole('dialog', { name: "We couldn't check your location" })
    expect(within(sheet).getByText("This web address can't use your location. Open Bunya Support from your usual secure link next time.")).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Start shift' })).toBeEnabled()
  })

  it('Escape closes the no-fix sheet and the shift stays not started', async () => {
    declineGeolocation()
    show(placed())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(startMutateAsync).not.toHaveBeenCalled()
  })

  it('opens the off-site sheet after Start when the server says not at the location, and Send saves the note', async () => {
    grantGeolocation()
    startMutateAsync.mockResolvedValue({ serviceLocation: AT_LIBRARY, completion: { locationCheck: 'NotAtLocation', locationDistanceMetres: 850 } })
    show(placed())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    const sheet = await screen.findByRole('dialog', { name: "You're about 850 m from Southside Library" })
    expect(within(sheet).getByText("Your shift has started. Let your coordinator know why you're starting here.")).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Send' })).toBeDisabled()
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: ' Parked round the corner ' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(saveReasonMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', reason: 'Parked round the corner' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('Skip closes the off-site sheet without saving a note, and a far distance reads in kilometres', async () => {
    grantGeolocation()
    startMutateAsync.mockResolvedValue({ serviceLocation: AT_LIBRARY, completion: { locationCheck: 'NotAtLocation', locationDistanceMetres: 1200 } })
    show(placed())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    const sheet = await screen.findByRole('dialog', { name: "You're about 1.2 km from Southside Library" })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(saveReasonMutateAsync).not.toHaveBeenCalled()
  })

  it('a failed Send keeps the off-site sheet open and says so', async () => {
    grantGeolocation()
    startMutateAsync.mockResolvedValue({ serviceLocation: AT_LIBRARY, completion: { locationCheck: 'NotAtLocation', locationDistanceMetres: 850 } })
    saveReasonMutateAsync.mockRejectedValue(new Error('offline'))
    show(placed())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    const sheet = await screen.findByRole('dialog')
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'Parked away' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send' }))
    expect(await within(sheet).findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it.each(['AtLocation', 'Unavailable', 'NoLocationSet'])('opens no sheet after Start when the check says %s', async check => {
    grantGeolocation()
    startMutateAsync.mockResolvedValue({ serviceLocation: AT_LIBRARY, completion: { locationCheck: check, locationDistanceMetres: 40 } })
    show(placed())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    await waitFor(() => expect(startMutateAsync).toHaveBeenCalled())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens no sheet when the Start was queued offline (nothing came back)', async () => {
    grantGeolocation()
    show(placed())
    fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
    await waitFor(() => expect(startMutateAsync).toHaveBeenCalled())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('fires Start once when tapped twice while the location is still being asked for', async () => {
    const answers: Array<(pos: unknown) => void> = []
    Object.defineProperty(global.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (success: (pos: unknown) => void) => { answers.push(success) } } })
    show(placed())
    const start = screen.getByRole('button', { name: /start shift/i })
    fireEvent.click(start)
    fireEvent.click(start)
    expect(screen.getByRole('button', { name: /starting/i })).toBeDisabled()
    // Answer every prompt that was raised: without the guard there would be two, and two Start calls.
    answers.forEach(answer => answer({ coords: { latitude: -27.5, longitude: 153.02 } }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(startMutateAsync).toHaveBeenCalledTimes(1)
  })

  it('opens the no-fix sheet (timeout) after 10 s when the browser never answers the location prompt', async () => {
    vi.useRealTimers()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-16T23:00:30Z'))
    try {
      Object.defineProperty(global.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: () => {} } })
      show(placed())
      fireEvent.click(screen.getByRole('button', { name: /start shift/i }))
      expect(screen.getByRole('button', { name: /starting/i })).toBeDisabled()
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
      expect(screen.getByText('Your phone took too long to find you.')).toBeInTheDocument()
      expect(startMutateAsync).not.toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: /starting/i })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
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
    // The tel: anchors wear Button's secondary look, not a hand-made one.
    const secondary = buttonClasses('secondary', 'md').split(' ').filter(Boolean)
    for (const link of within(region).getAllByRole('link', { name: /^call /i, hidden: true })) expect(link).toHaveClass(...secondary, 'min-h-[44px]')
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

  it('counts two as-needed medicines in the plural', () => {
    const prn = (id: string) => ({ medicationId: id, medicationName: 'Ibuprofen', strength: null, doseDescription: '1 tablet', form: 'Tablet', route: 'Oral', directions: null, supportLevel: 'Administer', isHighRisk: false, indication: 'Pain', maxDosesPer24h: 3, minIntervalMinutes: 240, dosesInLast24h: 0, lastDoseAt: null, maxDosesReached: false, nextAvailableAt: null, outcomePendingAdministrationId: null })
    show(inProgress({ prn: [prn('p1'), prn('p2')] as never }))
    expect(within(screen.getByRole('region', { name: 'During the shift' })).getByText('As needed · 2 medicines')).toBeInTheDocument()
  })

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

  it('shows no leading separator when a dose has no description', () => {
    show(inProgress({ medicationsDue: [dose({ doseDescription: '', scheduledAt: '2026-08-17T20:00:00' })] as never }))
    const give = within(screen.getByRole('region', { name: 'During the shift' })).getByText(/Give by/)
    expect(give.parentElement?.textContent?.trim()).toMatch(/^Give by/)
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

  it('the routine tick box fades its fill and its check over 100ms, with no scale', () => {
    show(inProgress({ shiftRoutines: [{ id: 'r1', title: 'Morning routine', description: '', category: 'PersonalCare', isCritical: false, startTime: null, endTime: null, occursAt: '2026-08-17T09:00:00', afterMidnight: false, isChecked: true, checkedAt: '2026-08-17T09:05:00Z', checkedByName: 'Jack', fromTickSnapshot: false }] as never }))
    const box = screen.getByRole('checkbox', { name: /morning routine/i }).firstElementChild!
    expect(box).toHaveClass('transition-colors', 'duration-100', 'ease-out')
    expect(box.className).not.toMatch(/scale/)
    expect(box.querySelector('svg')).toHaveClass('tick-in')
  })

  it('shows the competency reason once and no Record buttons when the worker cannot record', () => {
    show(inProgress({ canRecordDoses: false, canRecordDosesReason: 'Medication Competency expired', medicationsDue: [dose()] as never }))
    expect(screen.getByText('Medication Competency expired')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^record paracetamol/i })).not.toBeInTheDocument()
  })

  it('shows the elapsed time and the break state in the header', () => {
    show(inProgress({ breaks: [{ id: 'b1', startedAt: '2026-08-17T10:00:00Z', endedAt: null, isRunning: true, minutes: 12, editedAt: null, createdByUserId: 'u', withParticipant: false }] }))
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
    show(inProgress({ breaks: [{ id: 'b1', startedAt: '2026-08-17T10:00:00Z', endedAt: null, isRunning: true, minutes: 12, editedAt: null, createdByUserId: 'u', withParticipant: false }] }))
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

  it('offline: says so politely, keeps the worker actions on, and names when the details were saved', () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    try {
      show(makeDetail({ status: 'InProgress', completion: makeCompletion() }))
      expect(screen.getByText("You're offline")).toBeInTheDocument()
      expect(screen.getByText(/What you record is saved on this phone and sent when you're back online. Doses need a connection/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start break' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'End shift' })).toBeEnabled()
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
    expect(screen.getByText('30 min unpaid')).toBeInTheDocument()   // only breaks on my own come off
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

describe('PortalShiftDetailPage: submitted (SHAPE §4)', () => {

  it('leads Now with Shift submitted, moves focus to it, announces once, and shows no bar', async () => {
    saveDraft()
    show(makeDetail({ status: 'InProgress', completion: makeCompletion() }))
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Shift actions' })).getByRole('button', { name: 'Submit shift' }))

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
    sessionStorage.setItem('odip-shift-end-draft:shift-1', JSON.stringify({ open: true, touched: true }))
    show(makeDetail({ status: 'PendingReview', completion: makeCompletion({ actualEnd: '2026-08-17T17:00:00Z' }) }))
    expect(screen.queryByRole('heading', { name: /^Ended / })).not.toBeInTheDocument()
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

describe('PortalShiftDetailPage: offline (SHAPE 3, 5)', () => {
  const inProgress = (over: Partial<PortalShiftDetailDto> = {}) => makeDetail({ status: 'InProgress', completion: makeCompletion(), ...over })
  const missing = (name: string, id: string, at: string) => ({ code: 'DOSE_OUTCOME_MISSING', message: 'x', medicationId: id, medicationName: name, scheduledAt: at })
  const bar = () => within(screen.getByRole('toolbar', { name: 'Shift actions' }))
  const goOffline = () => Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
  afterEach(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
    localStorage.removeItem('odip_offline:u1:queue')
    localStorage.removeItem('odip_offline:u1:already:shift-1')
  })

  /** The dose gate: offline a dose still without an outcome stops both buttons, names the dose, and keeps what was typed. */
  function endShiftThenSubmit() {
    fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
    fireEvent.click(bar().getByRole('button', { name: 'Submit shift' }))
  }

  it('End shift with one dose due and no signal is held back, names the dose and sends nothing', () => {
    goOffline()
    show(inProgress({ medicationsDue: [dose()] as never, finishBlockers: [missing('Paracetamol', 'med-1', '2026-08-17T12:00:00')] as never }))
    endShiftThenSubmit()
    expect(within(screen.getByRole('toolbar', { name: 'Shift actions' })).getByRole('alert')).toHaveTextContent(/Paracetamol 500mg was due at 12:00 pm with no outcome recorded, and recording a dose needs a connection. When you're back online, record it, then end the shift./)
    expect(finishMutateAsync).not.toHaveBeenCalled()
    expect(saveDetailsMutateAsync).not.toHaveBeenCalled()
  })

  it('End shift with two doses due lists both, joined with "and"', () => {
    goOffline()
    const second = dose({ medicationId: 'med-2', medicationName: 'Movicol', strength: null, scheduledAt: '2026-08-17T13:00:00', scheduledTime: '13:00' })
    show(inProgress({
      medicationsDue: [dose(), second] as never,
      finishBlockers: [missing('Paracetamol', 'med-1', '2026-08-17T12:00:00'), missing('Movicol', 'med-2', '2026-08-17T13:00:00')] as never,
    }))
    endShiftThenSubmit()
    expect(within(screen.getByRole('toolbar', { name: 'Shift actions' })).getByRole('alert')).toHaveTextContent(
      /2 doses are due with no outcome recorded: Paracetamol 500mg \(12:00 pm\) and Movicol \(1:00 pm\). Recording a dose needs a connection. When you're back online, record them, then end the shift./,
    )
  })

  it('offline with nothing due, End shift goes straight out (it queues) and no dose notice shows', () => {
    goOffline()
    show(inProgress())
    fireEvent.click(screen.getByRole('button', { name: 'End shift' }))
    expect(finishMutateAsync).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Record d+ doses? before the shift ends/)).not.toBeInTheDocument()
  })

  it('a Finish waiting on this phone reads as finished (also after a reload) and the action bar steps aside', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
    localStorage.setItem('odip_offline:u1:queue', JSON.stringify([{
      id: 'f1', userId: 'u1', viewAsTenant: null, viewAsUser: null, shiftId: 'shift-1', kind: 'finish', path: '/portal/shifts/shift-1/finish', method: 'POST',
      body: { anythingToReport: false }, clientTimeField: 'finishedAt', clientTime: '2026-08-17T17:00:00Z', createdAt: '2026-08-17T17:00:00Z', status: 'waiting',
      label: { participant: 'Mia Chen', serviceDate: '2026-08-17', rostered: '9:00 am – 5:00 pm' },
    }]))
    show(inProgress())
    expect(screen.getByText('Shift finished on this phone')).toBeInTheDocument()
    expect(screen.getAllByText(/sent to your coordinator when you.re back online/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/as soon as it goes through/i)).not.toBeInTheDocument()
    expect(screen.getAllByText('Waiting to send').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'End shift' })).not.toBeInTheDocument()
  })

  const queued = (id: string, kind: string, extra: object) => ({
    id, userId: 'u1', viewAsTenant: null, viewAsUser: null, shiftId: 'shift-1', kind, path: `/portal/shifts/shift-1/${kind}`, method: 'POST', body: {},
    clientTime: '2026-08-17T17:00:00Z', createdAt: 1, status: 'waiting', label: { participant: 'Mia Chen', serviceDate: '2026-08-17', rostered: '9:00 am – 5:00 pm' }, ...extra,
  })

  it('a Finish that is still trying says it goes through as soon as it can, not when back online', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
    localStorage.setItem('odip_offline:u1:queue', JSON.stringify([queued('f1', 'finish', { attempts: 5 })]))
    show(inProgress())
    expect(screen.getAllByText(/sent to your coordinator as soon as it goes through/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/when you.re back online/i)).not.toBeInTheDocument()
    expect(screen.getAllByText('Still trying').length).toBeGreaterThan(0)
  })

  it('a routine reads Still trying when its earlier tick is stuck, even if a later untick is not', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
    localStorage.setItem('odip_offline:u1:queue', JSON.stringify([queued('t1', 'tick', { target: 'r1', createdAt: 1, attempts: 5 }), queued('t2', 'untick', { target: 'r1', createdAt: 2 })]))
    show(inProgress({ shiftRoutines: [{ id: 'r1', title: 'Morning routine', description: '', category: 'PersonalCare', isCritical: false, startTime: null, endTime: null, occursAt: '2026-08-17T09:00:00', afterMidnight: false, isChecked: false, checkedAt: null, checkedByName: null, fromTickSnapshot: false }] as never }))
    expect(screen.getAllByText('Still trying').length).toBeGreaterThan(0)
    expect(screen.queryByText('Waiting to send')).not.toBeInTheDocument()
  })

  it('tells the worker when this phone\'s Finish reached a shift already submitted elsewhere', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
    localStorage.setItem('odip_offline:u1:already:shift-1', JSON.stringify({ savedAt: Date.now(), data: true }))
    show(makeDetail({ status: 'PendingReview', completion: makeCompletion() }))
    expect(screen.getByText(/already submitted before this phone sent its Finish, so the details entered here \(times, travel, kilometres, handover\) weren.t added/)).toBeInTheDocument()
  })
})

describe('PortalShiftDetailPage: the time check before Start (W2)', () => {
  const at = (iso: string) => vi.setSystemTime(new Date(iso))   // the shift is rostered 09:00 Brisbane, 2026-08-16T23:00:00Z
  const startButton = () => screen.getByRole('button', { name: /start shift/i })

  it('opens the sheet 12 minutes early, names the minutes, and does not start yet', async () => {
    at('2026-08-16T22:48:00Z')
    show(makeDetail())
    fireEvent.click(startButton())
    expect(await screen.findByRole('dialog', { name: "You're starting 12 minutes early" })).toBeInTheDocument()
    expect(startMutateAsync).not.toHaveBeenCalled()
  })

  it('names a late start the same way', async () => {
    at('2026-08-16T23:07:00Z')
    show(makeDetail())
    fireEvent.click(startButton())
    expect(await screen.findByRole('dialog', { name: "You're starting 7 minutes late" })).toBeInTheDocument()
  })

  it('sends the typed reason as startTimeReason, trimmed', async () => {
    at('2026-08-16T22:48:00Z')
    show(makeDetail())
    fireEvent.click(startButton())
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText('Your shift is rostered to start at 9:00 am.')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Why are you starting early? (optional)')).toHaveFocus()
    fireEvent.change(within(sheet).getByLabelText('Why are you starting early? (optional)'), { target: { value: '  Bus was early  ' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start shift' }))
    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', data: { geolocationDeclined: false, startTimeReason: 'Bus was early' } }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('still starts with an empty box, and sends no startTimeReason', async () => {
    at('2026-08-16T22:48:00Z')
    show(makeDetail())
    fireEvent.click(startButton())
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start shift' }))
    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledTimes(1))
    expect(startMutateAsync.mock.calls[0][0].data).not.toHaveProperty('startTimeReason')
  })

  it('Not yet closes the sheet and sends nothing', async () => {
    at('2026-08-16T22:48:00Z')
    show(makeDetail())
    fireEvent.click(startButton())
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Not yet' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(startMutateAsync).not.toHaveBeenCalled()
  })

  it('opens no sheet 4 minutes early, and Start goes at once', async () => {
    at('2026-08-16T22:56:00Z')
    show(makeDetail())
    fireEvent.click(startButton())
    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the sheet open and says why when Start fails', async () => {
    at('2026-08-16T22:48:00Z')
    startMutateAsync.mockRejectedValueOnce(new Error('offline'))
    show(makeDetail())
    fireEvent.click(startButton())
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start shift' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(/couldn't start this shift/i)
  })

  it('asks about the time first, then the location, and carries the reason into the location Start', async () => {
    at('2026-08-16T22:48:00Z')
    const ask = vi.fn()
    Object.defineProperty(global.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => { ask(); ok({ coords: { latitude: -27.5, longitude: 153.02, accuracy: 12 } }) } } })
    show(placed())
    fireEvent.click(startButton())
    const sheet = await screen.findByRole('dialog')
    expect(ask).not.toHaveBeenCalled()
    fireEvent.change(within(sheet).getByLabelText(/^Why are you starting (early|late)\? \(optional\)$/), { target: { value: 'Early handover' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start shift' }))
    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', data: { latitude: -27.5, longitude: 153.02, accuracyMetres: 12, geolocationDeclined: false, startTimeReason: 'Early handover' } }))
  })
})

describe('PortalShiftDetailPage: End shift takes the end at the tap (finish later)', () => {
  const inProgress = (over: Partial<PortalShiftDetailDto> = {}) => makeDetail({ status: 'InProgress', completion: makeCompletion(), ...over })
  const bar = () => within(screen.getByRole('toolbar', { name: 'Shift actions' }))
  const tapEnd = () => fireEvent.click(screen.getByRole('button', { name: 'End shift' }))

  it('End shift sends the finish once, with no typed end, and opens the details page', async () => {
    show(inProgress())
    tapEnd()
    await waitFor(() => expect(finishMutateAsync).toHaveBeenCalledTimes(1))
    expect(finishMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', data: { detailsLater: true } })
    expect(saveDetailsMutateAsync).not.toHaveBeenCalled()
    expect(bar().getByRole('button', { name: 'Submit shift' })).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem('odip-shift-end-draft:shift-1')!)).toMatchObject({ open: true, tappedAt: expect.any(String) })
  })

  it('a running break ends first, then the shift', async () => {
    const brk = { id: 'b1', startedAt: '2026-08-17T10:00:00Z', endedAt: null, isRunning: true, minutes: 0, editedAt: null, createdByUserId: 'u', withParticipant: false }
    show(inProgress({ breaks: [brk] as never }))
    tapEnd()
    await waitFor(() => expect(finishMutateAsync).toHaveBeenCalled())
    expect(endBreakMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', breakId: 'b1' })
    expect(endBreakMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(finishMutateAsync.mock.invocationCallOrder[0])
  })

  it('a second tap inside 25 minutes sends the first tap as the end', async () => {
    vi.setSystemTime(new Date('2026-08-17T07:12:00Z'))
    saveDraft({ touched: false, tappedAt: '2026-08-17T07:00:00Z', open: false })
    show(inProgress())
    tapEnd()
    await waitFor(() => expect(finishMutateAsync).toHaveBeenCalled())
    expect(finishMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', data: { detailsLater: true, endTappedAt: '2026-08-17T07:00:00Z' } })
  })

  it('D3a: online End shift sends exactly one finish with detailsLater and no endTappedAt', async () => {
    show(inProgress())
    tapEnd()
    await waitFor(() => expect(finishMutateAsync).toHaveBeenCalledTimes(1))
    const data = finishMutateAsync.mock.calls[0][0].data
    expect(data).toEqual({ detailsLater: true })
    expect(data).not.toHaveProperty('endTappedAt')
  })

  it('D3b: a re-tap after a failed finish reuses the saved tap and sends it as endTappedAt', async () => {
    vi.setSystemTime(new Date('2026-08-17T07:00:00Z'))
    finishMutateAsync.mockRejectedValueOnce(new Error('Network Error'))
    const first = show(inProgress())
    tapEnd()
    await waitFor(() => expect(finishMutateAsync).toHaveBeenCalledTimes(1))
    const draft = JSON.parse(sessionStorage.getItem('odip-shift-end-draft:shift-1')!)
    expect(draft.tappedAt).toBe('2026-08-17T07:00:00.000Z')
    sessionStorage.setItem('odip-shift-end-draft:shift-1', JSON.stringify({ ...draft, open: false }))   // Back to shift
    first.unmount()
    vi.setSystemTime(new Date('2026-08-17T07:05:00Z'))
    show(inProgress())
    tapEnd()
    await waitFor(() => expect(finishMutateAsync).toHaveBeenCalledTimes(2))
    expect(finishMutateAsync.mock.calls[1][0]).toEqual({ id: 'shift-1', data: { detailsLater: true, endTappedAt: '2026-08-17T07:00:00.000Z' } })
  })

  it('D1/D3c: a running break ends at the tap even when a dose is due, and no finish is sent', async () => {
    const brk = { id: 'b1', startedAt: '2026-08-17T10:00:00Z', endedAt: null, isRunning: true, minutes: 0, editedAt: null, createdByUserId: 'u', withParticipant: false }
    show(inProgress({
      breaks: [brk] as never,
      finishBlockers: [{ code: 'DOSE_OUTCOME_MISSING', message: 'x', medicationId: 'med-1', medicationName: 'Paracetamol', scheduledAt: '2026-08-17T12:00:00' }] as never,
    }))
    tapEnd()
    await waitFor(() => expect(endBreakMutateAsync).toHaveBeenCalledWith({ id: 'shift-1', breakId: 'b1' }))
    expect(finishMutateAsync).not.toHaveBeenCalled()
  })

  it('a dose due online holds the end back: nothing is sent, the tap is kept in the draft', async () => {
    show(inProgress({ finishBlockers: [{ code: 'DOSE_OUTCOME_MISSING', message: 'x', medicationId: 'med-1', medicationName: 'Paracetamol', scheduledAt: '2026-08-17T12:00:00' }] as never }))
    tapEnd()
    await waitFor(() => expect(bar().getByRole('button', { name: 'Submit shift' })).toBeInTheDocument())
    expect(finishMutateAsync).not.toHaveBeenCalled()
    expect(JSON.parse(sessionStorage.getItem('odip-shift-end-draft:shift-1')!).tappedAt).toEqual(expect.any(String))
  })

  it('an ended shift with details missing says Needs details, lists what is left and opens the page from Add details', () => {
    show(makeDetail({
      status: 'PendingReview', missingDetails: ['kilometres', 'handover'] as never,
      completion: makeCompletion({ actualEnd: '2026-08-17T07:00:30Z', missingDetails: ['kilometres', 'handover'] as never }),
    }))
    expect(screen.getAllByText('Needs details').length).toBeGreaterThan(0)
    expect(screen.getByText('Add the rest of this shift')).toBeInTheDocument()
    expect(screen.getByText(/Still to add: kilometres and handover/)).toBeInTheDocument()
    expect(screen.queryByText(/waiting for your coordinator/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add details' }))
    expect(bar().getByRole('button', { name: 'Submit shift' })).toBeInTheDocument()
  })

  it('the #finish link from My shifts opens the details page straight away', () => {
    show(makeDetail({
      status: 'PendingReview', missingDetails: ['kilometres'] as never,
      completion: makeCompletion({ actualEnd: '2026-08-17T07:00:30Z', missingDetails: ['kilometres'] as never }),
    }), '#finish')
    expect(bar().getByRole('button', { name: 'Submit shift' })).toBeInTheDocument()
  })
})
