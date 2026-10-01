import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RecordAdministrationModal } from './RecordAdministrationModal'
import type { StaffListDto, AdministrationDto } from '@/api/types'

const { mockRecordMutateAsync, mockAmendMutateAsync, mockUseStaff, mockUseProviderSettings, mockNavigate, permissionsOverride } = vi.hoisted(() => ({
  mockRecordMutateAsync: vi.fn(),
  mockAmendMutateAsync: vi.fn(),
  mockUseStaff: vi.fn(),
  mockUseProviderSettings: vi.fn(),
  mockNavigate: vi.fn(),
  // INC-03: null means "use the real usePermissions()" (most tests exercise the genuine
  // localStorage-driven role logic) — a single test overrides just canCreateIncidents to cover
  // the "notify your coordinator instead" fallback for a role without incident access.
  permissionsOverride: { canCreateIncidents: null as boolean | null },
}))

vi.mock('@/lib/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/permissions')>()
  return {
    ...actual,
    usePermissions: () => {
      const real = actual.usePermissions()
      return permissionsOverride.canCreateIncidents === null
        ? real
        : { ...real, canCreateIncidents: permissionsOverride.canCreateIncidents }
    },
  }
})

// Only the API layer is mocked — Modal, FormField, ToggleGroup, Dropdown, ConfirmDialog are the
// real components, so this exercises the actual witness-picker requiredness wiring.
vi.mock('@/api/hooks', () => ({
  useRecordAdministration: () => ({ mutateAsync: mockRecordMutateAsync, isPending: false }),
  useAmendAdministration: () => ({ mutateAsync: mockAmendMutateAsync, isPending: false }),
  useStaff: mockUseStaff,
  // MissedMedicationGuidance (MED-01, rendered inside the INC-03 "report as incident?" prompt)
  // reads provider settings for the manager contact and state-aware health advice line.
  useProviderSettings: mockUseProviderSettings,
}))

// The modal navigates (INC-03) rather than persisting anything server-side, so only the
// navigation call itself needs mocking — everything else about react-router stays real.
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

