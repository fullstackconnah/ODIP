import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import IncidentCreatePage from './IncidentCreatePage'
import type { MarIncidentPrefillState, ShiftNoteIncidentPrefillState } from '@/lib/incidentPrefill'

const {
  mockUseIncident, mockCreateMutateAsync, mockUpdateMutateAsync, mockUseRestrictivePractices, mockApiPost,
} = vi.hoisted(() => ({
  mockUseIncident: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockUseRestrictivePractices: vi.fn(),
  mockApiPost: vi.fn(),
}))

// Only the API layer is mocked — FormField, Card are the real components, so this exercises the
// actual conditional-reveal wiring (INC-01 trip dropdown, INC-02 specify field) and the real
// wizard shell (useWizard/WizardStepRail/WizardNavFooter/WizardReviewStep).
vi.mock('@/api/hooks', () => ({
  useCreateIncident: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false, isError: false }),
  useUpdateIncident: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false, isError: false }),
  useIncident: mockUseIncident,
  useTrips: () => ({ data: [{ id: 'trip-1', tripName: 'Gold Coast Beach Break' }, { id: 'trip-2', tripName: 'Blue Mountains Adventure' }] }),
  // 'staff-3' deliberately shares a fullName with 'staff-1' — a same-name-different-id fixture
  // for the INC-03 Reported-By prefill: it must never resolve by name (see the test below).
  useStaff: () => ({ data: [
    { id: 'staff-1', fullName: 'Alex Rivera' },
    { id: 'staff-3', fullName: 'Alex Rivera' },
  ] }),
  useParticipants: () => ({ data: [{ id: 'participant-1', firstName: 'Sophie', lastName: 'Brown', fullName: 'Sophie Brown' }] }),
  // INC-04/INC-05/IN-4
  useRestrictivePractices: mockUseRestrictivePractices,
}))

// NOTES-02: apiPost is only used here for the fire-and-forget acknowledge-flags call after a
// shift-note-sourced submission — every other API interaction on this page goes through the
// fully-mocked @/api/hooks above, so mocking just this one named export (keeping the rest of the
// module real) is enough.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, apiPost: mockApiPost }
})

// IncidentCreatePage calls useUnsavedChangesWarning, which uses react-router 7's useBlocker —
// that throws under a plain declarative <MemoryRouter>/<Routes>, so tests need a data router
// (same requirement ParticipantCreatePage.test.tsx documents).
function renderCreatePage(initialEntry: string | { pathname: string; state?: unknown } = '/incidents/new') {
  const router = createMemoryRouter(
    [
      { path: '/incidents/new', element: <IncidentCreatePage /> },
      { path: '/incidents/:id/edit', element: <IncidentCreatePage /> },
      { path: '/incidents', element: <div>Incidents list</div> },
    ],
    { initialEntries: [initialEntry] },
  )
  return render(<RouterProvider router={router} />)
}

// ── IN-1/IN-3/IN-4/IN-6 wizard navigation helpers ──────────────────────────────────────────
// The form's fields are now split across wizard steps (Basics / Restrictive Practice
// [conditional] / Incident Details / Review & Compliance [edit-only] / Review), and three of
// Basics' native <select>s became Dropdown ('form' variant, GEN-1) — opened by clicking the
// labelled trigger, then picking a `role="option"` by its visible label text, exactly like the
// pre-existing restrictivePracticeType Dropdown already did on the old single-page form.

async function openAndSelect(user: ReturnType<typeof userEvent.setup>, labelMatcher: string | RegExp, optionMatcher: string | RegExp) {
  await user.click(screen.getByLabelText(labelMatcher))
  await user.click(screen.getByRole('option', { name: optionMatcher }))
}

async function selectReportedByFirstAlexRivera(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('Reported By *'))
  await user.click(screen.getAllByRole('option', { name: 'Alex Rivera' })[0])
}

async function clickNext(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Next' }))
}

async function clickBack(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Back' }))
}

/** Fills every field Basics requires by default (title, incidentType='Other's specify text
 * unless overridden, reportedBy) and clicks Next — lands on whichever step comes after Basics
 * (Restrictive Practice if incidentType is RestrictivePracticeUse, Incident Details otherwise). */
