import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import IncidentCreatePage from './IncidentCreatePage'
import type { MarIncidentPrefillState } from '@/lib/incidentPrefill'

const {
  mockUseIncident, mockCreateMutateAsync, mockUpdateMutateAsync, mockUseRestrictivePractices,
} = vi.hoisted(() => ({
  mockUseIncident: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockUseRestrictivePractices: vi.fn(),
}))

// Only the API layer is mocked — FormField, Card are the real components, so this exercises the
// actual conditional-reveal wiring (INC-01 trip dropdown, INC-02 specify field).
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
  // INC-04/INC-05
  useRestrictivePractices: mockUseRestrictivePractices,
}))

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

beforeEach(() => {
  mockUseIncident.mockReturnValue({ data: undefined })
  mockCreateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockReset()
  mockCreateMutateAsync.mockResolvedValue({ success: true, data: { id: 'new-incident-1' } })
  mockUseRestrictivePractices.mockReturnValue({ data: [] })
})

describe('IncidentCreatePage — INC-01 service type / trip linkage', () => {
  it('does not show the Trip dropdown until Service Type is set to Trip', async () => {
    renderCreatePage()

    expect(screen.queryByLabelText(/^Trip/)).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText(/Service Type/i), 'Trip')

    expect(screen.getByLabelText(/^Trip/)).toBeInTheDocument()
  })

  it('hides the Trip dropdown again when Service Type changes away from Trip', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.selectOptions(screen.getByLabelText(/Service Type/i), 'Trip')
    expect(screen.getByLabelText(/^Trip/)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/Service Type/i), 'STA')
    expect(screen.queryByLabelText(/^Trip/)).not.toBeInTheDocument()
  })

  it('blocks submit when Service Type is Trip but no trip is selected', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'Slip near pool')
    await user.selectOptions(screen.getByLabelText(/Service Type/i), 'Trip')
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), 'Details here')
    // Reported By is now a SearchableSelect combobox — staff-1 and staff-3 deliberately share
    // the fullName "Alex Rivera" (see the useStaff mock above), so pick the first match, which is
    // staff-1 (item order mirrors the mocked staff array).
    await user.click(screen.getByLabelText('Reported By *'))
    await user.click(screen.getAllByRole('option', { name: 'Alex Rivera' })[0])
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(await screen.findByText(/trip must be selected/i)).toBeInTheDocument()
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
  })

  it('submits with a serviceType/tripInstanceId payload when Trip is selected', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'Slip near pool')
    await user.selectOptions(screen.getByLabelText(/Service Type/i), 'Trip')
    await user.selectOptions(screen.getByLabelText(/^Trip/), 'trip-1')
    // incidentType defaults to 'Other', which requires the specify field too.
    await user.type(screen.getByPlaceholderText('Describe the incident type'), 'Slip and fall')
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), 'Details here')
    // Reported By is now a SearchableSelect combobox — staff-1 and staff-3 deliberately share
    // the fullName "Alex Rivera" (see the useStaff mock above), so pick the first match, which is
    // staff-1 (item order mirrors the mocked staff array).
    await user.click(screen.getByLabelText('Reported By *'))
    await user.click(screen.getAllByRole('option', { name: 'Alex Rivera' })[0])
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')

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

    await user.selectOptions(screen.getByLabelText('Incident Type *'), 'Injury')
    expect(screen.queryByLabelText(/Specify Incident Type/i)).not.toBeInTheDocument()
  })

  it('blocks submit when Incident Type is Other but nothing is specified', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'Something happened')
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), 'Details here')
    // Reported By is now a SearchableSelect combobox — staff-1 and staff-3 deliberately share
    // the fullName "Alex Rivera" (see the useStaff mock above), so pick the first match, which is
    // staff-1 (item order mirrors the mocked staff array).
    await user.click(screen.getByLabelText('Reported By *'))
    await user.click(screen.getAllByRole('option', { name: 'Alex Rivera' })[0])
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(await screen.findByText(/specify the incident type/i)).toBeInTheDocument()
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
  })

  it('submits with otherTypeSpecify once filled in', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'Something happened')
    await user.type(screen.getByPlaceholderText('Describe the incident type'), 'Lost property')
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), 'Details here')
    // Reported By is now a SearchableSelect combobox — staff-1 and staff-3 deliberately share
    // the fullName "Alex Rivera" (see the useStaff mock above), so pick the first match, which is
    // staff-1 (item order mirrors the mocked staff array).
    await user.click(screen.getByLabelText('Reported By *'))
    await user.click(screen.getAllByRole('option', { name: 'Alex Rivera' })[0])
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')

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

  it('shows the pre-fill banner and populates title/description/incident type/severity/participant from the MAR record', () => {
    renderCreatePage({ pathname: '/incidents/new', state: marPrefill })

    expect(screen.getByText(/pre-filled from the medication record/i)).toBeInTheDocument()

    expect((screen.getByPlaceholderText('Brief incident summary') as HTMLInputElement).value)
      .toContain('Insulin')
    expect((screen.getByPlaceholderText('Detailed description of the incident...') as HTMLTextAreaElement).value)
      .toContain('Sophie Brown')
    expect((screen.getByLabelText('Incident Type *') as HTMLSelectElement).value).toBe('MedicationError')
    expect((screen.getByLabelText('Severity *') as HTMLSelectElement).value).toBe('High')
    // Involved Participant is now a SearchableSelect combobox — its displayed value is the
    // resolved item's label (derived from involvedParticipantId), not the raw id.
    expect(screen.getByLabelText('Involved Participant')).toHaveValue('Sophie Brown')
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

    expect((screen.getByLabelText(/Service Type/i) as HTMLSelectElement).value).toBe('Trip')
    expect((screen.getByLabelText(/^Trip/) as HTMLSelectElement).value).toBe('trip-1')
  })

  it('submits the pre-filled values through to the create payload unchanged if the coordinator submits as-is', async () => {
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/new', state: marPrefill })

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
        witnessNames: null, witnessStatements: null, qscReportedAt: null, qscReferenceNumber: null,
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

describe('IncidentCreatePage — INC-04 RP incident authorisation determination', () => {
  it('does not show the Restrictive Practice Details card for non-RP incident types', () => {
    renderCreatePage()
    expect(screen.queryByText('Restrictive Practice Details')).not.toBeInTheDocument()
  })

  it('shows the RP type picker once Incident Type is Restrictive Practice Use', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.selectOptions(screen.getByLabelText('Incident Type *'), 'RestrictivePracticeUse')

    expect(screen.getByText('Restrictive Practice Details')).toBeInTheDocument()
    expect(screen.getByLabelText(/Restrictive Practice Type/i)).toBeInTheDocument()
  })

  it('blocks submit when RP incident type is selected but no RP type is chosen', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'RP incident')
    await user.selectOptions(screen.getByLabelText('Incident Type *'), 'RestrictivePracticeUse')
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), 'Details here')
    // Reported By is now a SearchableSelect combobox — staff-1 and staff-3 deliberately share
    // the fullName "Alex Rivera" (see the useStaff mock above), so pick the first match, which is
    // staff-1 (item order mirrors the mocked staff array).
    await user.click(screen.getByLabelText('Reported By *'))
    await user.click(screen.getAllByRole('option', { name: 'Alex Rivera' })[0])
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(await screen.findByText(/select the restrictive practice type/i)).toBeInTheDocument()
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
  })

  it('shows a neutral banner until both participant and type are chosen', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.selectOptions(screen.getByLabelText('Incident Type *'), 'RestrictivePracticeUse')

    expect(screen.getByText(/select the involved participant and restrictive practice type/i)).toBeInTheDocument()
  })

  it('shows an authorised banner when the involved participant has a matching active practice', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: '2026-12-01', isActive: true },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await user.selectOptions(screen.getByLabelText('Incident Type *'), 'RestrictivePracticeUse')
    await user.click(screen.getByLabelText('Involved Participant'))
    await user.click(screen.getByRole('option', { name: 'Sophie Brown' }))
    await user.click(screen.getByLabelText(/Restrictive Practice Type/i))
    await user.click(screen.getByRole('option', { name: /^seclusion/i }))

    expect(await screen.findByText(/matches an active practice/i)).toBeInTheDocument()
  })

  it('shows the "may be reportable" banner when the involved participant has no matching active practice', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [] })
    const user = userEvent.setup()
    renderCreatePage()

    await user.selectOptions(screen.getByLabelText('Incident Type *'), 'RestrictivePracticeUse')
    await user.click(screen.getByLabelText('Involved Participant'))
    await user.click(screen.getByRole('option', { name: 'Sophie Brown' }))
    await user.click(screen.getByLabelText(/Restrictive Practice Type/i))
    await user.click(screen.getByRole('option', { name: /^seclusion/i }))

    expect(await screen.findByText(/no matching authorised practice — this may be a reportable incident/i)).toBeInTheDocument()
  })

  it('submits restrictivePracticeType in the create payload', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'RP incident')
    await user.selectOptions(screen.getByLabelText('Incident Type *'), 'RestrictivePracticeUse')
    await user.click(screen.getByLabelText(/Restrictive Practice Type/i))
    await user.click(screen.getByRole('option', { name: /^seclusion/i }))
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), 'Details here')
    // Reported By is now a SearchableSelect combobox — staff-1 and staff-3 deliberately share
    // the fullName "Alex Rivera" (see the useStaff mock above), so pick the first match, which is
    // staff-1 (item order mirrors the mocked staff array).
    await user.click(screen.getByLabelText('Reported By *'))
    await user.click(screen.getAllByRole('option', { name: 'Alex Rivera' })[0])
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      incidentType: 'RestrictivePracticeUse',
      restrictivePracticeType: 'Seclusion',
    })
  })
})

