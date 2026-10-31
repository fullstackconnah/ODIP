import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import IncidentCreatePage from './IncidentCreatePage'
import { refetchable } from '@/test/refetchable'
import type { MarIncidentPrefillState, ShiftNoteIncidentPrefillState, ShiftIncidentPrefillState } from '@/lib/incidentPrefill'
import {
  buildIncidentTitleSkeleton, buildIncidentDescriptionSkeleton, buildIncidentDateTime, suggestedIncidentSeverity,
  buildShiftNoteIncidentTitleSkeleton, buildShiftNoteIncidentDescriptionSkeleton, buildShiftNoteIncidentDateTime,
  suggestedIncidentTypeForShiftNote,
} from '@/lib/incidentPrefill'
import { INCIDENT_TYPE_LABELS, INCIDENT_SEVERITY_LABELS } from '@/api/types/enums'

const {
  mockUseIncident, mockCreateMutateAsync, mockUpdateMutateAsync, mockUseRestrictivePractices, mockApiPost,
  mockUseCreateIncident, mockBulkCreateMutateAsync, staffList,
} = vi.hoisted(() => ({
  mockUseIncident: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockUseRestrictivePractices: vi.fn(),
  mockApiPost: vi.fn(),
  mockUseCreateIncident: vi.fn(),
  mockBulkCreateMutateAsync: vi.fn(),
  // 'staff-3' deliberately shares a fullName with 'staff-1' — a same-name-different-id fixture
  // for the INC-03 Reported-By prefill: it must never resolve by name (see the test below).
  // `loading` empties the list, standing in for /staff not having returned yet.
  staffList: {
    loading: false,
    all: [
      { id: 'staff-1', fullName: 'Alex Rivera' },
      { id: 'staff-3', fullName: 'Alex Rivera' },
      { id: 'staff-2', fullName: 'Cora Lane' },
    ],
  },
}))

// Only the API layer is mocked — FormField, Card are the real components, so this exercises the
// actual conditional-reveal wiring (INC-01 trip dropdown, INC-02 specify field) and the real
// wizard shell (useWizard/WizardStepRail/WizardNavFooter/WizardReviewStep).
vi.mock('@/api/hooks', () => ({
  useCreateIncident: mockUseCreateIncident,
  useUpdateIncident: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false, isError: false }),
  useIncident: mockUseIncident,
  useTrips: () => ({ data: [{ id: 'trip-1', tripName: 'Gold Coast Beach Break' }, { id: 'trip-2', tripName: 'Blue Mountains Adventure' }] }),
  useStaff: () => ({ data: staffList.loading ? [] : staffList.all }),
  useParticipants: () => ({ data: [{ id: 'participant-1', firstName: 'Sophie', lastName: 'Brown', fullName: 'Sophie Brown' }] }),
  // INC-04/INC-05/IN-4
  useRestrictivePractices: mockUseRestrictivePractices,
  // "Add to restrictive practice register" from the RP step (AddRestrictivePracticeDialog)
  useBulkCreateRestrictivePractices: () => ({ mutateAsync: mockBulkCreateMutateAsync, isPending: false }),
  useParticipantMedications: () => ({ data: [] }),
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
// (same requirement the retired create-wizard's test suite documents).
function renderCreatePage(initialEntry: string | { pathname: string; state?: unknown } = '/incidents/new') {
  const router = createMemoryRouter(
    [
      { path: '/incidents/new', element: <IncidentCreatePage /> },
      { path: '/incidents/:id/edit', element: <IncidentCreatePage /> },
      { path: '/incidents', element: <div>Incidents list</div> },
      { path: '/portal/shifts/:id', element: <div>Shift page</div> },
    ],
    { initialEntries: [initialEntry] },
  )
  return render(<RouterProvider router={router} />)
}

// ── IN-1/IN-3/IN-4/IN-6 wizard navigation helpers ──────────────────────────────────────────
// The form's fields are now split across wizard steps (Basics / Restrictive Practice
// [conditional] / Incident Details / Compliance [edit-only] / Review), and three of
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
  // A support worker is the reporter already: no picker to fill.
  if (screen.queryByLabelText('Reported By *')) await selectReportedByFirstAlexRivera(user)
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

/** Fills Incident Details' two required fields (description, date/time) and clicks Next twice —
 * once off Incident Details onto the (always-optional, so immediately-passable) Witnesses step,
 * once more off Witnesses — landing on Review (create mode) or Compliance (edit mode). */
async function fillDetailsMinimallyAndNext(user: ReturnType<typeof userEvent.setup>, description = 'Details here') {
  await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), description)
  await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')
  await clickNext(user) // Incident Details -> Witnesses
  await clickNext(user) // Witnesses -> Review (or Compliance)
}

/** IN-5: adds one injury row via BodyDiagram's always-available button list — required before
 * Incident Details' Next succeeds whenever incidentType is 'Injury'. */
async function addMinimalInjury(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Head' }))
  await user.type(screen.getByLabelText(/Injury Description/i), 'Bumped head.')
  await user.click(screen.getByRole('button', { name: 'Add injury' }))
}

/** Reads a Review-step row's value by its `<dt>` label text — the row layout is a fixed
 * `<dt>{label}</dt><dd>{value}</dd>` sibling pair (WizardReviewStep's defaultRenderRow). */
function reviewValueFor(label: string) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
}

/** Who authorised a register entry and when: with both, an active entry reads Authorised (isRpAuthorised). */
const AUTHORISED = { authorisedBy: 'Dr Chen', authorisationDate: '2026-09-01', isAuthorised: true }

beforeEach(() => {
  mockUseIncident.mockReturnValue({ data: undefined })
  mockCreateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockReset()
  mockCreateMutateAsync.mockResolvedValue({ success: true, data: { id: 'new-incident-1' } })
  mockUseCreateIncident.mockReturnValue({ mutateAsync: mockCreateMutateAsync, isPending: false, isError: false, error: null })
  mockUseRestrictivePractices.mockReturnValue({ data: [] })
  mockApiPost.mockReset().mockResolvedValue({ success: true, data: null })
  mockBulkCreateMutateAsync.mockReset()
  staffList.loading = false
  localStorage.clear()
})

// L5-10: the step rail announced itself as "Intake wizard steps" on every wizard.
describe('IncidentCreatePage — the step rail names itself', () => {
  it('is the incident report steps, not the intake', () => {
    renderCreatePage()

    expect(screen.getByRole('navigation', { name: 'Incident report steps' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /intake/i })).not.toBeInTheDocument()
  })
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
    medicationAdministrationId: 'admin-1',
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
    await clickNext(user) // Incident Details -> Witnesses
    await clickNext(user) // Witnesses -> Review
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      incidentType: 'MedicationError',
      severity: 'High',
      involvedParticipantId: 'participant-1',
      reportedByStaffId: 'staff-1',
      medicationAdministrationId: 'admin-1',
    })
  })

  it('shows a compact "Linked to" line naming the medication and outcome', () => {
    renderCreatePage({ pathname: '/incidents/new', state: marPrefill })

    expect(screen.getByText(/linked to: medication administration · insulin · wrong medication given/i)).toBeInTheDocument()
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
    shiftId: 'shift-9',
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
    await clickNext(user) // Incident Details -> Witnesses
    await clickNext(user) // Witnesses -> Review
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(await screen.findByText('Incidents list')).toBeInTheDocument()
    expect(mockApiPost).toHaveBeenCalledTimes(1)
    expect(mockApiPost).toHaveBeenCalledWith('/portal/notes/note-9/acknowledge-flags')
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      shiftId: 'shift-9',
      shiftNoteId: 'note-9',
    })
  })

  it('shows a compact "Linked to" line naming the shift note\'s date', () => {
    renderCreatePage({ pathname: '/incidents/new', state: shiftNotePrefill })

    expect(screen.getByText(/linked to: shift note from mon 17 aug 2026/i)).toBeInTheDocument()
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

    await clickNext(user) // Basics -> Incident Details
    await addMinimalInjury(user)
    await clickNext(user) // Incident Details -> Witnesses
    await clickNext(user) // Witnesses -> Review
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(await screen.findByText('Incidents list')).toBeInTheDocument()
    expect(screen.queryByText(/failed to (create|update) incident report/i)).not.toBeInTheDocument()
  })
})