async function fillBasicsMinimallyAndNext(
  user: ReturnType<typeof userEvent.setup>,
  opts: { title?: string; incidentTypeOption?: string | RegExp; otherTypeSpecify?: string; selectParticipant?: boolean } = {},
) {
  const { title = 'Incident title', incidentTypeOption, otherTypeSpecify, selectParticipant } = opts
  await user.type(screen.getByPlaceholderText('Brief incident summary'), title)
  if (selectParticipant) {
    await user.click(screen.getByLabelText('Involved Participant'))
    await user.click(screen.getByRole('option', { name: 'Sophie Brown' }))
  }
  if (incidentTypeOption) {
    await openAndSelect(user, 'Incident Type *', incidentTypeOption)
  }
  // Default incidentType is 'Other', which requires the specify field, unless the caller picked
  // a different incident type above.
  if (!incidentTypeOption || incidentTypeOption === 'Other' || (incidentTypeOption instanceof RegExp && incidentTypeOption.test('Other'))) {
    await user.type(screen.getByPlaceholderText('Describe the incident type'), otherTypeSpecify ?? 'Lost property')
  }
  await selectReportedByFirstAlexRivera(user)
  await clickNext(user)
}

/** From the Restrictive Practice step, fills the type + picks the "unapproved" path (no active
 * practice to link) and clicks Next — used by tests that don't care about the RP determination
 * itself, just need to get past this step's own required fields. */
async function fillUnapprovedRpAndNext(user: ReturnType<typeof userEvent.setup>, typeOption: string | RegExp, details = 'Improvised, not on the register.') {
  await openAndSelect(user, /Restrictive Practice Type/i, typeOption)
  await user.click(screen.getByRole('radio', { name: /none of these/i }))
  await user.type(screen.getByLabelText(/Describe the restrictive practice/i), details)
  await clickNext(user)
}

/** Fills Incident Details' two required fields (description, date/time) and clicks Next —
 * lands on Review (create mode) or Review & Compliance (edit mode). */
async function fillDetailsMinimallyAndNext(user: ReturnType<typeof userEvent.setup>, description = 'Details here') {
  await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), description)
  await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')
  await clickNext(user)
}

/** IN-5: adds one injury row via BodyDiagram's always-available button list — required before
 * Incident Details' Next succeeds whenever incidentType is 'Injury'. */
async function addMinimalInjury(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Head' }))
  await user.type(screen.getByLabelText(/Injury Description/i), 'Bumped head.')
  await user.click(screen.getByRole('button', { name: 'Add injury' }))
}

beforeEach(() => {
  mockUseIncident.mockReturnValue({ data: undefined })
  mockCreateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockReset()
  mockCreateMutateAsync.mockResolvedValue({ success: true, data: { id: 'new-incident-1' } })
  mockUseRestrictivePractices.mockReturnValue({ data: [] })
  mockApiPost.mockReset().mockResolvedValue({ success: true, data: null })
  localStorage.clear()
})

describe('IncidentCreatePage — INC-01 service type / trip linkage', () => {
  it('does not show the Trip dropdown until Service Type is set to Trip', async () => {
    renderCreatePage()

    expect(screen.queryByLabelText(/^Trip/)).not.toBeInTheDocument()

    const user = userEvent.setup()
    await openAndSelect(user, /Service Type/i, 'Trip')

    expect(screen.getByLabelText(/^Trip/)).toBeInTheDocument()
  })

  it('hides the Trip dropdown again when Service Type changes away from Trip', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await openAndSelect(user, /Service Type/i, 'Trip')
    expect(screen.getByLabelText(/^Trip/)).toBeInTheDocument()

    await openAndSelect(user, /Service Type/i, 'STA')
    expect(screen.queryByLabelText(/^Trip/)).not.toBeInTheDocument()
  })

  it('blocks advancing past Basics when Service Type is Trip but no trip is selected', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'Slip near pool')
    await openAndSelect(user, /Service Type/i, 'Trip')
    await user.type(screen.getByPlaceholderText('Describe the incident type'), 'Slip and fall')
    await selectReportedByFirstAlexRivera(user)

    await clickNext(user)

    expect(await screen.findByText(/trip must be selected/i)).toBeInTheDocument()
    // Still on Basics — the Incident Details fields (a later step) never even mount.
    expect(screen.queryByPlaceholderText('Detailed description of the incident...')).not.toBeInTheDocument()
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
  })

  it('submits with a serviceType/tripInstanceId payload when Trip is selected', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'Slip near pool')
    await openAndSelect(user, /Service Type/i, 'Trip')
    await openAndSelect(user, /^Trip/, 'Gold Coast Beach Break')
    // incidentType defaults to 'Other', which requires the specify field too.
    await user.type(screen.getByPlaceholderText('Describe the incident type'), 'Slip and fall')
    await selectReportedByFirstAlexRivera(user)
    await clickNext(user) // Basics -> Incident Details

    await fillDetailsMinimallyAndNext(user) // Incident Details -> Review

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      serviceType: 'Trip',
      tripInstanceId: 'trip-1',
    })
  })
})