describe('IncidentCreatePage — INC-05 link to an authorised practice', () => {
  it("lists the involved participant's active practices of the selected type, not other types", async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: '2026-12-01', isActive: true },
      { id: 'rp-2', type: 'PhysicalRestraint', description: 'Two-person hold.', reviewDate: null, isActive: true },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await user.selectOptions(screen.getByLabelText('Incident Type *'), 'RestrictivePracticeUse')
    await user.click(screen.getByLabelText('Involved Participant'))
    await user.click(screen.getByRole('option', { name: 'Sophie Brown' }))
    await user.click(screen.getByLabelText(/Restrictive Practice Type/i))
    await user.click(screen.getByRole('option', { name: /^seclusion/i }))

    await user.click(screen.getByLabelText(/Link to an authorised practice/i))

    expect(screen.getByRole('option', { name: /Seclusion room during acute crisis/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Two-person hold/i })).not.toBeInTheDocument()
  })

  it('linking a practice prepopulates an empty description', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: '2026-12-01', isActive: true },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await user.selectOptions(screen.getByLabelText('Incident Type *'), 'RestrictivePracticeUse')
    await user.click(screen.getByLabelText('Involved Participant'))
    await user.click(screen.getByRole('option', { name: 'Sophie Brown' }))
    await user.click(screen.getByLabelText(/Restrictive Practice Type/i))
    await user.click(screen.getByRole('option', { name: /^seclusion/i }))
    await user.click(screen.getByLabelText(/Link to an authorised practice/i))
    await user.click(screen.getByRole('option', { name: /Seclusion room during acute crisis/i }))

    expect((screen.getByPlaceholderText('Detailed description of the incident...') as HTMLTextAreaElement).value)
      .toContain('Seclusion room during acute crisis.')
  })

  it('never overwrites an already-typed description when linking a practice', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: null, isActive: true },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await user.selectOptions(screen.getByLabelText('Incident Type *'), 'RestrictivePracticeUse')
    await user.click(screen.getByLabelText('Involved Participant'))
    await user.click(screen.getByRole('option', { name: 'Sophie Brown' }))
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), 'Already typed details')
    await user.click(screen.getByLabelText(/Restrictive Practice Type/i))
    await user.click(screen.getByRole('option', { name: /^seclusion/i }))
    await user.click(screen.getByLabelText(/Link to an authorised practice/i))
    await user.click(screen.getByRole('option', { name: /Seclusion room during acute crisis/i }))

    expect((screen.getByPlaceholderText('Detailed description of the incident...') as HTMLTextAreaElement).value)
      .toBe('Already typed details')
  })

  it('submits restrictivePracticeId when a practice is linked', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: null, isActive: true },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'RP incident')
    await user.selectOptions(screen.getByLabelText('Incident Type *'), 'RestrictivePracticeUse')
    await user.click(screen.getByLabelText('Involved Participant'))
    await user.click(screen.getByRole('option', { name: 'Sophie Brown' }))
    await user.click(screen.getByLabelText(/Restrictive Practice Type/i))
    await user.click(screen.getByRole('option', { name: /^seclusion/i }))
    await user.click(screen.getByLabelText(/Link to an authorised practice/i))
    await user.click(screen.getByRole('option', { name: /Seclusion room during acute crisis/i }))
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), ' Details here')
    // Reported By is now a SearchableSelect combobox — staff-1 and staff-3 deliberately share
    // the fullName "Alex Rivera" (see the useStaff mock above), so pick the first match, which is
    // staff-1 (item order mirrors the mocked staff array).
    await user.click(screen.getByLabelText('Reported By *'))
    await user.click(screen.getAllByRole('option', { name: 'Alex Rivera' })[0])
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      restrictivePracticeType: 'Seclusion',
      restrictivePracticeId: 'rp-1',
    })
  })
})