// RecordAdministrationModal calls useNavigate (INC-03), which requires a Router ancestor.
function renderModal(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

function makeStaff(overrides: Partial<StaffListDto> = {}): StaffListDto {
  return {
    id: 'staff-1', firstName: 'Rachel', lastName: 'Thompson', fullName: 'Rachel Thompson',
    username: 'rachel.thompson', role: 'SupportWorker', position: 'SupportWorker',
    email: null, mobile: null, region: null, isDriverEligible: false,
    isFirstAidQualified: false, isMedicationCompetent: true, isManualHandlingCompetent: false,
    isOvernightEligible: false, isActive: true, firstAidExpiryDate: null, driverLicenceExpiryDate: null,
    manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null, workerScreeningNumber: null,
    workerScreeningExpiryDate: null, hasExpiredQualifications: false, notes: null,
    ...overrides,
  }
}

function makeAdministration(overrides: Partial<AdministrationDto> = {}): AdministrationDto {
  return {
    id: 'admin-1', participantMedicationId: 'med-1', participantId: 'participant-1', participantName: 'Sophie Brown',
    medicationName: 'Insulin', doseDescription: '18 units', tripInstanceId: null, scheduledAt: null,
    administeredAt: '2026-08-01T01:00:00Z', administeredAtTimeZone: 'Pacific/Auckland',
    status: 'Administered', doseGiven: '18 units', recordedByName: 'Jordan Lee', recordedByUserId: 'staff-2',
    witnessName: null, witnessStaffId: null, witnessStatus: 'NotRequired', witnessRequestedAt: null,
    witnessRespondedAt: null, reason: null, prnReason: null, prnOutcome: null, prnOutcomeAt: null,
    limitBreachAcknowledged: false, notes: null, createdAt: '2026-08-01T01:00:00Z', recordedWithoutCompetency: false, incidentId: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockRecordMutateAsync.mockReset()
  mockAmendMutateAsync.mockReset()
  mockNavigate.mockReset()
  permissionsOverride.canCreateIncidents = null
  mockUseStaff.mockReturnValue({
    data: [makeStaff(), makeStaff({ id: 'staff-2', firstName: 'Jordan', lastName: 'Lee', fullName: 'Jordan Lee' })],
  })
  mockUseProviderSettings.mockReset()
  mockUseProviderSettings.mockReturnValue({
    data: {
      id: 'provider-1', registrationNumber: '123', abn: '456', organisationName: 'Test Org',
      address: '1 Test St', state: 'VIC', gstRegistered: true, isPaceProvider: false,
      bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null,
      managerName: 'Priya Sharma', managerPhone: '0412 345 007',
    },
  })
  localStorage.clear()
})

const baseProps = {
  open: true,
  onClose: vi.fn(),
  medicationId: 'med-1',
  medicationName: 'Insulin',
  doseDescription: '18 units',
  isPrn: false,
}

describe('RecordAdministrationModal witness picker', () => {
  it('does not require a witness for a non-high-risk medication', async () => {
    // The witness field is always mounted (an AnimatedField collapse, not a conditional render —
    // same pattern as the Reason/PRN-reason fields), so what "not required" means here is that
    // submitting without picking one succeeds rather than being blocked by validation.
    const user = userEvent.setup()
    mockRecordMutateAsync.mockResolvedValue({ success: true, data: {} })
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    await user.click(screen.getByRole('button', { name: /^record dose$/i }))

    expect(mockRecordMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      medicationId: 'med-1',
      data: expect.objectContaining({ witnessStaffId: undefined }),
    }))
  })

  it('shows a staff picker (not a free-text input) for a high-risk medication being newly recorded', () => {
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    expect(screen.getByRole('combobox', { name: /witness/i })).toBeInTheDocument()
    // The legacy free-text witness input must not appear on the create flow.
    expect(screen.queryByRole('textbox', { name: /witness/i })).not.toBeInTheDocument()
  })

  it('blocks submission with a validation error when no witness is selected', async () => {
    const user = userEvent.setup()
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    await user.click(screen.getByRole('button', { name: /^record dose$/i }))

    expect(screen.getByText(/select the staff member who witnessed this dose/i)).toBeInTheDocument()
    expect(mockRecordMutateAsync).not.toHaveBeenCalled()
  })

  it('submits with the selected witnessStaffId once a witness is chosen', async () => {
    const user = userEvent.setup()
    mockRecordMutateAsync.mockResolvedValue({ success: true, data: {} })
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    await user.click(screen.getByRole('combobox', { name: /witness/i }))
    await user.click(await screen.findByRole('option', { name: 'Jordan Lee' }))
    await user.click(screen.getByRole('button', { name: /^record dose$/i }))

    expect(mockRecordMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      medicationId: 'med-1',
      data: expect.objectContaining({ witnessStaffId: 'staff-2' }),
    }))
  })

  // UX-01: witness moved from Dropdown to SearchableSelect — one keyboard-only smoke test
  // (open, arrow to an option, Enter) covering the new combobox interaction model.
  it('selects a witness via keyboard only (ArrowDown + Enter)', async () => {
    const user = userEvent.setup()
    mockRecordMutateAsync.mockResolvedValue({ success: true, data: {} })
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    const witness = screen.getByRole('combobox', { name: /witness/i })
    await user.click(witness)
    await user.keyboard('{ArrowDown}{Enter}')
    await user.click(screen.getByRole('button', { name: /^record dose$/i }))

    expect(mockRecordMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      medicationId: 'med-1',
      data: expect.objectContaining({ witnessStaffId: 'staff-1' }),
    }))
  })

  it('excludes the signed-in user from the witness picker when their own id matches a picker entry', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-1' }))
    const user = userEvent.setup()
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    await user.click(screen.getByRole('combobox', { name: /witness/i }))

    expect(screen.queryByRole('option', { name: 'Rachel Thompson' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Jordan Lee' })).toBeInTheDocument()
  })

  it('leaves the witness picker unchanged when the signed-in user has no resolvable id', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: null }))
    const user = userEvent.setup()
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    await user.click(screen.getByRole('combobox', { name: /witness/i }))

    expect(screen.getByRole('option', { name: 'Rachel Thompson' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Jordan Lee' })).toBeInTheDocument()
  })

  it('tolerates a stale odip_user blob from before this field existed (no `id` key at all) — degrades to no self-exclusion rather than crashing', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    const user = userEvent.setup()
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    await user.click(screen.getByRole('combobox', { name: /witness/i }))

    expect(screen.getByRole('option', { name: 'Rachel Thompson' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Jordan Lee' })).toBeInTheDocument()
  })
})

describe('RecordAdministrationModal AnimatedField tab order', () => {
  // AnimatedField keeps a collapsed field's DOM around for the grid-template-rows collapse
  // animation, but marks its wrapper `inert` while collapsed so keyboard users can't Tab into a
  // field that isn't visible — this asserts that wrapper attribute directly, since jsdom doesn't
  // model inert's actual focus-blocking behaviour.
  it('marks the collapsed witness field inert so it is out of the tab order', () => {
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    const witnessTrigger = screen.getByRole('combobox', { name: /witness/i })
    expect(witnessTrigger.closest('[inert]')).not.toBeNull()
  })

  it('removes inert from the witness field once it becomes visible', () => {
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    const witnessTrigger = screen.getByRole('combobox', { name: /witness/i })
    expect(witnessTrigger.closest('[inert]')).toBeNull()
  })
})

// MED-04: the administering identity is always server-derived (see
// MedicationsController.RecordAdministration) — these cover that the modal only ever *displays*
// it read-only, never asks for it, and that the display reflects who the server will actually
// attribute the record to (including the amend case, where that's the original recorder).
describe('RecordAdministrationModal administered-by display', () => {
  it('shows the signed-in user as who will be recorded, for a new administration', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-1', fullName: 'Rachel Thompson' }))
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    expect(screen.getByText('Administered by')).toBeInTheDocument()
    expect(screen.getByText('Rachel Thompson')).toBeInTheDocument()
  })

  it('degrades to a generic label rather than blank when no signed-in name is resolvable', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-1' }))
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    expect(screen.getByText(/you \(signed in\)/i)).toBeInTheDocument()
  })

  it('shows the original recorder, not the signed-in user, when amending', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-1', fullName: 'Rachel Thompson' }))
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} existingAdministration={makeAdministration({ recordedByName: 'Jordan Lee' })} />)

    expect(screen.getByText('Jordan Lee')).toBeInTheDocument()
    expect(screen.queryByText('Rachel Thompson')).not.toBeInTheDocument()
  })
})