describe('IncidentCreatePage — INC-02 "Other" incident type specify field', () => {
  it('shows the specify field once Incident Type is Other (the default)', () => {
    renderCreatePage()
    expect(screen.getByLabelText(/Specify Incident Type/i)).toBeInTheDocument()
  })

  it('hides the specify field for a non-Other incident type', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await openAndSelect(user, 'Incident Type *', 'Injury')
    expect(screen.queryByLabelText(/Specify Incident Type/i)).not.toBeInTheDocument()
  })

  it('blocks advancing past Basics when Incident Type is Other but nothing is specified', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'Something happened')
    await selectReportedByFirstAlexRivera(user)

    await clickNext(user)

    expect(await screen.findByText(/specify the incident type/i)).toBeInTheDocument()
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
  })

  it('submits with otherTypeSpecify once filled in', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'Something happened', otherTypeSpecify: 'Lost property' })
    await fillDetailsMinimallyAndNext(user)

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      incidentType: 'Other',
      otherTypeSpecify: 'Lost property',
    })
  })
})

// INC-03: RecordAdministrationModal's "Report as incident" navigates here with router state —
// this page reads it into the form. Nothing was persisted to create this state; it's purely
// client-side hand-off, so a page refresh (state lost) is equivalent to landing here fresh.
// IN-8: every prefilled field lands on step 0 (Basics) or step 2 (Incident Details) — the wizard
// mounts on Basics as normal (no auto-advance), so Basics-owned fields are assertable immediately
// and Details-owned fields (description/incidentDateTime) need one Next click to reach.
describe('IncidentCreatePage — INC-03 MAR drop-into-draft prefill', () => {
  const marPrefill: MarIncidentPrefillState = {
    source: 'mar-administration',
    outcome: 'WrongMedication',
    participantId: 'participant-1',
    participantName: 'Sophie Brown',
    medicationName: 'Insulin',
    strength: '18 units',
    doseDescription: null,
    scheduledAt: '2026-08-01T00:30:00Z',
    administeredAt: '2026-08-01T01:00:00Z',
    administeredAtTimeZone: 'Australia/Brisbane',
    recordedByName: 'Alex Rivera',
    recordedByUserId: 'staff-1',
    reason: 'Grabbed the wrong blister pack',
    notes: 'Gave Paracetamol 500mg instead',
    tripInstanceId: null,
  }

  it('shows the pre-fill banner and populates title/incident type/severity/participant on Basics, and description on Incident Details', async () => {
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/new', state: marPrefill })

    expect(screen.getByText(/pre-filled from the medication record/i)).toBeInTheDocument()

    expect((screen.getByPlaceholderText('Brief incident summary') as HTMLInputElement).value)
      .toContain('Insulin')
    expect((screen.getByLabelText('Incident Type *') as HTMLElement).textContent ?? '').not.toBe('')
    // Involved Participant is a SearchableSelect combobox — its displayed value is the resolved
    // item's label (derived from involvedParticipantId), not the raw id.
    expect(screen.getByLabelText('Involved Participant')).toHaveValue('Sophie Brown')

    // description/incidentDateTime are Incident Details fields — one step further along, but
    // already atomically populated by the same reset() call (IN-8: no staged/partial prefill).
    await clickNext(user)
    expect((screen.getByPlaceholderText('Detailed description of the incident...') as HTMLTextAreaElement).value)
      .toContain('Sophie Brown')
  })

  it('sets Reported By directly from the MAR record\'s recordedByUserId (Staff/User are unified — same id space)', async () => {
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/new', state: marPrefill })

    // staff-1 and staff-3 deliberately share the fullName "Alex Rivera" (see the useStaff mock
    // above), so the combobox's displayed text alone can't prove *which* one resolved — open it
    // and check which option is marked aria-selected, which is driven by id equality, not label.
    await user.click(screen.getByLabelText('Reported By *'))
    const options = screen.getAllByRole('option', { name: 'Alex Rivera' })
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')
  })

  // Regression coverage for the audit-trail integrity fix: fullName has no uniqueness
  // constraint (the staff mock above deliberately has two "Alex Rivera" entries, staff-1 and
  // staff-3), so the prefill must never fall back to matching by name — doing so risked
  // silently attributing "Reported By" on an NDIS incident report to the wrong person.
  it('never resolves Reported By by name, even when the id has no match and a same-named staff member exists', () => {
    renderCreatePage({
      pathname: '/incidents/new',
      state: { ...marPrefill, recordedByUserId: 'no-such-staff-id', recordedByName: 'Alex Rivera' },
    })

    // No item's value matches 'no-such-staff-id', so the combobox must show blank rather than
    // ever resolving to a staff member sharing the recorded name.
    expect(screen.getByLabelText('Reported By *')).toHaveValue('')
  })

  it('leaves Reported By blank (never a wrong guess) when recordedByUserId is absent entirely', () => {
    renderCreatePage({
      pathname: '/incidents/new',
      state: { ...marPrefill, recordedByUserId: null },
    })

    expect(screen.getByLabelText('Reported By *')).toHaveValue('')
  })

  it('sets serviceType to Trip and reveals the trip dropdown when the MAR record carries a tripInstanceId', () => {
    renderCreatePage({ pathname: '/incidents/new', state: { ...marPrefill, tripInstanceId: 'trip-1' } })

    expect(screen.getByLabelText(/Service Type/i)).toHaveTextContent('Trip')
    expect(screen.getByLabelText(/^Trip/)).toHaveValue('Gold Coast Beach Break')
  })

  it('submits the pre-filled values through to the create payload unchanged if the coordinator submits as-is', async () => {
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/new', state: marPrefill })

    // Every Basics-required field (title/reportedBy/incidentType/severity) arrived pre-filled —
    // Next succeeds immediately, same for Incident Details' description/incidentDateTime.
    await clickNext(user) // Basics -> Incident Details
    await clickNext(user) // Incident Details -> Review
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      incidentType: 'MedicationError',
      severity: 'High',
      involvedParticipantId: 'participant-1',
      reportedByStaffId: 'staff-1',
    })
  })

  it('does not show the banner or prefill anything on a plain "Report New Incident" visit (no router state)', () => {
    renderCreatePage('/incidents/new')

    expect(screen.queryByText(/pre-filled from the medication record/i)).not.toBeInTheDocument()
    expect((screen.getByPlaceholderText('Brief incident summary') as HTMLInputElement).value).toBe('')
  })

  it('ignores MAR prefill state when editing an existing incident', () => {
    mockUseIncident.mockReturnValue({
      data: {
        id: 'incident-1', serviceType: 'None', tripInstanceId: null, incidentType: 'Injury', otherTypeSpecify: null,
        severity: 'Low', status: 'Draft', title: 'Existing incident', incidentDateTime: '2026-08-01T09:00',
        location: null, reportedByStaffId: 'staff-1', description: 'Existing description', reportedByName: 'Alex Rivera',
        involvedParticipantName: null, qscReportingStatus: 'NotRequired', isOverdue24h: false, createdAt: '2026-08-01T09:00:00Z',
        participantBookingId: null, involvedParticipantId: null, involvedStaffId: null, involvedStaffName: null,
        immediateActionsTaken: null, wereEmergencyServicesCalled: false, emergencyServicesDetails: null,
        witnessNames: null, witnessStatements: null, injuries: [], qscReportedAt: null, qscReferenceNumber: null,
        reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null,
        resolvedAt: null, familyNotified: false, familyNotifiedAt: null, supportCoordinatorNotified: false,
        supportCoordinatorNotifiedAt: null, updatedAt: '2026-08-01T09:00:00Z',
      },
    })
    renderCreatePage({ pathname: '/incidents/incident-1/edit', state: marPrefill })

    expect(screen.queryByText(/pre-filled from the medication record/i)).not.toBeInTheDocument()
    expect((screen.getByPlaceholderText('Brief incident summary') as HTMLInputElement).value).toBe('Existing incident')
  })
})

