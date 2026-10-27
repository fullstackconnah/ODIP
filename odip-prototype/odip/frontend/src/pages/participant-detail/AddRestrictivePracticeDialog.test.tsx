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

// Finish review: in the DataTable phone card the cell shrank to the input's own width, so a prefilled description could not be read.
describe('AddRestrictivePracticeDialog on a phone', () => {
  it('gives the description cell the full row below md', () => {
    render(<AddRestrictivePracticeDialog open participantId="participant-1" defaultType="PhysicalRestraint" defaultDescription="Held both arms at the kerb." onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByLabelText('Description, row 1').closest('td')).toHaveClass('max-md:basis-full')
  })
})

// The register tab's "Add entries" flow: one checkbox on the setup step says whether the batch is authorised. Only then do the authorisation
// columns appear and get required; unticked rows are posted with no authoriser and no date (they read Not authorised).
describe('AddRestrictivePracticeDialog authorised checkbox (register tab)', () => {
  const authorisedBox = () => screen.getByRole('checkbox', { name: /this restrictive practice is authorised/i })

  async function toRows(user: ReturnType<typeof userEvent.setup>, tick: boolean) {
    render(<AddRestrictivePracticeDialog open participantId="participant-1" onClose={vi.fn()} onSaved={vi.fn()} />)
    if (tick) await user.click(authorisedBox())
    await user.click(screen.getByRole('button', { name: 'Continue' }))
  }

  it('starts unticked and shows no authorisation columns, posting nulls for both', async () => {
    const user = userEvent.setup()
    mockBulkCreateMutateAsync.mockResolvedValue({ success: true, data: [] })
    render(<AddRestrictivePracticeDialog open participantId="participant-1" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(authorisedBox()).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.queryByLabelText('Authorised by, row 1')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Authorisation date, row 1')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Description, row 1'), 'Locked door overnight')
    await user.click(screen.getByRole('button', { name: 'Save 1 entry' }))

    expect(mockBulkCreateMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      data: { items: [expect.objectContaining({ description: 'Locked door overnight', authorisedBy: null, authorisationDate: null })] },
    })
  })

  it('ticked: shows the columns and refuses to save a row missing who or when, with no POST', async () => {
    const user = userEvent.setup()
    await toRows(user, true)
    expect(screen.getByLabelText('Authorised by, row 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Authorisation date, row 1')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Description, row 1'), 'Locked door overnight')
    await user.click(screen.getByRole('button', { name: 'Save 1 entry' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Add who authorised it')
    expect(screen.getByRole('alert')).toHaveTextContent('Add the date it was authorised')
    expect(mockBulkCreateMutateAsync).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Authorised by, row 1'), 'Dr Lee')
    await user.click(screen.getByRole('button', { name: 'Save 1 entry' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Add the date it was authorised')
    expect(mockBulkCreateMutateAsync).not.toHaveBeenCalled()
  })

  it('ticked and filled: posts who and when', async () => {
    const user = userEvent.setup()
    mockBulkCreateMutateAsync.mockResolvedValue({ success: true, data: [] })
    await toRows(user, true)
    await user.type(screen.getByLabelText('Description, row 1'), 'Locked door overnight')
    await user.type(screen.getByLabelText('Authorised by, row 1'), ' Dr Lee ')
    await user.type(screen.getByLabelText('Authorisation date, row 1'), '2026-03-01')
    await user.click(screen.getByRole('button', { name: 'Save 1 entry' }))

    expect(mockBulkCreateMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      data: { items: [expect.objectContaining({ authorisedBy: 'Dr Lee', authorisationDate: '2026-03-01' })] },
    })
  })

  it('values typed while ticked are never posted once the batch is unticked', async () => {
    const user = userEvent.setup()
    mockBulkCreateMutateAsync.mockResolvedValue({ success: true, data: [] })
    await toRows(user, true)
    await user.type(screen.getByLabelText('Description, row 1'), 'Locked door overnight')
    await user.type(screen.getByLabelText('Authorised by, row 1'), 'Dr Lee')
    await user.type(screen.getByLabelText('Authorisation date, row 1'), '2026-03-01')

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(authorisedBox())
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Description, row 1'), 'Locked door overnight')
    await user.click(screen.getByRole('button', { name: 'Save 1 entry' }))

    expect(mockBulkCreateMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      data: { items: [expect.objectContaining({ authorisedBy: null, authorisationDate: null })] },
    })
  })

  it('single (incident) mode has no checkbox', () => {
    render(<AddRestrictivePracticeDialog open participantId="participant-1" defaultType="PhysicalRestraint" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})