describe('RecordAdministrationModal client-local timestamp', () => {
  it('sends the client local timestamp and its IANA time zone when recording a new administration', async () => {
    const user = userEvent.setup()
    mockRecordMutateAsync.mockResolvedValue({ success: true, data: {} })
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    await user.click(screen.getByRole('button', { name: /^record dose$/i }))

    expect(mockRecordMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        administeredAt: expect.any(String),
        administeredAtTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    }))
    // The sent value round-trips as a valid instant (a fresh capture, not a placeholder string).
    const sent = mockRecordMutateAsync.mock.calls[0][0].data.administeredAt as string
    expect(Number.isNaN(new Date(sent).getTime())).toBe(false)
  })

  it('omits administeredAt/administeredAtTimeZone entirely for a non-Administered status (no-JS-timestamp-shaped fallback path)', async () => {
    const user = userEvent.setup()
    mockRecordMutateAsync.mockResolvedValue({ success: true, data: {} })
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    await user.click(screen.getByRole('radio', { name: /^refused$/i }))
    await user.type(screen.getByLabelText(/^reason/i), 'Participant declined')
    await user.click(screen.getByRole('button', { name: /record refusal/i }))

    expect(mockRecordMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ administeredAt: undefined, administeredAtTimeZone: undefined }),
    }))
  })

  it('reuses the existing administeredAt/timeZone (not "now"/the amending device\'s zone) when amending', async () => {
    const user = userEvent.setup()
    mockAmendMutateAsync.mockResolvedValue({ success: true, data: {} })
    const existing = makeAdministration({ administeredAt: '2026-08-01T01:00:00Z', administeredAtTimeZone: 'Pacific/Auckland' })
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} existingAdministration={existing} />)

    await user.click(screen.getByRole('button', { name: /save amendment/i }))

    expect(mockAmendMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: 'admin-1',
      data: expect.objectContaining({
        administeredAt: '2026-08-01T01:00:00Z',
        administeredAtTimeZone: 'Pacific/Auckland',
      }),
    }))
  })
})