// NOTES-02: closing the loop on the shift-note-sourced prefill — a successful submission that
// carried a shiftNoteId acknowledges that note's flags (fire-and-forget), so its banner doesn't
// keep reappearing on the portal until a separate Dismiss. The filer is the note's own author by
// construction, so the acknowledge endpoint's author-only ownership check holds without needing
// to pass any extra identity here.
//
// This prefill's suggested incidentType ('Falls' category -> 'Injury') now also means the
// Incident Details step requires at least one injury row (IN-5) before Next succeeds — a genuine
// new interaction this branch introduces, not present when injuries didn't exist.
describe('IncidentCreatePage — NOTES-02 shift-note prefill acknowledges flags on submit', () => {
  const shiftNotePrefill: ShiftNoteIncidentPrefillState = {
    source: 'shift-note',
    shiftNoteId: 'note-9',
    categories: ['Falls'],
    participantId: 'participant-1',
    participantName: 'Sophie Brown',
    noteBody: 'She had a fall near the bathroom.',
    serviceDate: '2026-08-17',
    startTime: '09:00:00',
    endTime: '17:00:00',
    endsNextDay: false,
    reportedByUserId: 'staff-1',
  }

  it('shows the pre-fill banner and populates the form from the flagged note', () => {
    renderCreatePage({ pathname: '/incidents/new', state: shiftNotePrefill })

    expect(screen.getByText(/pre-filled from a flagged shift note/i)).toBeInTheDocument()
    expect((screen.getByPlaceholderText('Brief incident summary') as HTMLInputElement).value)
      .toContain('Sophie Brown')
    expect(screen.getByLabelText('Incident Type *')).toHaveTextContent('Injury')
  })

  it('acknowledges the source note\'s flags after a successful submit', async () => {
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/new', state: shiftNotePrefill })

    await clickNext(user) // Basics -> Incident Details
    // Falls -> Injury: at least one injury row is required before Next succeeds.
    await addMinimalInjury(user)
    await clickNext(user) // Incident Details -> Review
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(await screen.findByText('Incidents list')).toBeInTheDocument()
    expect(mockApiPost).toHaveBeenCalledTimes(1)
    expect(mockApiPost).toHaveBeenCalledWith('/portal/notes/note-9/acknowledge-flags')
  })

  it('does not call acknowledge-flags on a plain submit with no shift-note prefill', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'Something happened', otherTypeSpecify: 'Lost property' })
    await fillDetailsMinimallyAndNext(user)
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(await screen.findByText('Incidents list')).toBeInTheDocument()
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it('still completes the submission (navigates away, no error shown) when acknowledging flags fails', async () => {
    const user = userEvent.setup()
    mockApiPost.mockRejectedValue(new Error('network error'))
    renderCreatePage({ pathname: '/incidents/new', state: shiftNotePrefill })

    await clickNext(user)
    await addMinimalInjury(user)
    await clickNext(user)
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(await screen.findByText('Incidents list')).toBeInTheDocument()
    expect(screen.queryByText(/failed to (create|update) incident report/i)).not.toBeInTheDocument()
  })
})