// IN-8 audit: confirms both producers' fields land correctly across the wizard using the SAME
// builder functions the producers' own consuming reset() calls in IncidentCreatePage rely on
// (incidentPrefill.ts) — a drift in a skeleton builder fails these tests without needing to keep
// a hand-typed expected string in lockstep. Also proves the Review step (reached only via Next
// through every step in between, including the new Witnesses step) lists every prefilled field,
// and that submitting an untouched prefilled wizard produces a request payload with no field
// left in an invalid shape (in particular: witnesses/injuries as empty arrays, never the old
// witnessNames/witnessStatements shape either producer never supplied in the first place).
describe('IncidentCreatePage — IN-8 producer field trace through to Review', () => {
  const marPrefill: MarIncidentPrefillState = {
    source: 'mar-administration',
    outcome: 'Refused',
    participantId: 'participant-1',
    participantName: 'Sophie Brown',
    medicationName: 'Metformin',
    strength: '500mg',
    doseDescription: '1 tablet',
    scheduledAt: '2026-08-05T22:30:00Z',
    administeredAt: null,
    administeredAtTimeZone: 'Australia/Brisbane',
    recordedByName: 'Alex Rivera',
    recordedByUserId: 'staff-1',
    reason: 'Participant declined',
    notes: null,
    tripInstanceId: 'trip-1',
    medicationAdministrationId: 'admin-2',
  }

  const shiftNotePrefill: ShiftNoteIncidentPrefillState = {
    source: 'shift-note',
    shiftNoteId: 'note-42',
    categories: ['Falls'],
    participantId: 'participant-1',
    participantName: 'Sophie Brown',
    noteBody: 'Slipped in the kitchen.',
    serviceDate: '2026-08-20',
    startTime: '08:00:00',
    endTime: '16:00:00',
    endsNextDay: false,
    reportedByUserId: 'staff-1',
    shiftId: 'shift-42',
  }

  it('MAR prefill: every producer-supplied field lands on Basics or Incident Details and appears on Review; an untouched submit is a valid payload', async () => {
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/new', state: marPrefill })

    // Basics-owned fields (IN-8 design: title/incidentType/severity/participant/reporter/serviceType/trip)
    expect((screen.getByPlaceholderText('Brief incident summary') as HTMLInputElement).value)
      .toBe(buildIncidentTitleSkeleton(marPrefill))
    expect(screen.getByLabelText('Involved Participant')).toHaveValue(marPrefill.participantName)
    expect(screen.getByLabelText('Reported By *')).toHaveValue('Alex Rivera')
    expect(screen.getByLabelText('Incident Type *')).toHaveTextContent(INCIDENT_TYPE_LABELS.MedicationError)
    expect(screen.getByLabelText(/^Severity/)).toHaveTextContent(INCIDENT_SEVERITY_LABELS[suggestedIncidentSeverity(marPrefill.outcome)])
    expect(screen.getByLabelText(/Service Type/i)).toHaveTextContent('Trip')
    expect(screen.getByLabelText(/^Trip/)).toHaveValue('Gold Coast Beach Break')

    await clickNext(user) // Basics -> Incident Details

    // Incident Details-owned fields (description/incidentDateTime) — reached one Next later but
    // already populated atomically by the same reset() call that populated Basics (IN-8: no
    // staged/partial prefill).
    expect((screen.getByPlaceholderText('Detailed description of the incident...') as HTMLTextAreaElement).value)
      .toBe(buildIncidentDescriptionSkeleton(marPrefill))
    expect(screen.getByLabelText(/Date & Time/i)).toHaveValue(buildIncidentDateTime(marPrefill))

    await clickNext(user) // Incident Details -> Witnesses (never prefilled by either producer — optional, passes immediately)
    await clickNext(user) // Witnesses -> Review

    expect(reviewValueFor('Title')).toBe(buildIncidentTitleSkeleton(marPrefill))
    expect(reviewValueFor('Description')).toBe(buildIncidentDescriptionSkeleton(marPrefill))
    expect(reviewValueFor('Date & Time')).toBe(buildIncidentDateTime(marPrefill))
    expect(reviewValueFor('Reported By')).toBe('Alex Rivera')
    expect(reviewValueFor('Involved Participant')).toBe('Sophie Brown')
    expect(reviewValueFor('Incident Type')).toBe(INCIDENT_TYPE_LABELS.MedicationError)
    expect(reviewValueFor('Severity')).toBe(INCIDENT_SEVERITY_LABELS[suggestedIncidentSeverity(marPrefill.outcome)])
    expect(reviewValueFor('Trip')).toBe('Gold Coast Beach Break')
    expect(reviewValueFor('Witnesses')).toBe('None recorded')

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      title: buildIncidentTitleSkeleton(marPrefill),
      description: buildIncidentDescriptionSkeleton(marPrefill),
      incidentDateTime: buildIncidentDateTime(marPrefill),
      incidentType: 'MedicationError',
      severity: suggestedIncidentSeverity(marPrefill.outcome),
      involvedParticipantId: 'participant-1',
      reportedByStaffId: 'staff-1',
      serviceType: 'Trip',
      tripInstanceId: 'trip-1',
      witnesses: [],
      injuries: [],
    })
  })

  it('Shift-note prefill: every producer-supplied field lands on Basics or Incident Details and appears on Review; an untouched submit (plus the required injury row) is a valid payload', async () => {
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/new', state: shiftNotePrefill })

    const expectedType = suggestedIncidentTypeForShiftNote(shiftNotePrefill)

    expect((screen.getByPlaceholderText('Brief incident summary') as HTMLInputElement).value)
      .toBe(buildShiftNoteIncidentTitleSkeleton(shiftNotePrefill))
    expect(screen.getByLabelText('Involved Participant')).toHaveValue(shiftNotePrefill.participantName)
    expect(screen.getByLabelText('Reported By *')).toHaveValue('Alex Rivera')
    expect(screen.getByLabelText('Incident Type *')).toHaveTextContent(INCIDENT_TYPE_LABELS[expectedType])
    expect(screen.getByLabelText(/^Severity/)).toHaveTextContent(INCIDENT_SEVERITY_LABELS.Medium)

    await clickNext(user) // Basics -> Incident Details

    expect((screen.getByPlaceholderText('Detailed description of the incident...') as HTMLTextAreaElement).value)
      .toBe(buildShiftNoteIncidentDescriptionSkeleton(shiftNotePrefill))
    expect(screen.getByLabelText(/Date & Time/i)).toHaveValue(buildShiftNoteIncidentDateTime(shiftNotePrefill))

    // 'Falls' -> 'Injury': Incident Details' own Next gate (IN-5) requires at least one injury
    // row before advancing — this producer's prefill alone doesn't satisfy that, by design.
    await addMinimalInjury(user)
    await clickNext(user) // Incident Details -> Witnesses
    await clickNext(user) // Witnesses -> Review

    expect(reviewValueFor('Title')).toBe(buildShiftNoteIncidentTitleSkeleton(shiftNotePrefill))
    expect(reviewValueFor('Description')).toBe(buildShiftNoteIncidentDescriptionSkeleton(shiftNotePrefill))
    expect(reviewValueFor('Date & Time')).toBe(buildShiftNoteIncidentDateTime(shiftNotePrefill))
    expect(reviewValueFor('Reported By')).toBe('Alex Rivera')
    expect(reviewValueFor('Involved Participant')).toBe('Sophie Brown')
    expect(reviewValueFor('Incident Type')).toBe(INCIDENT_TYPE_LABELS[expectedType])
    expect(reviewValueFor('Severity')).toBe(INCIDENT_SEVERITY_LABELS.Medium)
    expect(reviewValueFor('Witnesses')).toBe('None recorded')

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      title: buildShiftNoteIncidentTitleSkeleton(shiftNotePrefill),
      description: buildShiftNoteIncidentDescriptionSkeleton(shiftNotePrefill),
      incidentDateTime: buildShiftNoteIncidentDateTime(shiftNotePrefill),
      incidentType: expectedType,
      severity: 'Medium',
      involvedParticipantId: 'participant-1',
      reportedByStaffId: 'staff-1',
      witnesses: [],
    })
    expect(mockApiPost).toHaveBeenCalledWith('/portal/notes/note-42/acknowledge-flags')
  })
})

// V-D2 follow-up: the wizard's step labels and step-card headings are sentence case, like every other heading (DESIGN.md).
describe('IncidentCreatePage — sentence-case steps', () => {
  it('names the steps in sentence case on the rail', () => {
    renderCreatePage()
    expect(screen.getAllByText('Incident details').length).toBeGreaterThan(0)
    expect(screen.queryByText('Incident Details')).not.toBeInTheDocument()
  })

  it('heads the Incident details step card in sentence case', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await fillBasicsMinimallyAndNext(user)
    expect(screen.getByRole('heading', { name: 'Incident details' })).toBeInTheDocument()
  })
})