// MED-03: the wrong-medication outcome. It's just another non-Administered status for the
// generic Reason requirement, but additionally requires its own "what was given instead" note.
describe('RecordAdministrationModal MED-03 wrong medication', () => {
  it('offers Wrong medication given as a status option', () => {
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    expect(screen.getByRole('radio', { name: /wrong medication given/i })).toBeInTheDocument()
  })

  it('blocks submission without a note on what was given instead', async () => {
    const user = userEvent.setup()
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    await user.click(screen.getByRole('radio', { name: /wrong medication given/i }))
    await user.type(screen.getByLabelText(/^reason/i), 'Grabbed the wrong blister pack')
    await user.click(screen.getByRole('button', { name: /record wrong medication/i }))

    expect(screen.getByText(/required — what was actually given instead/i)).toBeInTheDocument()
    expect(mockRecordMutateAsync).not.toHaveBeenCalled()
  })

  it('blocks submission without a reason even when the note is filled in', async () => {
    const user = userEvent.setup()
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    await user.click(screen.getByRole('radio', { name: /wrong medication given/i }))
    await user.type(screen.getByLabelText(/what was given instead/i), 'Gave Paracetamol 500mg instead')
    await user.click(screen.getByRole('button', { name: /record wrong medication/i }))

    expect(screen.getByText(/required — what led to the wrong medication being given/i)).toBeInTheDocument()
    expect(mockRecordMutateAsync).not.toHaveBeenCalled()
  })

  it('submits with the reason and note once both are filled in', async () => {
    const user = userEvent.setup()
    mockRecordMutateAsync.mockResolvedValue({ success: true, data: makeAdministration({ status: 'Administered' }) })
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    await user.click(screen.getByRole('radio', { name: /wrong medication given/i }))
    await user.type(screen.getByLabelText(/^reason/i), 'Grabbed the wrong blister pack')
    await user.type(screen.getByLabelText(/what was given instead/i), 'Gave Paracetamol 500mg instead')
    await user.click(screen.getByRole('button', { name: /record wrong medication/i }))

    expect(mockRecordMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      medicationId: 'med-1',
      data: expect.objectContaining({
        status: 'WrongMedication',
        reason: 'Grabbed the wrong blister pack',
        notes: 'Gave Paracetamol 500mg instead',
      }),
    }))
  })
})