describe('IncidentCreatePage — INC-04 RP incident authorisation determination', () => {
  it('does not show the Restrictive Practice Details card for non-RP incident types', () => {
    renderCreatePage()
    expect(screen.queryByText('Restrictive Practice Details')).not.toBeInTheDocument()
  })

  it('shows the RP type picker once Incident Type is Restrictive Practice Use (a new step reached via Next)', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i })

    expect(screen.getByText('Restrictive Practice Details')).toBeInTheDocument()
    expect(screen.getByLabelText(/Restrictive Practice Type/i)).toBeInTheDocument()
  })

  it('blocks advancing past the Restrictive Practice step when no RP type is chosen', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i })
    await clickNext(user) // still on the Restrictive Practice step — nothing chosen yet

    expect(await screen.findByText(/select the restrictive practice type/i)).toBeInTheDocument()
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
  })

  it('shows a neutral banner until both participant and type are chosen', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i })

    expect(screen.getByText(/select the involved participant and restrictive practice type/i)).toBeInTheDocument()
  })

  it('shows an authorised banner when the involved participant has a matching active practice', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: '2026-12-01', isActive: true },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i, selectParticipant: true })
    await openAndSelect(user, /Restrictive Practice Type/i, /^seclusion/i)

    expect(await screen.findByText(/matches an active practice/i)).toBeInTheDocument()
  })

  it('shows the "may be reportable" banner when the involved participant has no matching active practice', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [] })
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i, selectParticipant: true })
    await openAndSelect(user, /Restrictive Practice Type/i, /^seclusion/i)

    expect(await screen.findByText(/no matching authorised practice — this may be a reportable incident/i)).toBeInTheDocument()
  })

  // IN-4: with no participant selected there is nothing to link, so reaching Review requires
  // going through the "None of these — unapproved" path. This also proves the central rule end
  // to end on the frontend: the payload never carries both restrictivePracticeId and
  // unapprovedRestrictivePracticeDetails.
  it('submits restrictivePracticeType and unapprovedRestrictivePracticeDetails (never restrictivePracticeId) in the create payload', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i })
    await fillUnapprovedRpAndNext(user, /^seclusion/i, 'Improvised seclusion, not on file')
    await fillDetailsMinimallyAndNext(user)

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload).toMatchObject({
      incidentType: 'RestrictivePracticeUse',
      restrictivePracticeType: 'Seclusion',
      unapprovedRestrictivePracticeDetails: 'Improvised seclusion, not on file',
    })
    expect(payload.restrictivePracticeId).toBeUndefined()
  })
})