describe('IncidentCreatePage — INC-04 RP incident authorisation determination', () => {
  it('does not show the Restrictive Practice Details card for non-RP incident types', () => {
    renderCreatePage()
    expect(screen.queryByText(/Restrictive Practice Details/i)).not.toBeInTheDocument()
  })

  it('shows the RP type picker once Incident Type is Restrictive Practice Use (a new step reached via Next)', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i })

    expect(screen.getByText('Restrictive practice details')).toBeInTheDocument()
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
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: '2026-12-01', isActive: true, ...AUTHORISED },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i, selectParticipant: true })
    await openAndSelect(user, /Restrictive Practice Type/i, /^seclusion/i)

    expect(await screen.findByText(/matches an authorised practice/i)).toBeInTheDocument()
  })

  it('shows the "may be reportable" banner when the involved participant has no matching active practice', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [] })
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i, selectParticipant: true })
    await openAndSelect(user, /Restrictive Practice Type/i, /^seclusion/i)

    expect(await screen.findByText(/not authorised — this may be a reportable incident/i)).toBeInTheDocument()
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
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: '2026-12-01', isActive: true, ...AUTHORISED },
      { id: 'rp-2', type: 'PhysicalRestraint', description: 'Two-person hold.', reviewDate: null, isActive: true, ...AUTHORISED },
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
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: '2026-12-01', isActive: true, ...AUTHORISED },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i, selectParticipant: true })
    await openAndSelect(user, /Restrictive Practice Type/i, /^seclusion/i)
    await user.click(screen.getByRole('radio', { name: /Seclusion room during acute crisis/i }))
    await user.click(screen.getByRole('radio', { name: 'As set out in the plan' }))
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
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: null, isActive: true, ...AUTHORISED },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i, selectParticipant: true })
    await fillUnapprovedRpAndNext(user, /^seclusion/i, 'placeholder, will switch to a linked practice')
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), 'Already typed details')
    await clickBack(user) // Incident Details -> Restrictive Practice
    await user.click(screen.getByRole('radio', { name: /Seclusion room during acute crisis/i }))
    await user.click(screen.getByRole('radio', { name: 'As set out in the plan' }))
    await clickNext(user) // Restrictive Practice -> Incident Details

    expect((screen.getByPlaceholderText('Detailed description of the incident...') as HTMLTextAreaElement).value)
      .toBe('Already typed details')
  })

  it('submits restrictivePracticeId when a practice is linked', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: null, isActive: true, ...AUTHORISED },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i, selectParticipant: true })
    await openAndSelect(user, /Restrictive Practice Type/i, /^seclusion/i)
    await user.click(screen.getByRole('radio', { name: /Seclusion room during acute crisis/i }))
    await user.click(screen.getByRole('radio', { name: 'As set out in the plan' }))
    await clickNext(user) // Restrictive Practice -> Incident Details
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), ' Details here')
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')
    await clickNext(user) // Incident Details -> Witnesses
    await clickNext(user) // Witnesses -> Review

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload).toMatchObject({
      restrictivePracticeType: 'Seclusion',
      restrictivePracticeId: 'rp-1',
      restrictivePracticeUseVaried: false,
    })
    expect(payload.unapprovedRestrictivePracticeDetails).toBeUndefined()
  })

  it('resolves the linked practice to its description on Review, not the placeholder "(linked)"', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: null, isActive: true, ...AUTHORISED },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i, selectParticipant: true })
    await openAndSelect(user, /Restrictive Practice Type/i, /^seclusion/i)
    await user.click(screen.getByRole('radio', { name: /Seclusion room during acute crisis/i }))
    await user.click(screen.getByRole('radio', { name: 'As set out in the plan' }))
    await clickNext(user) // Restrictive Practice -> Incident Details
    await fillDetailsMinimallyAndNext(user)

    expect(reviewValueFor('Involved Participant')).toBe('Sophie Brown')
    expect(reviewValueFor('Linked Practice')).toBe('Seclusion room during acute crisis.')
  })
})

// INC-04: the determination is frozen at creation — editing an existing incident must never
// silently re-run it against today's register, even if the participant/type fields are changed.
// Edit mode's initialVisited: 'all' (same jump-anywhere convention as the retired single-step wizard) means
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
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room, acute crisis.', reviewDate: '2026-12-01', isActive: true, ...AUTHORISED },
    ] })
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/incident-1/edit' })

    await user.click(await screen.findByRole('button', { name: /Restrictive Practice/i }))

    expect(await screen.findByText(/not authorised — this may be a reportable incident/i)).toBeInTheDocument()
    expect(screen.getByText(/determined when this incident was created/i)).toBeInTheDocument()
  })

  it('ticks "This use was not authorised" for a linked incident stored unauthorised, without locking it while the link is unchanged', async () => {
    mockUseIncident.mockReturnValue({ data: existingRpIncident })
    // The entry now reads Not authorised; the incident keeps what it was stored with, so nothing is forced.
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room, acute crisis.', reviewDate: '2026-12-01', isActive: true, authorisedBy: null, authorisationDate: null, isAuthorised: false },
    ] })
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/incident-1/edit' })

    await user.click(await screen.findByRole('button', { name: /Restrictive Practice/i }))

    const box = await screen.findByRole('checkbox', { name: 'This use was not authorised' })
    expect(box).toBeChecked()
    expect(box).toBeEnabled()
  })

  // RP register PR 1 review D2: the varied question is hidden on edit, so nothing on the step may clear its stored answer.
  it('keeps the stored varied answer when the tick is ticked and unticked, so Next still passes', async () => {
    mockUseIncident.mockReturnValue({ data: { ...existingRpIncident, isRestrictivePracticeAuthorised: true, restrictivePracticeUseVaried: false } })
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room, acute crisis.', reviewDate: '2026-12-01', isActive: true, ...AUTHORISED },
    ] })
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/incident-1/edit' })

    await user.click(await screen.findByRole('button', { name: /Restrictive Practice/i }))
    const box = await screen.findByRole('checkbox', { name: 'This use was not authorised' })
    await user.click(box)
    await user.click(box)
    await clickNext(user)

    expect(await screen.findByPlaceholderText('Detailed description of the incident...')).toBeInTheDocument() // moved on: the hidden answer was not wiped
  })

  // Review N1: the banner agrees with the Review row and with what the server stores on save.
  it('shows the lowered state in the edit banner once "This use was not authorised" is ticked', async () => {
    mockUseIncident.mockReturnValue({ data: { ...existingRpIncident, isRestrictivePracticeAuthorised: true } })
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room, acute crisis.', reviewDate: '2026-12-01', isActive: true, ...AUTHORISED },
    ] })
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/incident-1/edit' })

    await user.click(await screen.findByRole('button', { name: /Restrictive Practice/i }))
    expect(await screen.findByText('Authorised at the time this was reported.')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'This use was not authorised' }))

    expect(screen.getByText(/not authorised — this may be a reportable incident/i)).toBeInTheDocument()
    expect(screen.getByText('Saving records this use as not authorised.')).toBeInTheDocument()
    expect(screen.queryByText('Authorised at the time this was reported.')).not.toBeInTheDocument()
  })

  // Review S1: the API leaves a null flag out of the JSON, so "not determined" arrives as a missing key.
  it('shows "no determination on record" when the flag is missing from the payload', async () => {
    const { isRestrictivePracticeAuthorised: _omitted, ...withoutFlag } = existingRpIncident
    void _omitted
    mockUseIncident.mockReturnValue({ data: withoutFlag })
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/incident-1/edit' })

    await user.click(await screen.findByRole('button', { name: /Restrictive Practice/i }))

    expect(await screen.findByText('No authorisation determination on record for this incident.')).toBeInTheDocument()
  })

  it('keeps showing the frozen determination even after changing the RP type in the edit form', async () => {
    mockUseIncident.mockReturnValue({ data: existingRpIncident })
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room, acute crisis.', reviewDate: '2026-12-01', isActive: true, ...AUTHORISED },
    ] })
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/incident-1/edit' })

    await user.click(await screen.findByRole('button', { name: /Restrictive Practice/i }))
    await screen.findByText(/not authorised — this may be a reportable incident/i)
    await openAndSelect(user, /Restrictive Practice Type/i, /^physical restraint/i)

    expect(screen.getByText(/not authorised — this may be a reportable incident/i)).toBeInTheDocument()
  })
})