// INC-04: the determination is frozen at creation — editing an existing incident must never
// silently re-run it against today's register, even if the participant/type fields are changed.
describe('IncidentCreatePage — INC-04 determination frozen on edit', () => {
  const existingRpIncident = {
    id: 'incident-1', serviceType: 'None', tripInstanceId: null, incidentType: 'RestrictivePracticeUse', otherTypeSpecify: null,
    restrictivePracticeType: 'Seclusion', restrictivePracticeId: 'rp-1', restrictivePracticeDescription: 'Seclusion room, acute crisis.',
    restrictivePracticeReviewDate: '2026-12-01', isRestrictivePracticeAuthorised: false,
    severity: 'High', status: 'Draft', title: 'Existing RP incident', incidentDateTime: '2026-08-01T09:00',
    location: null, reportedByStaffId: 'staff-1', description: 'Existing description', reportedByName: 'Alex Rivera',
    involvedParticipantName: 'Sophie Brown', qscReportingStatus: 'Required', isOverdue24h: false, createdAt: '2026-08-01T09:00:00Z',
    participantBookingId: null, involvedParticipantId: 'participant-1', involvedStaffId: null, involvedStaffName: null,
    immediateActionsTaken: null, wereEmergencyServicesCalled: false, emergencyServicesDetails: null,
    witnessNames: null, witnessStatements: null, qscReportedAt: null, qscReferenceNumber: null,
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
    renderCreatePage({ pathname: '/incidents/incident-1/edit' })

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

    await screen.findByText(/no matching authorised practice — this may be a reportable incident/i)
    await user.click(screen.getByLabelText(/Restrictive Practice Type/i))
    await user.click(screen.getByRole('option', { name: /^physical restraint/i }))

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

  it('selects Reviewed By via keyboard only (ArrowDown + Enter) on the edit form', async () => {
    mockUseIncident.mockReturnValue({
      data: {
        id: 'incident-1', serviceType: 'None', tripInstanceId: null, incidentType: 'Injury', otherTypeSpecify: null,
        severity: 'Low', status: 'Draft', title: 'Existing incident', incidentDateTime: '2026-08-01T09:00',
        location: null, reportedByStaffId: 'staff-1', description: 'Existing description', reportedByName: 'Alex Rivera',
        involvedParticipantName: null, qscReportingStatus: 'NotRequired', isOverdue24h: false, createdAt: '2026-08-01T09:00:00Z',
        participantBookingId: null, involvedParticipantId: null, involvedStaffId: null, involvedStaffName: null,
        immediateActionsTaken: null, wereEmergencyServicesCalled: false, emergencyServicesDetails: null,
        witnessNames: null, witnessStatements: null, qscReportedAt: null, qscReferenceNumber: null,
        reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null,
        resolvedAt: null, familyNotified: false, familyNotifiedAt: null, supportCoordinatorNotified: false,
        supportCoordinatorNotifiedAt: null, updatedAt: '2026-08-01T09:00:00Z',
      },
    })
    const user = userEvent.setup()
    renderCreatePage({ pathname: '/incidents/incident-1/edit' })

    const reviewedBy = await screen.findByLabelText('Reviewed By')
    await user.click(reviewedBy)
    // First enabled option is 'Not reviewed' (value '') — one more ArrowDown reaches staff-1.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(reviewedBy).toHaveValue('Alex Rivera')
  })
})
