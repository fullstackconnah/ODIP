import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordAdministrationModal } from './RecordAdministrationModal'
import type { StaffListDto } from '@/api/types'

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
    role: 'SupportWorker', email: null, mobile: null, region: null, isDriverEligible: false,
    isFirstAidQualified: false, isMedicationCompetent: true, isManualHandlingCompetent: false,
    isOvernightEligible: false, isActive: true, firstAidExpiryDate: null, driverLicenceExpiryDate: null,
    manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null, workerScreeningNumber: null,
    workerScreeningExpiryDate: null, hasExpiredQualifications: false, notes: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockRecordMutateAsync.mockReset()
  mockAmendMutateAsync.mockReset()
  mockUseStaff.mockReturnValue({
    data: [makeStaff(), makeStaff({ id: 'staff-2', firstName: 'Jordan', lastName: 'Lee', fullName: 'Jordan Lee' })],
  })
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