// INC-03: recording a trigger outcome (refused/withheld/missed/wrong medication) offers to drop
// into a pre-populated draft incident, without ever filing anything automatically.
describe('RecordAdministrationModal INC-03 drop into draft incident', () => {
  it('keeps the modal open on a "report as incident?" prompt after a trigger outcome saves, instead of closing immediately', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mockRecordMutateAsync.mockResolvedValue({
      success: true,
      data: makeAdministration({ status: 'Refused', reason: 'Participant declined' }),
    })
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} onClose={onClose} />)

    await user.click(screen.getByRole('radio', { name: /^refused$/i }))
    await user.type(screen.getByLabelText(/^reason/i), 'Participant declined')
    await user.click(screen.getByRole('button', { name: /record refusal/i }))

    expect(await screen.findByRole('heading', { name: /report as incident\?/i })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^report as incident$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^not now$/i })).toBeInTheDocument()
  })

  it('closes immediately with no prompt for a plain Administered outcome (not a trigger)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mockRecordMutateAsync.mockResolvedValue({ success: true, data: makeAdministration({ status: 'Administered' }) })
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /^record dose$/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: /report as incident\?/i })).not.toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('"Not now" dismisses the prompt and closes without navigating — the MAR record stays as saved', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mockRecordMutateAsync.mockResolvedValue({ success: true, data: makeAdministration({ status: 'Missed', reason: 'No stock available' }) })
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} onClose={onClose} />)

    await user.click(screen.getByRole('radio', { name: /^missed$/i }))
    await user.type(screen.getByLabelText(/^reason/i), 'No stock available')
    await user.click(screen.getByRole('button', { name: /record missed dose/i }))
    await user.click(await screen.findByRole('button', { name: /^not now$/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('"Report as incident" navigates to the incident form with the MAR record pre-filled as router state', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mockRecordMutateAsync.mockResolvedValue({
      success: true,
      data: makeAdministration({
        status: 'WrongMedication', reason: 'Grabbed the wrong pack', notes: 'Gave Paracetamol 500mg instead',
        participantId: 'participant-9', participantName: 'Sophie Brown', medicationName: 'Insulin',
        scheduledAt: '2026-08-01T00:30:00Z', administeredAt: '2026-08-01T01:00:00Z', administeredAtTimeZone: 'Australia/Sydney',
        recordedByName: 'Jordan Lee', recordedByUserId: 'staff-2',
      }),
    })
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} onClose={onClose} />)

    await user.click(screen.getByRole('radio', { name: /wrong medication given/i }))
    await user.type(screen.getByLabelText(/^reason/i), 'Grabbed the wrong pack')
    await user.type(screen.getByLabelText(/what was given instead/i), 'Gave Paracetamol 500mg instead')
    await user.click(screen.getByRole('button', { name: /record wrong medication/i }))
    await user.click(await screen.findByRole('button', { name: /^report as incident$/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/incidents/new', {
      state: expect.objectContaining({
        source: 'mar-administration',
        outcome: 'WrongMedication',
        participantId: 'participant-9',
        participantName: 'Sophie Brown',
        medicationName: 'Insulin',
        reason: 'Grabbed the wrong pack',
        notes: 'Gave Paracetamol 500mg instead',
        recordedByName: 'Jordan Lee',
        recordedByUserId: 'staff-2',
        // Connection map: keyed by the saved administration's own id (makeAdministration's default).
        medicationAdministrationId: 'admin-1',
      }),
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('omits the wrong-medication note from the prefill for a Refused/Withheld/Missed outcome', async () => {
    const user = userEvent.setup()
    mockRecordMutateAsync.mockResolvedValue({
      success: true,
      data: makeAdministration({ status: 'Refused', reason: 'Participant declined', notes: 'unrelated free-text note' }),
    })
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    await user.click(screen.getByRole('radio', { name: /^refused$/i }))
    await user.type(screen.getByLabelText(/^reason/i), 'Participant declined')
    await user.click(screen.getByRole('button', { name: /record refusal/i }))
    await user.click(await screen.findByRole('button', { name: /^report as incident$/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/incidents/new', {
      state: expect.objectContaining({ outcome: 'Refused', notes: null }),
    })
  })

  // MED-01: the missed-medication guidance is surfaced alongside the same "report as incident?"
  // prompt, threaded through from the pharmacy/packaging props MarTab passes in.
  it('surfaces the missed-medication guidance, using the pharmacy props passed in, alongside the incident prompt', async () => {
    const user = userEvent.setup()
    mockRecordMutateAsync.mockResolvedValue({
      success: true,
      data: makeAdministration({ status: 'Missed', reason: 'No stock available' }),
    })
    renderModal(
      <RecordAdministrationModal
        {...baseProps}
        isHighRisk={false}
        packaging="WebsterPack"
        pharmacyName="Chemist Warehouse"
        pharmacyPhone="03 9123 4567"
      />,
    )

    await user.click(screen.getByRole('radio', { name: /^missed$/i }))
    await user.type(screen.getByLabelText(/^reason/i), 'No stock available')
    await user.click(screen.getByRole('button', { name: /record missed dose/i }))

    expect(await screen.findByText(/what to do now/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /priya sharma.*0412 345 007/i })).toBeInTheDocument()
    expect(screen.getByText(/check the webster pack label/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /call the pharmacy on 03 9123 4567.*chemist warehouse/i })).toBeInTheDocument()
  })

  it('does not surface the missed-medication guidance for a plain Administered outcome', async () => {
    const user = userEvent.setup()
    mockRecordMutateAsync.mockResolvedValue({ success: true, data: makeAdministration({ status: 'Administered' }) })
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    await user.click(screen.getByRole('button', { name: /^record dose$/i }))

    expect(screen.queryByText(/what to do now/i)).not.toBeInTheDocument()
  })

  it('tells a role without incident access to notify their coordinator instead of offering to navigate', async () => {
    permissionsOverride.canCreateIncidents = false
    const user = userEvent.setup()
    const onClose = vi.fn()
    mockRecordMutateAsync.mockResolvedValue({ success: true, data: makeAdministration({ status: 'Refused', reason: 'Participant declined' }) })
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} onClose={onClose} />)

    await user.click(screen.getByRole('radio', { name: /^refused$/i }))
    await user.type(screen.getByLabelText(/^reason/i), 'Participant declined')
    await user.click(screen.getByRole('button', { name: /record refusal/i }))

    expect(await screen.findByText(/let your coordinator know/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^report as incident$/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^got it$/i }))

    expect(mockNavigate).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// PP-31: a backdrop click shouldn't silently discard a typed reason/witness/notes.
describe('RecordAdministrationModal backdrop dismiss', () => {
  function clickBackdrop() {
    // The backdrop is Modal's own outer element, not exposed by any accessible role.
    const dialog = screen.getByRole('dialog')
    return userEvent.setup().click(dialog.parentElement!)
  }

  it('closes on a backdrop click while the form is pristine', async () => {
    const onClose = vi.fn()
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} onClose={onClose} />)

    await clickBackdrop()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on a backdrop click once a field has been edited', async () => {
    const onClose = vi.fn()
    renderModal(<RecordAdministrationModal {...baseProps} isHighRisk={false} onClose={onClose} />)

    await userEvent.setup().type(screen.getByLabelText(/^notes/i), 'Some notes')
    await clickBackdrop()

    expect(onClose).not.toHaveBeenCalled()
  })
})