// I1 (final review): useParticipants() is server-capped at 50 and the mocked lookup here only
// ever carries 'participant-1' (Sophie Brown) — this fixture's involvedParticipantId deliberately
// doesn't match it, standing in for a participant that sorted past the cap. The Review step must
// still show the correct name because IncidentDetailDto.involvedParticipantName already carries it.
describe('IncidentCreatePage — I1 Review prefers the server-resolved participant name over the capped lookup', () => {
  const existingIncidentWithUncachedParticipant = {
    id: 'incident-2', serviceType: 'None', tripInstanceId: null, incidentType: 'PropertyDamage', otherTypeSpecify: null,
    restrictivePracticeType: null, restrictivePracticeId: null, restrictivePracticeDescription: null,
    restrictivePracticeReviewDate: null, unapprovedRestrictivePracticeDetails: null, isRestrictivePracticeAuthorised: null,
    severity: 'Low', status: 'Draft', title: 'Existing incident', incidentDateTime: '2026-08-01T09:00',
    location: null, reportedByStaffId: 'staff-1', description: 'Existing description', reportedByName: 'Alex Rivera',
    involvedParticipantName: 'Jordan Blake', qscReportingStatus: 'NotRequired', isOverdue24h: false, createdAt: '2026-08-01T09:00:00Z',
    participantBookingId: null, involvedParticipantId: 'participant-99', involvedStaffId: null, involvedStaffName: null,
    immediateActionsTaken: null, wereEmergencyServicesCalled: false, emergencyServicesDetails: null,
    witnessNames: null, witnessStatements: null, injuries: [], witnesses: [], qscReportedAt: null, qscReferenceNumber: null,
    reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null,
    resolvedAt: null, familyNotified: false, familyNotifiedAt: null, supportCoordinatorNotified: false,
    supportCoordinatorNotifiedAt: null, updatedAt: '2026-08-01T09:00:00Z',
  }

  it('shows the DTO\'s involvedParticipantName on Review when the participant is not in the (capped) lookup list', async () => {
    mockUseIncident.mockReturnValue({ data: existingIncidentWithUncachedParticipant })
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/incident-2/edit' })

    await user.click(await screen.findByRole('button', { name: /Review$/i }))

    expect(reviewValueFor('Involved Participant')).toBe('Jordan Blake')
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
    await user.click(await screen.findByRole('button', { name: /Compliance/ }))
    expect(screen.queryByText(/Review & compliance/)).not.toBeInTheDocument()

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

// IN-7: the dedicated Witnesses step, replacing the old free-text witnessNames/witnessStatements
// pair — a single witnesses[] list mixing approvable staff rows and free-text external rows.
describe('IncidentCreatePage — IN-7 Witnesses step', () => {
  /** Reaches the Witnesses step (one Next click past Incident Details) without skipping over it
   * the way fillDetailsMinimallyAndNext deliberately does for tests that don't care about it. */
  async function reachWitnessesStep(user: ReturnType<typeof userEvent.setup>, opts: Parameters<typeof fillBasicsMinimallyAndNext>[1] = {}) {
    await fillBasicsMinimallyAndNext(user, opts)
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), 'Details here')
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')
    await clickNext(user) // Incident Details -> Witnesses
  }

  it('renders the Witnesses step with an add-row control and an empty table', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await reachWitnessesStep(user)

    expect(screen.getByRole('heading', { name: 'Witnesses' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
    expect(screen.getByText('No witnesses added yet')).toBeInTheDocument()
  })

  it('excludes the current reporter from the staff witness picker', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    // fillBasicsMinimallyAndNext selects the FIRST 'Alex Rivera' option, which is staff-1.
    await reachWitnessesStep(user)

    await user.click(screen.getByLabelText('Staff member'))
    const options = screen.getAllByRole('option', { name: 'Alex Rivera' })
    expect(options).toHaveLength(1) // only staff-3 remains selectable
  })

  it('adds a staff witness, showing a Staff badge and a not-yet-submitted hint', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await reachWitnessesStep(user)

    await user.click(screen.getByLabelText('Staff member'))
    await user.click(screen.getByRole('option', { name: 'Alex Rivera' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByText('Staff')).toBeInTheDocument()
    expect(screen.getByText(/will be asked to approve after this report is submitted/i)).toBeInTheDocument()
  })

  it('adds an external witness via free text, showing an External badge and no status hint', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await reachWitnessesStep(user)

    await user.click(screen.getByRole('radio', { name: 'Someone else' }))
    await user.type(screen.getByLabelText('Name'), 'Jamie Passerby')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByText('Jamie Passerby')).toBeInTheDocument()
    expect(screen.getByText('External')).toBeInTheDocument()
    expect(screen.queryByText(/will be asked to approve/i)).not.toBeInTheDocument()
  })

  it('moves the witness choice with the arrow keys, as a radiogroup', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await reachWitnessesStep(user)

    const group = screen.getByRole('radiogroup', { name: 'Witness type' })
    expect(within(group).getAllByRole('radio')).toHaveLength(2)
    screen.getByRole('radio', { name: 'Staff member' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Someone else' })).toBeChecked()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('radio', { name: 'Staff member' })).toBeChecked()
  })

  it('removes a witness row', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await reachWitnessesStep(user)

    await user.click(screen.getByRole('radio', { name: 'Someone else' }))
    await user.type(screen.getByLabelText('Name'), 'Jamie Passerby')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('Jamie Passerby')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove witness' }))

    expect(screen.queryByText('Jamie Passerby')).not.toBeInTheDocument()
    expect(screen.getByText('No witnesses added yet')).toBeInTheDocument()
  })

  it('submits with both a staff and an external witness in the payload', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await reachWitnessesStep(user)

    await user.click(screen.getByLabelText('Staff member'))
    await user.click(screen.getByRole('option', { name: 'Alex Rivera' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('radio', { name: 'Someone else' }))
    await user.type(screen.getByLabelText('Name'), 'Jamie Passerby')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await clickNext(user) // Witnesses -> Review
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload.witnesses).toEqual([
      { id: undefined, witnessUserId: 'staff-3', witnessName: 'Alex Rivera' },
      { id: undefined, witnessUserId: null, witnessName: 'Jamie Passerby' },
    ])
  })

  it('submits with an empty witnesses array when none are added (optional, matching today\'s form)', async () => {
    const user = userEvent.setup()
    renderCreatePage()
    await reachWitnessesStep(user)

    await clickNext(user) // Witnesses -> Review
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync.mock.calls[0][0].witnesses).toEqual([])
  })

  // Edit mode: a witness who has already responded must show their live status, and resubmitting
  // the form unmodified must echo their persisted id back so the backend preserves it (rather
  // than resetting to Pending) — see IncidentsController.Update's own regression coverage for the
  // server-side half of this contract.
  describe('edit mode — approval status display and preservation', () => {
    const existingIncidentWithWitnesses = {
      id: 'incident-1', serviceType: 'None', tripInstanceId: null, incidentType: 'PropertyDamage', otherTypeSpecify: null,
      severity: 'Low', status: 'Draft', title: 'Existing incident', incidentDateTime: '2026-08-01T09:00',
      location: null, reportedByStaffId: 'staff-1', description: 'Existing description', reportedByName: 'Alex Rivera',
      involvedParticipantName: null, qscReportingStatus: 'NotRequired', isOverdue24h: false, createdAt: '2026-08-01T09:00:00Z',
      participantBookingId: null, involvedParticipantId: null, involvedStaffId: null, involvedStaffName: null,
      immediateActionsTaken: null, wereEmergencyServicesCalled: false, emergencyServicesDetails: null,
      witnessNames: null, witnessStatements: null, injuries: [],
      witnesses: [
        { id: 'witness-1', witnessUserId: 'staff-3', witnessName: 'Alex Rivera', isStaffWitness: true, witnessStatus: 'Approved', witnessRequestedAt: '2026-08-01T09:00:00Z', witnessRespondedAt: '2026-08-01T10:00:00Z', statementText: 'I saw it.' },
      ],
      qscReportedAt: null, qscReferenceNumber: null,
      reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null,
      resolvedAt: null, familyNotified: false, familyNotifiedAt: null, supportCoordinatorNotified: false,
      supportCoordinatorNotifiedAt: null, updatedAt: '2026-08-01T09:00:00Z',
    }

    it('shows the persisted witness\'s live approval status, not the unsubmitted hint', async () => {
      mockUseIncident.mockReturnValue({ data: existingIncidentWithWitnesses })
      const user = userEvent.setup()
      renderCreatePage({ pathname: '/incidents/incident-1/edit' })

      await user.click(await screen.findByRole('button', { name: /Witnesses$/i }))

      expect(screen.getByText('Approved')).toBeInTheDocument()
      expect(screen.queryByText(/will be asked to approve/i)).not.toBeInTheDocument()
      expect(screen.getByText('I saw it.')).toBeInTheDocument()
    })

    it('echoes the persisted witness id back on an unmodified resubmit, so the server can preserve its Approved status', async () => {
      mockUseIncident.mockReturnValue({ data: existingIncidentWithWitnesses })
      mockUpdateMutateAsync.mockResolvedValue({ success: true, data: { id: 'incident-1' } })
      const user = userEvent.setup()
      renderCreatePage({ pathname: '/incidents/incident-1/edit' })

      await user.click(await screen.findByRole('button', { name: /Review$/i }))
      await user.click(screen.getByRole('button', { name: /^save$/i }))

      expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
      const { data: payload } = mockUpdateMutateAsync.mock.calls[0][0]
      expect(payload.witnesses).toEqual([
        { id: 'witness-1', witnessUserId: 'staff-3', witnessName: 'Alex Rivera' },
      ])
    })

    // UpdateIncident sets the three source links from the body ("assigning null clears the link"), and the router-state hand-offs that carry them exist only on
    // create. An edit used to send them absent, so saving any change to an incident filed from a MAR or a shift note cut it loose from its source.
    it('sends the stored source links back on an edit, so saving does not clear them', async () => {
      mockUseIncident.mockReturnValue({
        data: { ...existingIncidentWithWitnesses, medicationAdministrationId: 'mar-1', shiftId: 'shift-1', shiftNoteId: 'note-1' },
      })
      mockUpdateMutateAsync.mockResolvedValue({ success: true, data: { id: 'incident-1' } })
      const user = userEvent.setup()
      renderCreatePage({ pathname: '/incidents/incident-1/edit' })

      await user.click(await screen.findByRole('button', { name: /Review$/i }))
      await user.click(screen.getByRole('button', { name: /^save$/i }))

      expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
      const { data: payload } = mockUpdateMutateAsync.mock.calls[0][0]
      expect(payload).toMatchObject({ medicationAdministrationId: 'mar-1', shiftId: 'shift-1', shiftNoteId: 'note-1' })
    })

    it('sends no source links for an edit of an incident that has none', async () => {
      mockUseIncident.mockReturnValue({ data: { ...existingIncidentWithWitnesses, medicationAdministrationId: null, shiftId: null, shiftNoteId: null } })
      mockUpdateMutateAsync.mockResolvedValue({ success: true, data: { id: 'incident-1' } })
      const user = userEvent.setup()
      renderCreatePage({ pathname: '/incidents/incident-1/edit' })

      await user.click(await screen.findByRole('button', { name: /Review$/i }))
      await user.click(screen.getByRole('button', { name: /^save$/i }))

      const { data: payload } = mockUpdateMutateAsync.mock.calls[0][0]
      expect(payload.medicationAdministrationId).toBeUndefined()
      expect(payload.shiftId).toBeUndefined()
      expect(payload.shiftNoteId).toBeUndefined()
    })

    // The form never shows the legacy witness text, so an edit must not send it: the server leaves the stored columns alone (IncidentsController.Update).
    it('sends no legacy witness text on an edit, so saving a title change keeps it', async () => {
      mockUseIncident.mockReturnValue({
        data: { ...existingIncidentWithWitnesses, witnessNames: 'Mei Zhang', witnessStatements: 'slip' },
      })
      mockUpdateMutateAsync.mockResolvedValue({ success: true, data: { id: 'incident-1' } })
      const user = userEvent.setup()
      renderCreatePage({ pathname: '/incidents/incident-1/edit' })

      const title = await screen.findByPlaceholderText('Brief incident summary')
      await user.clear(title)
      await user.type(title, 'Edited title')
      await user.click(screen.getByRole('button', { name: /Review$/i }))
      await user.click(screen.getByRole('button', { name: /^save$/i }))

      expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
      const { data: payload } = mockUpdateMutateAsync.mock.calls[0][0]
      expect(payload.title).toBe('Edited title')
      expect(Object.keys(payload).sort()).toEqual([
        'awareAtLocal', 'commissionDetailedReportedAt', 'commissionFinalReportRequested', 'commissionFinalReportedAt', 'correctiveActions', 'description', 'emergencyServicesDetails', 'familyNotified', 'familyNotifiedAt',
        'immediateActionsTaken', 'incidentDateTime', 'incidentType', 'injuries', 'involvedParticipantId',
        'involvedStaffId', 'location', 'medicationAdministrationId', 'otherTypeSpecify', 'participantBookingId',
        'qscReferenceNumber', 'qscReportedAt', 'qscReportingStatus', 'reportableClass', 'reportableClassReason', 'reportedByStaffId', 'restrictivePracticeId',
        'restrictivePracticeType', 'restrictivePracticeUseVaried', 'reviewNotes', 'reviewedByStaffId', 'serviceType', 'severity', 'shiftId',
        'shiftNoteId', 'status', 'supportCoordinatorNotified', 'supportCoordinatorNotifiedAt', 'title',
        'tripInstanceId', 'unapprovedRestrictivePracticeDetails', 'usedWithoutAuthorisation',
        'wereEmergencyServicesCalled', 'witnesses',
      ])
    })
  })
})

// PP-28: a 403 (ReadOnly/SupportWorker reaching the save action, per lib/permissions.ts's
// canWrite/canCreateIncidents doc comments) must read distinctly from a generic validation
// failure, instead of the one hardcoded "check your input" string for every failure.
describe('IncidentCreatePage — save-failure banner', () => {
  it('shows a permission-specific message for a 403 response', async () => {
    mockUseCreateIncident.mockReturnValue({
      mutateAsync: mockCreateMutateAsync,
      isPending: false,
      isError: true,
      error: { response: { status: 403, data: { message: 'Forbidden' } } },
    })
    renderCreatePage()

    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission to file incident reports.")
  })

  it('shows the server\'s specific validation message for a non-403 failure', async () => {
    mockUseCreateIncident.mockReturnValue({
      mutateAsync: mockCreateMutateAsync,
      isPending: false,
      isError: true,
      error: { response: { status: 400, data: { message: 'Incident date cannot be in the future.' } } },
    })
    renderCreatePage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Incident date cannot be in the future.')
  })
})

// The one Back standard (UI survey s.1): the icon BackButton left of the title, named for where it goes.
describe('IncidentCreatePage — Back', () => {
  it('is the icon Back before the title, a real link to /incidents', () => {
    renderCreatePage()

    const back = screen.getByRole('link', { name: /back to incidents/i })
    expect(back).toHaveAttribute('href', '/incidents')
    expect(back).toHaveClass('min-w-[var(--tap-min)]')
    expect(back.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// The page builds the form's starting values from the incident once, when it mounts (it waits for the incident to load). A second effect used to reset the form from
// every later copy of the incident, so a background refetch (window refocus, the 30 s stale time) replaced what the person had typed with the server's values.
describe('IncidentCreatePage — editing', () => {
  const incident = {
    id: 'incident-1', serviceType: 'None', tripInstanceId: null, incidentType: 'Other', otherTypeSpecify: 'Spilled drink', severity: 'Low', status: 'Draft',
    title: 'Existing incident', incidentDateTime: '2026-08-01T09:00', location: null, reportedByStaffId: 'staff-1', description: 'Existing description',
    participantBookingId: null, involvedParticipantId: null, involvedStaffId: null, immediateActionsTaken: null, wereEmergencyServicesCalled: false,
    emergencyServicesDetails: null, injuries: [], witnesses: [], qscReportingStatus: 'NotRequired', qscReportedAt: null, qscReferenceNumber: null,
    reviewedByStaffId: null, reviewNotes: null, correctiveActions: null, familyNotified: false, familyNotifiedAt: null,
    supportCoordinatorNotified: false, supportCoordinatorNotifiedAt: null,
  }

  it('keeps what was typed when the incident is fetched again', async () => {
    const user = userEvent.setup()
    const query = refetchable(incident)
    mockUseIncident.mockImplementation(() => ({ data: query.useValue() }))
    renderCreatePage('/incidents/incident-1/edit')

    const title = screen.getByPlaceholderText('Brief incident summary')
    expect(title).toHaveValue('Existing incident')
    await user.clear(title)
    await user.type(title, 'My own title')

    act(() => query.refetchWith({ ...incident, title: 'Changed on the server' }))

    expect(title).toHaveValue('My own title')
  })
})

// STAFF-7: editing an id the server does not know says so, instead of "Loading incident…" for ever.
describe('IncidentCreatePage — editing an unknown incident', () => {
  it('says it is loading while the incident loads', () => {
    mockUseIncident.mockReturnValue({ data: undefined, isError: false })
    renderCreatePage('/incidents/missing/edit')
    expect(screen.getByRole('status')).toHaveTextContent('Loading incident…')
  })

  it('says the incident was not found on a 404', () => {
    mockUseIncident.mockReturnValue({ data: undefined, isError: true, error: { response: { status: 404 } } })
    renderCreatePage('/incidents/missing/edit')
    expect(screen.getByText('Incident not found')).toBeInTheDocument()
  })

  it('offers a retry when the load failed for another reason', () => {
    mockUseIncident.mockReturnValue({ data: undefined, isError: true, error: { response: { status: 500 } }, refetch: vi.fn() })
    renderCreatePage('/incidents/missing/edit')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

// V2-E: the rail is the horizontal step row at every width. From lg it used to turn into a vertical four-line list about 200px tall in the page flow, above the form.
describe('IncidentCreatePage — the step rail is one row', () => {
  it('never stacks into the vertical list, and still says which step this is', () => {
    renderCreatePage()
    const rail = screen.getByRole('navigation', { name: 'Incident report steps' })
    expect(rail).toHaveTextContent(/Step 1 of \d/)
    expect(rail.querySelector('ol')!.className).not.toMatch(/lg:flex-col/)
  })

  it('offers Cancel on the first step', () => {
    renderCreatePage()
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/incidents')
  })
})

describe('IncidentCreatePage — the current step is marked', () => {
  it('fills the current step on the one-row rail', () => {
    renderCreatePage()
    const current = screen.getByRole('navigation', { name: 'Incident report steps' }).querySelector('[aria-current="step"]')!
    expect(current).toHaveClass('bg-[var(--color-primary)]', 'text-[var(--color-primary-foreground)]')
  })
})

// Owner decision 2026-10-14: each practice shows Authorised or Not authorised by the shared rule; "This use was not authorised" sends the
// incident down the same path as "None of these"; and "None of these" can be added to the register by a coordinator from here.
describe('IncidentCreatePage — restrictive practice authorisation', () => {
  const authorisedEntry = { id: 'rp-a', participantId: 'participant-1', type: 'PhysicalRestraint', description: 'Two-person hold during transfers.', reviewDate: null, isActive: true, ...AUTHORISED }
  const notAuthorisedEntry = { id: 'rp-n', participantId: 'participant-1', type: 'PhysicalRestraint', description: 'Hand-over-hand guidance.', reviewDate: null, isActive: true, authorisedBy: null, authorisationDate: null, isAuthorised: false }

  async function toPhysicalRestraintStep(user: ReturnType<typeof userEvent.setup>) {
    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i, selectParticipant: true })
    await openAndSelect(user, /Restrictive Practice Type/i, /^physical restraint/i)
  }

  function rowFor(name: RegExp) {
    return screen.getByRole('radio', { name }).closest('label') as HTMLElement
  }

  it('badges each practice Authorised or Not authorised by the shared rule', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [authorisedEntry, notAuthorisedEntry] })
    const user = userEvent.setup()
    renderCreatePage()
    await toPhysicalRestraintStep(user)

    expect(within(rowFor(/Two-person hold/)).getByText('Authorised')).toBeInTheDocument()
    expect(within(rowFor(/Hand-over-hand/)).getByText('Not authorised')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /None of these — the practice used is not on this participant's register/ })).toBeInTheDocument()
  })

  it('shows "This use was not authorised" only once a registered practice is chosen: ticked and locked for a Not authorised one, optional for an Authorised one', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [authorisedEntry, notAuthorisedEntry] })
    const user = userEvent.setup()
    renderCreatePage()
    await toPhysicalRestraintStep(user)
    expect(screen.queryByRole('checkbox', { name: 'This use was not authorised' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Hand-over-hand/ }))
    const locked = screen.getByRole('checkbox', { name: 'This use was not authorised' })
    expect(locked).toBeChecked()
    expect(locked).toBeDisabled()
    expect(screen.getByText(/register entry is missing who authorised it or when/i)).toBeInTheDocument()
    expect(screen.getByText(/not authorised — this may be a reportable incident/i)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Two-person hold/ }))
    const optional = screen.getByRole('checkbox', { name: 'This use was not authorised' })
    expect(optional).not.toBeChecked()
    expect(optional).toBeEnabled()
    expect(screen.getByText(/matches an authorised practice/i)).toBeInTheDocument()

    await user.click(optional)
    expect(screen.getByText(/not authorised — this may be a reportable incident/i)).toBeInTheDocument()
  })

  it('requires a description of what was done when the use was not authorised, and submits it with the link kept', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [notAuthorisedEntry] })
    const user = userEvent.setup()
    renderCreatePage()
    await toPhysicalRestraintStep(user)
    await user.click(screen.getByRole('radio', { name: /Hand-over-hand/ }))

    await clickNext(user)
    expect(await screen.findByText('Describe what was actually done.')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Describe what was actually done/), 'Guided his hand away from the stove.')
    await clickNext(user) // Restrictive Practice -> Incident Details
    expect(screen.getByPlaceholderText('Detailed description of the incident...')).toHaveValue('Guided his hand away from the stove.')
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')
    await clickNext(user)
    await clickNext(user)
    expect(reviewValueFor('Authorisation')).toBe('Not authorised')
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload).toMatchObject({
      restrictivePracticeType: 'PhysicalRestraint',
      restrictivePracticeId: 'rp-n',
      usedWithoutAuthorisation: true,
      description: 'Guided his hand away from the stove.',
    })
    expect(payload.unapprovedRestrictivePracticeDetails).toBeUndefined()
  })

  it('sends usedWithoutAuthorisation false for an Authorised practice left unticked', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [authorisedEntry] })
    const user = userEvent.setup()
    renderCreatePage()
    await toPhysicalRestraintStep(user)
    await user.click(screen.getByRole('radio', { name: /Two-person hold/ }))
    await user.click(screen.getByRole('radio', { name: 'As set out in the plan' }))
    await clickNext(user)
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')
    await clickNext(user)
    await clickNext(user)
    expect(reviewValueFor('Authorisation')).toBe('Authorised')
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({ restrictivePracticeId: 'rp-a', usedWithoutAuthorisation: false })
  })

  it('clears the prefilled skeleton when "This use was not authorised" is ticked, and blocks Next until the reporter writes what was done', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [authorisedEntry] })
    const user = userEvent.setup()
    renderCreatePage()
    await toPhysicalRestraintStep(user)
    await user.click(screen.getByRole('radio', { name: /Two-person hold/ })) // prefills the skeleton into the empty description
    await user.click(screen.getByRole('checkbox', { name: 'This use was not authorised' }))

    expect(screen.getByLabelText(/Describe what was actually done/)).toHaveValue('')
    await clickNext(user)
    expect(await screen.findByText('Describe what was actually done.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Describe what was actually done/)).toBeInTheDocument() // still on this step

    await user.type(screen.getByLabelText(/Describe what was actually done/), 'Held him past the agreed two minutes.')
    await clickNext(user)
    expect(screen.getByPlaceholderText('Detailed description of the incident...')).toHaveValue('Held him past the agreed two minutes.')
  })

  // RP register PR 1: a use is judged on the incident's own date. The date is typed after this step, so go forward, type it, and come back.
  async function pickThenSetIncidentDate(user: ReturnType<typeof userEvent.setup>, entryName: RegExp, incidentAt: string, lockedAtPick: boolean) {
    await toPhysicalRestraintStep(user)
    await user.click(screen.getByRole('radio', { name: entryName }))
    if (lockedAtPick) await user.type(screen.getByLabelText(/Describe what was actually done/), 'Held him.')
    else await user.click(screen.getByRole('radio', { name: 'As set out in the plan' }))
    await clickNext(user)
    await user.type(screen.getByLabelText(/Date & Time/i), incidentAt)
    await clickBack(user)
  }

  it('does not lock an entry whose authorisation ended yesterday for an incident dated inside its window, and asks the varied question', async () => {
    const ended = { ...authorisedEntry, id: 'rp-e', description: 'Ended hold.', authorisationDate: '2020-01-01', authorisationEndDate: '2026-10-30', isAuthorised: false }
    mockUseRestrictivePractices.mockReturnValue({ data: [ended] })
    const user = userEvent.setup()
    renderCreatePage()
    await pickThenSetIncidentDate(user, /Ended hold/, '2026-10-29T10:00', true)

    const tick = screen.getByRole('checkbox', { name: 'This use was not authorised' })
    expect(tick).not.toBeChecked()
    expect(tick).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'Varied' })).toBeInTheDocument()
  })

  it('reads a use dated before the authorisation started as not authorised: locked ticked, no varied question', async () => {
    const later = { ...authorisedEntry, id: 'rp-l', description: 'Later hold.', authorisationDate: '2026-11-01', isAuthorised: true }
    mockUseRestrictivePractices.mockReturnValue({ data: [later] })
    const user = userEvent.setup()
    renderCreatePage()
    await pickThenSetIncidentDate(user, /Later hold/, '2026-10-28T10:00', false)

    const tick = screen.getByRole('checkbox', { name: 'This use was not authorised' })
    expect(tick).toBeChecked()
    expect(tick).toBeDisabled()
    expect(screen.queryByRole('radio', { name: 'Varied' })).not.toBeInTheDocument()
  })

  // RP register PR 1: the "varied?" question, asked once per new report of an authorised linked use.
  it('asks whether the use followed the plan only for an authorised linked practice, with no default', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [authorisedEntry, notAuthorisedEntry] })
    const user = userEvent.setup()
    renderCreatePage()
    await toPhysicalRestraintStep(user)
    expect(screen.queryByRole('radio', { name: 'Varied' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Hand-over-hand/ }))
    expect(screen.queryByRole('radio', { name: 'Varied' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Two-person hold/ }))
    expect(screen.getByRole('radio', { name: 'As set out in the plan' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Varied' })).not.toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: 'This use was not authorised' }))
    expect(screen.queryByRole('radio', { name: 'Varied' })).not.toBeInTheDocument()
  })

  it('blocks Next until the question is answered, and asks for the varied description', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [authorisedEntry] })
    const user = userEvent.setup()
    renderCreatePage()
    await toPhysicalRestraintStep(user)
    await user.click(screen.getByRole('radio', { name: /Two-person hold/ }))
    await clickNext(user)
    expect(await screen.findByText('Choose whether this use followed the plan or was varied')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Varied' }))
    expect(screen.getByText('A varied use is flagged as a possible reportable incident for the NDIS Commission.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Describe how the use was varied/)).toHaveValue('')
    await clickNext(user)
    expect(await screen.findByText('Describe how the use was varied.')).toBeInTheDocument()
  })

  it('submits restrictivePracticeUseVaried true with the reporter words', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [authorisedEntry] })
    const user = userEvent.setup()
    renderCreatePage()
    await toPhysicalRestraintStep(user)
    await user.click(screen.getByRole('radio', { name: /Two-person hold/ }))
    await user.click(screen.getByRole('radio', { name: 'Varied' }))
    await user.type(screen.getByLabelText(/Describe how the use was varied/), 'Held for four minutes instead of two.')
    await clickNext(user)
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')
    await clickNext(user)
    await clickNext(user)
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      restrictivePracticeId: 'rp-a', restrictivePracticeUseVaried: true, description: 'Held for four minutes instead of two.',
    })
  })

  it('clears the answer when a different practice is picked', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [authorisedEntry, notAuthorisedEntry] })
    const user = userEvent.setup()
    renderCreatePage()
    await toPhysicalRestraintStep(user)
    await user.click(screen.getByRole('radio', { name: /Two-person hold/ }))
    await user.click(screen.getByRole('radio', { name: 'As set out in the plan' }))
    await user.click(screen.getByRole('radio', { name: /Hand-over-hand/ }))
    await user.click(screen.getByRole('radio', { name: /Two-person hold/ }))

    expect(screen.getByRole('radio', { name: 'As set out in the plan' })).not.toBeChecked()
  })

  it('shows a support worker the question too', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-1', role: 'SupportWorker' }))
    mockUseRestrictivePractices.mockReturnValue({ data: [authorisedEntry] })
    const user = userEvent.setup()
    renderCreatePage()
    await toPhysicalRestraintStep(user)
    await user.click(screen.getByRole('radio', { name: /Two-person hold/ }))

    expect(screen.getByRole('radio', { name: 'Varied' })).toBeInTheDocument()
  })

  // Review N3: a link to another participant's register entry would only fail on submit.
  it('clears the linked practice and "This use was not authorised" when the involved participant changes', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [notAuthorisedEntry] })
    const user = userEvent.setup()
    renderCreatePage()
    await toPhysicalRestraintStep(user)
    await user.click(screen.getByRole('radio', { name: /Hand-over-hand/ }))
    expect(screen.getByRole('checkbox', { name: 'This use was not authorised' })).toBeChecked()

    await clickBack(user)
    await user.click(screen.getByLabelText('Involved Participant'))
    await user.click(screen.getByRole('option', { name: 'None' }))
    await clickNext(user)

    expect(screen.queryByRole('checkbox', { name: 'This use was not authorised' })).not.toBeInTheDocument()
    expect(screen.queryAllByRole('radio').filter((r) => (r as HTMLInputElement).checked)).toEqual([])
  })

  it('offers "Add to restrictive practice register" for "None of these" to a coordinator', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-1', role: 'Coordinator' }))
    const user = userEvent.setup()
    renderCreatePage()
    await toPhysicalRestraintStep(user)
    await user.click(screen.getByRole('radio', { name: /none of these/i }))

    expect(screen.getByRole('button', { name: 'Add to restrictive practice register' })).toBeInTheDocument()
    expect(screen.queryByText('A coordinator will be asked to add this to the register.')).not.toBeInTheDocument()
  })

  it('tells a support worker a coordinator will be asked instead, with no add button', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-1', role: 'SupportWorker' }))
    const user = userEvent.setup()
    renderCreatePage()
    await toPhysicalRestraintStep(user)
    await user.click(screen.getByRole('radio', { name: /none of these/i }))

    expect(screen.queryByRole('button', { name: 'Add to restrictive practice register' })).not.toBeInTheDocument()
    expect(screen.getByText('A coordinator will be asked to add this to the register.')).toBeInTheDocument()
  })

  it('opens the add dialog outside the wizard form, prefilled, and Enter in it never submits the incident', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-1', role: 'Coordinator' }))
    const user = userEvent.setup()
    const { container } = renderCreatePage()
    await toPhysicalRestraintStep(user)
    await user.click(screen.getByRole('radio', { name: /none of these/i }))
    await user.type(screen.getByLabelText(/Describe the restrictive practice that was used/i), 'Held both arms at the kerb.')
    await user.click(screen.getByRole('button', { name: 'Add to restrictive practice register' }))

    const dialog = screen.getByRole('dialog', { name: 'Add to restrictive practice register — Physical restraint' })
    expect(container.querySelector('form')!.contains(dialog)).toBe(false)
    const description = within(dialog).getByLabelText('Description, row 1')
    expect(description).toHaveValue('Held both arms at the kerb.')
    await user.type(description, '{Enter}')
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
    expect(mockBulkCreateMutateAsync).not.toHaveBeenCalled()
  })

  it('after saving, links the new entry, moves the text into the description, and locks "This use was not authorised"', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-1', role: 'Coordinator' }))
    const created = { ...notAuthorisedEntry, id: 'rp-new', description: 'Held both arms at the kerb.', relatedMedicationId: null, relatedMedicationName: null, createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z' }
    mockBulkCreateMutateAsync.mockResolvedValue({ success: true, data: [created] })
    const user = userEvent.setup()
    renderCreatePage()
    await toPhysicalRestraintStep(user)
    await user.click(screen.getByRole('radio', { name: /none of these/i }))
    await user.type(screen.getByLabelText(/Describe the restrictive practice that was used/i), 'Held both arms at the kerb.')
    await user.click(screen.getByRole('button', { name: 'Add to restrictive practice register' }))
    await user.click(screen.getByRole('button', { name: 'Save 1 entry' }))

    expect(mockBulkCreateMutateAsync.mock.calls[0][0].data.items[0]).toMatchObject({ type: 'PhysicalRestraint', authorisedBy: null, authorisationDate: null, isActive: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Held both arms at the kerb/ })).toBeChecked()
    expect(within(rowFor(/Held both arms at the kerb/)).getByText('Not authorised')).toBeInTheDocument()
    const box = screen.getByRole('checkbox', { name: 'This use was not authorised' })
    expect(box).toBeChecked()
    expect(box).toBeDisabled()
    expect(screen.queryByLabelText(/Describe the restrictive practice that was used/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Describe what was actually done/)).toHaveValue('Held both arms at the kerb.')

    await clickNext(user)
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')
    await clickNext(user)
    await clickNext(user)
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))
    const payload = mockCreateMutateAsync.mock.calls[0][0]
    expect(payload).toMatchObject({ restrictivePracticeId: 'rp-new', usedWithoutAuthorisation: true, description: 'Held both arms at the kerb.' })
    expect(payload.unapprovedRestrictivePracticeDetails).toBeUndefined()
  })
})