describe('IncidentCreatePage — INC-05 link to an authorised practice', () => {
  it("lists the involved participant's active practices of the selected type, not other types, as selectable rows", async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: '2026-12-01', isActive: true },
      { id: 'rp-2', type: 'PhysicalRestraint', description: 'Two-person hold.', reviewDate: null, isActive: true },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i, selectParticipant: true })
    await openAndSelect(user, /Restrictive Practice Type/i, /^seclusion/i)

    expect(screen.getByRole('radio', { name: /Seclusion room during acute crisis/i })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Two-person hold/i })).not.toBeInTheDocument()
  })

  it('linking a practice prepopulates an empty description (visible once Incident Details is reached)', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: '2026-12-01', isActive: true },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i, selectParticipant: true })
    await openAndSelect(user, /Restrictive Practice Type/i, /^seclusion/i)
    await user.click(screen.getByRole('radio', { name: /Seclusion room during acute crisis/i }))
    await clickNext(user) // Restrictive Practice -> Incident Details

    expect((screen.getByPlaceholderText('Detailed description of the incident...') as HTMLTextAreaElement).value)
      .toContain('Seclusion room during acute crisis.')
  })

  // Reworked navigation for the wizard: description now lives on a LATER step than the RP
  // linking control, so "already typed" has to be established on Incident Details, then the
  // reporter goes Back to the Restrictive Practice step and switches the link — the same
  // never-overwrite behaviour as before, just exercised via a different path.
  it('never overwrites an already-typed description when linking a practice', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: null, isActive: true },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i, selectParticipant: true })
    await fillUnapprovedRpAndNext(user, /^seclusion/i, 'placeholder, will switch to a linked practice')
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), 'Already typed details')
    await clickBack(user) // Incident Details -> Restrictive Practice
    await user.click(screen.getByRole('radio', { name: /Seclusion room during acute crisis/i }))
    await clickNext(user) // Restrictive Practice -> Incident Details

    expect((screen.getByPlaceholderText('Detailed description of the incident...') as HTMLTextAreaElement).value)
      .toBe('Already typed details')
  })

  it('submits restrictivePracticeId when a practice is linked', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: null, isActive: true },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i, selectParticipant: true })
    await openAndSelect(user, /Restrictive Practice Type/i, /^seclusion/i)
    await user.click(screen.getByRole('radio', { name: /Seclusion room during acute crisis/i }))
    await clickNext(user) // Restrictive Practice -> Incident Details
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), ' Details here')
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')
    await clickNext(user) // Incident Details -> Review

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload).toMatchObject({
      restrictivePracticeType: 'Seclusion',
      restrictivePracticeId: 'rp-1',
    })
    expect(payload.unapprovedRestrictivePracticeDetails).toBeUndefined()
  })
})

