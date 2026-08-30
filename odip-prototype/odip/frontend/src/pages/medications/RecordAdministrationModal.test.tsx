import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordAdministrationModal } from './RecordAdministrationModal'
import type { StaffListDto, AdministrationDto } from '@/api/types'

const { mockRecordMutateAsync, mockAmendMutateAsync, mockUseStaff } = vi.hoisted(() => ({
  mockRecordMutateAsync: vi.fn(),
  mockAmendMutateAsync: vi.fn(),
  mockUseStaff: vi.fn(),
}))

// Only the API layer is mocked — Modal, FormField, ToggleGroup, Dropdown, ConfirmDialog are the
// real components, so this exercises the actual witness-picker requiredness wiring.
vi.mock('@/api/hooks', () => ({
  useRecordAdministration: () => ({ mutateAsync: mockRecordMutateAsync, isPending: false }),
  useAmendAdministration: () => ({ mutateAsync: mockAmendMutateAsync, isPending: false }),
  useStaff: mockUseStaff,
}))

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
    limitBreachAcknowledged: false, notes: null, createdAt: '2026-08-01T01:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  mockRecordMutateAsync.mockReset()
  mockAmendMutateAsync.mockReset()
  mockUseStaff.mockReturnValue({
    data: [makeStaff(), makeStaff({ id: 'staff-2', firstName: 'Jordan', lastName: 'Lee', fullName: 'Jordan Lee' })],
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
    render(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    await user.click(screen.getByRole('button', { name: /^record dose$/i }))

    expect(mockRecordMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      medicationId: 'med-1',
      data: expect.objectContaining({ witnessStaffId: undefined }),
    }))
  })

  it('shows a staff picker (not a free-text input) for a high-risk medication being newly recorded', () => {
    render(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    expect(screen.getByRole('button', { name: /witness/i })).toBeInTheDocument()
    // The legacy free-text witness input must not appear on the create flow.
    expect(screen.queryByRole('textbox', { name: /witness/i })).not.toBeInTheDocument()
  })

  it('blocks submission with a validation error when no witness is selected', async () => {
    const user = userEvent.setup()
    render(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    await user.click(screen.getByRole('button', { name: /^record dose$/i }))

    expect(screen.getByText(/select the staff member who witnessed this dose/i)).toBeInTheDocument()
    expect(mockRecordMutateAsync).not.toHaveBeenCalled()
  })

  it('submits with the selected witnessStaffId once a witness is chosen', async () => {
    const user = userEvent.setup()
    mockRecordMutateAsync.mockResolvedValue({ success: true, data: {} })
    render(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    await user.click(screen.getByRole('button', { name: /witness/i }))
    await user.click(await screen.findByRole('option', { name: 'Jordan Lee' }))
    await user.click(screen.getByRole('button', { name: /^record dose$/i }))

    expect(mockRecordMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      medicationId: 'med-1',
      data: expect.objectContaining({ witnessStaffId: 'staff-2' }),
    }))
  })

  it('excludes the signed-in user from the witness picker when their own id matches a picker entry', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-1' }))
    const user = userEvent.setup()
    render(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    await user.click(screen.getByRole('button', { name: /witness/i }))

    expect(screen.queryByRole('option', { name: 'Rachel Thompson' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Jordan Lee' })).toBeInTheDocument()
  })

  it('leaves the witness picker unchanged when the signed-in user has no resolvable id', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: null }))
    const user = userEvent.setup()
    render(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    await user.click(screen.getByRole('button', { name: /witness/i }))

    expect(screen.getByRole('option', { name: 'Rachel Thompson' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Jordan Lee' })).toBeInTheDocument()
  })

  it('tolerates a stale odip_user blob from before this field existed (no `id` key at all) — degrades to no self-exclusion rather than crashing', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    const user = userEvent.setup()
    render(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    await user.click(screen.getByRole('button', { name: /witness/i }))

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
    render(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    const witnessTrigger = screen.getByRole('button', { name: /witness/i })
    expect(witnessTrigger.closest('[inert]')).not.toBeNull()
  })

  it('removes inert from the witness field once it becomes visible', () => {
    render(<RecordAdministrationModal {...baseProps} isHighRisk={true} />)

    const witnessTrigger = screen.getByRole('button', { name: /witness/i })
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
    render(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    expect(screen.getByText('Administered by')).toBeInTheDocument()
    expect(screen.getByText('Rachel Thompson')).toBeInTheDocument()
  })

  it('degrades to a generic label rather than blank when no signed-in name is resolvable', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-1' }))
    render(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

    expect(screen.getByText(/you \(signed in\)/i)).toBeInTheDocument()
  })

  it('shows the original recorder, not the signed-in user, when amending', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'staff-1', fullName: 'Rachel Thompson' }))
    render(<RecordAdministrationModal {...baseProps} isHighRisk={false} existingAdministration={makeAdministration({ recordedByName: 'Jordan Lee' })} />)

    expect(screen.getByText('Jordan Lee')).toBeInTheDocument()
    expect(screen.queryByText('Rachel Thompson')).not.toBeInTheDocument()
  })
})

describe('RecordAdministrationModal client-local timestamp', () => {
  it('sends the client local timestamp and its IANA time zone when recording a new administration', async () => {
    const user = userEvent.setup()
    mockRecordMutateAsync.mockResolvedValue({ success: true, data: {} })
    render(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

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
    render(<RecordAdministrationModal {...baseProps} isHighRisk={false} />)

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
    render(<RecordAdministrationModal {...baseProps} isHighRisk={false} existingAdministration={existing} />)

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