describe('IncidentCreatePage: the shift prefill from "Anything to report?"', () => {
  const shiftPrefill: ShiftIncidentPrefillState = {
    source: 'shift', shiftId: 'shift-9', participantId: 'participant-1', participantName: 'Sophie Brown',
    serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false, reportedByUserId: 'staff-1',
    returnTo: '/portal/shifts/shift-9',
  }

  it('says where the form came from and fills the shift in', () => {
    renderCreatePage({ pathname: '/incidents/new', state: shiftPrefill })

    expect(screen.getByText(/pre-filled from your shift/i)).toBeInTheDocument()
    expect((screen.getByPlaceholderText('Brief incident summary') as HTMLInputElement).value).toContain('Sophie Brown')
    expect(screen.getByText(/linked to: shift on mon 17 aug 2026/i)).toBeInTheDocument()
  })

  it('files the incident against the shift, then goes back to the shift', async () => {
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/new', state: shiftPrefill })

    await user.type(screen.getByPlaceholderText('Describe the incident type'), 'Fall in the garden')
    await selectReportedByFirstAlexRivera(user)
    await clickNext(user)   // Basics -> Incident Details (description and date are prefilled)
    await clickNext(user)   // -> Witnesses
    await clickNext(user)   // -> Review
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(await screen.findByText('Shift page')).toBeInTheDocument()
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({ shiftId: 'shift-9', involvedParticipantId: 'participant-1' })
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it("dates the incident at the shift's actual start when the shift gives one (review deep N3)", async () => {
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/new', state: { ...shiftPrefill, incidentAt: '2026-08-17T09:05' } })

    await user.type(screen.getByPlaceholderText('Describe the incident type'), 'Fall in the garden')
    await selectReportedByFirstAlexRivera(user)
    await clickNext(user)
    await clickNext(user)
    await clickNext(user)
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    await screen.findByText('Shift page')
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({ incidentDateTime: '2026-08-17T09:05' })
  })
})

// Bunya Support: the server files a support worker's incident under their own name (#462), so the wizard
// shows them as the reporter instead of a picker that a prefill could seed with a colleague.
describe('IncidentCreatePage — a support worker is the reporter', () => {
  const colleagueNote: ShiftNoteIncidentPrefillState = {
    source: 'shift-note', shiftNoteId: 'note-7', categories: ['Falls'], participantId: 'participant-1',
    participantName: 'Sophie Brown', noteBody: 'Slipped.', serviceDate: '2026-08-20', startTime: '08:00:00',
    endTime: '16:00:00', endsNextDay: false, reportedByUserId: 'staff-1', shiftId: 'shift-7',
  }
  const signInAs = (role: string) => localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-2', role, fullName: 'Cora Lane' }))

  it('shows the worker as fixed text, not a picker, and submits their id despite a colleague-authored prefill', async () => {
    signInAs('SupportWorker')
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/new', state: colleagueNote })

    expect(screen.getByLabelText('Reported By')).toHaveValue('Cora Lane')
    expect(screen.getByLabelText('Reported By')).toHaveAttribute('readonly')
    expect(screen.queryByLabelText('Reported By *')).not.toBeInTheDocument()

    await clickNext(user) // Basics -> Incident Details
    await addMinimalInjury(user)
    await clickNext(user) // -> Witnesses
    await clickNext(user) // -> Review
    expect(reviewValueFor('Reported By')).toBe('Cora Lane')
    await user.click(screen.getByRole('button', { name: /submit incident report/i }))
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({ reportedByStaffId: 'staff-2' })
  })

  it('refuses the worker as their own witness: they are not in the staff witness picker', async () => {
    signInAs('SupportWorker')
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/new', state: colleagueNote })
    await clickNext(user)
    await addMinimalInjury(user)
    await clickNext(user) // -> Witnesses

    await user.click(screen.getByLabelText('Staff member'))
    expect(screen.queryByRole('option', { name: 'Cora Lane' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: 'Alex Rivera' })).toHaveLength(2)
  })

  const colleagueMar: MarIncidentPrefillState = {
    source: 'mar-administration', outcome: 'WrongMedication', participantId: 'participant-1', participantName: 'Sophie Brown',
    medicationName: 'Insulin', strength: '18 units', doseDescription: null, scheduledAt: '2026-08-01T00:30:00Z',
    administeredAt: '2026-08-01T01:00:00Z', administeredAtTimeZone: 'Australia/Brisbane', recordedByName: 'Alex Rivera',
    recordedByUserId: 'staff-1', reason: 'Grabbed the wrong blister pack', notes: null, tripInstanceId: null,
    medicationAdministrationId: 'admin-1',
  }
  const colleagueShift: ShiftIncidentPrefillState = {
    source: 'shift', shiftId: 'shift-9', participantId: 'participant-1', participantName: 'Sophie Brown',
    serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false, reportedByUserId: 'staff-1',
    returnTo: '/portal/shifts/shift-9',
  }

  it.each([['MAR', colleagueMar], ['shift', colleagueShift]] as const)(
    'shows the worker, not the colleague, from a %s prefill and submits their id', async (_label, state) => {
      signInAs('SupportWorker')
      const user = userEvent.setup()
      renderCreatePage({ pathname: '/incidents/new', state })

      expect(screen.getByLabelText('Reported By')).toHaveValue('Cora Lane')
      // The MAR prefill picks the incident type; the shift prefill leaves it for the worker to name.
      if (state.source === 'shift') await user.type(screen.getByPlaceholderText('Describe the incident type'), 'Fall in the garden')
      await clickNext(user) // Basics -> Incident Details
      await clickNext(user) // -> Witnesses
      await clickNext(user) // -> Review
      await user.click(screen.getByRole('button', { name: /submit incident report/i }))
      expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({ reportedByStaffId: 'staff-2' })
    })

  it("shows the worker's own name on Basics and Review before /staff has loaded", async () => {
    signInAs('SupportWorker')
    staffList.loading = true
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/new' })

    expect(screen.getByLabelText('Reported By')).toHaveValue('Cora Lane')
    await fillBasicsMinimallyAndNext(user)
    await fillDetailsMinimallyAndNext(user)
    expect(reviewValueFor('Reported By')).toBe('Cora Lane')
  })

  it('leaves a coordinator the picker, seeded with the prefill reporter', () => {
    signInAs('Coordinator')
    renderCreatePage({ pathname: '/incidents/new', state: colleagueNote })

    expect(screen.getByLabelText('Reported By *')).toHaveValue('Alex Rivera')
  })
})

// N1 incident clock: the Compliance step edits the aware time and the reporting deadline; the reason is asked for only when the class leaves its default.
describe('IncidentCreatePage - incident clock on the Compliance step', () => {
  const existing = {
    id: 'incident-1', serviceType: 'None', tripInstanceId: null, incidentType: 'PropertyDamage', otherTypeSpecify: null,
    severity: 'Low', status: 'Draft', title: 'Existing incident', incidentDateTime: '2026-08-01T09:00',
    location: null, reportedByStaffId: 'staff-1', description: 'Existing description', reportedByName: 'Alex Rivera',
    involvedParticipantName: null, qscReportingStatus: 'NotRequired', isOverdue24h: false, createdAt: '2026-08-01T00:00:00Z',
    participantBookingId: null, involvedParticipantId: null, involvedStaffId: null, involvedStaffName: null,
    immediateActionsTaken: null, wereEmergencyServicesCalled: false, emergencyServicesDetails: null,
    witnessNames: null, witnessStatements: null, injuries: [], witnesses: [],
    qscReportedAt: null, qscReferenceNumber: null,
    awareAt: '2026-08-01T00:00:00Z', reportableClass: 'None', reportableClassReason: null, notifyDueAt: null, detailedReportDueAt: null,
    dueCountedWithoutHolidays: false, commissionDetailedReportedAt: null, commissionFinalReportRequested: false, commissionFinalReportedAt: null,
    timeZoneId: 'Australia/Sydney',
    reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null,
    resolvedAt: null, familyNotified: false, familyNotifiedAt: null, supportCoordinatorNotified: false,
    supportCoordinatorNotifiedAt: null, updatedAt: '2026-08-01T09:00:00Z',
  }

  it('sends the aware time in the provider zone and the stored class back on an unchanged save', async () => {
    mockUseIncident.mockReturnValue({ data: existing })
    mockUpdateMutateAsync.mockResolvedValue({ success: true, data: { id: 'incident-1' } })
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/incident-1/edit' })

    await user.click(await screen.findByRole('button', { name: /Review$/i }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    const { data: payload } = mockUpdateMutateAsync.mock.calls[0][0]
    expect(payload).toEqual(expect.objectContaining({
      awareAtLocal: '2026-08-01T10:00', reportableClass: 'None', reportableClassReason: undefined,
      commissionDetailedReportedAt: undefined, commissionFinalReportRequested: false, commissionFinalReportedAt: undefined,
    }))
  })

  it('asks for a reason only once the class is moved off its default, and blocks the save without one', async () => {
    mockUseIncident.mockReturnValue({ data: existing })
    mockUpdateMutateAsync.mockResolvedValue({ success: true, data: { id: 'incident-1' } })
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/incident-1/edit' })

    await user.click(await screen.findByRole('button', { name: /Compliance/ }))
    expect(screen.queryByLabelText(/^Reason for the change/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('5-day report sent')).not.toBeInTheDocument()

    await openAndSelect(user, 'Reporting deadline', 'Within 24 hours')
    expect(screen.getByLabelText(/^Reason for the change/)).toHaveAttribute('aria-required', 'true')
    expect(screen.getByLabelText('5-day report sent')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Review$/i }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /Compliance/ }))
    await user.type(screen.getByLabelText(/^Reason for the change/), 'Family raised it as serious.')
    await user.click(screen.getByRole('button', { name: /Review$/i }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(mockUpdateMutateAsync.mock.calls[0][0].data).toEqual(expect.objectContaining({ reportableClass: 'Within24h', reportableClassReason: 'Family raised it as serious.' }))
  })
})
