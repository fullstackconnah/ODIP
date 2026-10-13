import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddRestrictivePracticeDialog } from './AddRestrictivePracticeDialog'
import type { RestrictivePracticeDto } from '@/api/types/restrictive-practices'

const { mockBulkCreateMutateAsync } = vi.hoisted(() => ({ mockBulkCreateMutateAsync: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useParticipantMedications: () => ({ data: [], isLoading: false }),
  useBulkCreateRestrictivePractices: () => ({ mutateAsync: mockBulkCreateMutateAsync, isPending: false }),
}))

const created: RestrictivePracticeDto = {
  id: 'rp-new', participantId: 'participant-1', type: 'PhysicalRestraint', description: 'Held both arms at the kerb.',
  authorisedBy: null, authorisationDate: null, reviewDate: null, relatedMedicationId: null, relatedMedicationName: null,
  isActive: true, createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z',
}

beforeEach(() => {
  mockBulkCreateMutateAsync.mockReset()
})

// The incident wizard's use of the register tab's "Add entries" dialog: the type is already decided, so it adds exactly one entry of it,
// prefilled, and asks nothing about its authorisation (the entry reads Not authorised until a coordinator records who and when).
describe('AddRestrictivePracticeDialog with a default type (from an incident)', () => {
  it('opens on one row of that type, prefilled, with no authorisation fields and no setup step', () => {
    render(<AddRestrictivePracticeDialog open participantId="participant-1" defaultType="PhysicalRestraint" defaultDescription="Held both arms at the kerb." onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Add to restrictive practice register — Physical restraint' })).toBeInTheDocument()
    expect(screen.getByLabelText('Description, row 1')).toHaveValue('Held both arms at the kerb.')
    expect(screen.queryByLabelText('Authorised by, row 1')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Authorisation date, row 1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add row/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument()
  })

  it('saves one active entry with no authorisation details and hands back what the server created', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    mockBulkCreateMutateAsync.mockResolvedValue({ success: true, data: [created] })
    render(<AddRestrictivePracticeDialog open participantId="participant-1" defaultType="PhysicalRestraint" defaultDescription="Held both arms at the kerb." onClose={vi.fn()} onSaved={onSaved} />)

    await user.click(screen.getByRole('button', { name: 'Save 1 entry' }))

    expect(mockBulkCreateMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      data: { items: [{ type: 'PhysicalRestraint', description: 'Held both arms at the kerb.', authorisedBy: null, authorisationDate: null, reviewDate: null, relatedMedicationId: null, isActive: true }] },
    })
    expect(onSaved).toHaveBeenCalledWith([created])
  })

  it('requires a description before saving', async () => {
    const user = userEvent.setup()
    render(<AddRestrictivePracticeDialog open participantId="participant-1" defaultType="PhysicalRestraint" onClose={vi.fn()} onSaved={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Save 1 entry' }))

    expect(screen.getByText('Description is required')).toBeInTheDocument()
    expect(mockBulkCreateMutateAsync).not.toHaveBeenCalled()
  })

  it('renders nothing while closed', () => {
    render(<AddRestrictivePracticeDialog open={false} participantId="participant-1" defaultType="PhysicalRestraint" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