// INC-04: the determination is frozen at creation — editing an existing incident must never
// silently re-run it against today's register, even if the participant/type fields are changed.
// Edit mode's initialVisited: 'all' (same jump-anywhere convention as ParticipantCreatePage) means
// every step's rail button is clickable immediately — these tests jump directly rather than
// stepping through Next, since nothing here is testing the Next-validation gate itself.
describe('IncidentCreatePage — INC-04 determination frozen on edit', () => {
  const existingRpIncident = {
    id: 'incident-1', serviceType: 'None', tripInstanceId: null, incidentType: 'RestrictivePracticeUse', otherTypeSpecify: null,
    restrictivePracticeType: 'Seclusion', restrictivePracticeId: 'rp-1', restrictivePracticeDescription: 'Seclusion room, acute crisis.',
    restrictivePracticeReviewDate: '2026-12-01', unapprovedRestrictivePracticeDetails: null, isRestrictivePracticeAuthorised: false,
    severity: 'High', status: 'Draft', title: 'Existing RP incident', incidentDateTime: '2026-08-01T09:00',
    location: null, reportedByStaffId: 'staff-1', description: 'Existing description', reportedByName: 'Alex Rivera',
    involvedParticipantName: 'Sophie Brown', qscReportingStatus: 'Required', isOverdue24h: false, createdAt: '2026-08-01T09:00:00Z',
    participantBookingId: null, involvedParticipantId: 'participant-1', involvedStaffId: null, involvedStaffName: null,
    immediateActionsTaken: null, wereEmergencyServicesCalled: false, emergencyServicesDetails: null,
    witnessNames: null, witnessStatements: null, injuries: [], qscReportedAt: null, qscReferenceNumber: null,
    reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null,
    resolvedAt: null, familyNotified: false, familyNotifiedAt: null, supportCoordinatorNotified: false,
    supportCoordinatorNotifiedAt: null, updatedAt: '2026-08-01T09:00:00Z',
  }

  it('shows the frozen unauthorised banner from the record, even though the register now has a matching active practice', async () => {
    mockUseIncident.mockReturnValue({ data: existingRpIncident })
    // If the banner were recomputed live, this active matching entry would flip it to authorised.
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room, acute crisis.', reviewDate: '2026-12-01', isActive: true },
    ] })
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/incident-1/edit' })

    await user.click(await screen.findByRole('button', { name: /Restrictive Practice/i }))

    expect(await screen.findByText(/no matching authorised practice — this may be a reportable incident/i)).toBeInTheDocument()
    expect(screen.getByText(/determined when this incident was created/i)).toBeInTheDocument()
  })

  it('keeps showing the frozen determination even after changing the RP type in the edit form', async () => {
    mockUseIncident.mockReturnValue({ data: existingRpIncident })
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room, acute crisis.', reviewDate: '2026-12-01', isActive: true },
    ] })
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/incident-1/edit' })

    await user.click(await screen.findByRole('button', { name: /Restrictive Practice/i }))
    await screen.findByText(/no matching authorised practice — this may be a reportable incident/i)
    await openAndSelect(user, /Restrictive Practice Type/i, /^physical restraint/i)

    expect(screen.getByText(/no matching authorised practice — this may be a reportable incident/i)).toBeInTheDocument()
  })
})

// UX-01: the four staff/participant pickers migrated from native <select>/register() to
// SearchableSelect — one keyboard-only smoke test per picker (open, arrow to an option, Enter).
describe('IncidentCreatePage — UX-01 SearchableSelect keyboard support', () => {
  it('selects Reported By via keyboard only (ArrowDown + Enter)', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    const reportedBy = screen.getByLabelText('Reported By *')
    await user.click(reportedBy)
    await user.keyboard('{ArrowDown}{Enter}')

    expect(reportedBy).toHaveValue('Alex Rivera')
  })

  it('selects Involved Participant via keyboard only (ArrowDown + Enter)', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    const involvedParticipant = screen.getByLabelText('Involved Participant')
    await user.click(involvedParticipant)
    // First enabled option is 'None' (value '') — one more ArrowDown reaches the participant.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(involvedParticipant).toHaveValue('Sophie Brown')
  })

  it('selects Involved Staff Member via keyboard only (ArrowDown + Enter)', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    const involvedStaff = screen.getByLabelText('Involved Staff Member')
    await user.click(involvedStaff)
    // First enabled option is 'None' (value '') — one more ArrowDown reaches the first staff entry.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(involvedStaff).toHaveValue('Alex Rivera')
  })

  it('selects Reviewed By via keyboard only (ArrowDown + Enter) on the edit form\'s Compliance step', async () => {
    mockUseIncident.mockReturnValue({
      data: {
        id: 'incident-1', serviceType: 'None', tripInstanceId: null, incidentType: 'PropertyDamage', otherTypeSpecify: null,
        severity: 'Low', status: 'Draft', title: 'Existing incident', incidentDateTime: '2026-08-01T09:00',
        location: null, reportedByStaffId: 'staff-1', description: 'Existing description', reportedByName: 'Alex Rivera',
        involvedParticipantName: null, qscReportingStatus: 'NotRequired', isOverdue24h: false, createdAt: '2026-08-01T09:00:00Z',
        participantBookingId: null, involvedParticipantId: null, involvedStaffId: null, involvedStaffName: null,
        immediateActionsTaken: null, wereEmergencyServicesCalled: false, emergencyServicesDetails: null,
        witnessNames: null, witnessStatements: null, injuries: [], qscReportedAt: null, qscReferenceNumber: null,
        reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null,
        resolvedAt: null, familyNotified: false, familyNotifiedAt: null, supportCoordinatorNotified: false,
        supportCoordinatorNotifiedAt: null, updatedAt: '2026-08-01T09:00:00Z',
      },
    })
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/incident-1/edit' })

    // Edit mode's 'all' initialVisited means every step's rail button is clickable immediately.
    await user.click(await screen.findByRole('button', { name: /Review & Compliance/i }))

    const reviewedBy = await screen.findByLabelText('Reviewed By')
    await user.click(reviewedBy)
    // First enabled option is 'Not reviewed' (value '') — one more ArrowDown reaches staff-1.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(reviewedBy).toHaveValue('Alex Rivera')
  })
})

// IN-3: reportedByStaffId defaults to the signed-in user (odip_user in localStorage) — a
// DEFAULT, not a lock. New coverage this branch adds (no equivalent existed on the pre-wizard
// single-page form, which never seeded a default at all).
describe('IncidentCreatePage — IN-3 reportedByStaffId defaults to the signed-in user', () => {
  it('pre-selects the signed-in user (by id, not name) when odip_user is present in localStorage', async () => {
    // staff-3 shares its fullName with staff-1 (see the useStaff mock) — asserting via
    // aria-selected on the specific option (not just the displayed label) proves this resolves
    // by id, the same audit-integrity guard INC-03's prefill test applies.
    localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-3', fullName: 'Alex Rivera' }))
    const user = userEvent.setup()
    renderCreatePage()

    const reportedBy = screen.getByLabelText('Reported By *')
    expect(reportedBy).toHaveValue('Alex Rivera')
    await user.click(reportedBy)
    const options = screen.getAllByRole('option', { name: 'Alex Rivera' })
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('leaves Reported By blank when there is no resolvable signed-in user (today\'s untouched behaviour)', () => {
    renderCreatePage()
    expect(screen.getByLabelText('Reported By *')).toHaveValue('')
  })

  it('is a default, not a lock — a manually-picked reporter is never silently reverted', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-1', fullName: 'Alex Rivera' }))
    const user = userEvent.setup()
    renderCreatePage()

    const reportedBy = screen.getByLabelText('Reported By *')
    expect(reportedBy).toHaveValue('Alex Rivera')
    // Manually switch to the other same-named entry, staff-3.
    await user.click(reportedBy)
    await user.click(screen.getAllByRole('option', { name: 'Alex Rivera' })[1])
    // Type into an unrelated field, forcing further re-renders — the explicit choice must hold.
    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'Unrelated edit')

    await user.click(reportedBy)
    const options = screen.getAllByRole('option', { name: 'Alex Rivera' })
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
  })
})
