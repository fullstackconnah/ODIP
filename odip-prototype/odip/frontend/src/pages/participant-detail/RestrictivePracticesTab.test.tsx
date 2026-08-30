import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RestrictivePracticesTab from './RestrictivePracticesTab'
import type { RestrictivePracticeDto } from '@/api/types/restrictive-practices'
import type { MedicationListDto } from '@/api/types/medications'

const {
  mockUseRestrictivePractices, mockUseParticipantMedications,
  mockCreateMutateAsync, mockUpdateMutateAsync, mockDeleteMutateAsync, mockBulkCreateMutateAsync,
} = vi.hoisted(() => ({
  mockUseRestrictivePractices: vi.fn(() => ({ data: [] as RestrictivePracticeDto[], isLoading: false })),
  mockUseParticipantMedications: vi.fn(() => ({ data: [] as MedicationListDto[], isLoading: false })),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockDeleteMutateAsync: vi.fn(),
  mockBulkCreateMutateAsync: vi.fn(),
}))

// Only the API layer is mocked — Modal, FormField, ConfirmDialog, Dropdown, DataTable, EmptyState
// are the real components, so this exercises the actual add/edit/delete/bulk-add wiring (same
// approach as RoutinesTab.test.tsx).
vi.mock('@/api/hooks', () => ({
  useRestrictivePractices: mockUseRestrictivePractices,
  useParticipantMedications: mockUseParticipantMedications,
  useCreateRestrictivePractice: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateRestrictivePractice: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useDeleteRestrictivePractice: () => ({ mutateAsync: mockDeleteMutateAsync, isPending: false }),
  useBulkCreateRestrictivePractices: () => ({ mutateAsync: mockBulkCreateMutateAsync, isPending: false }),
}))

function makePractice(overrides: Partial<RestrictivePracticeDto> = {}): RestrictivePracticeDto {
  return {
    id: 'rp-1',
    participantId: 'participant-1',
    type: 'Unclassified',
    description: 'Locked doors overnight for safety.',
    authorisedBy: null,
    authorisationDate: null,
    reviewDate: null,
    relatedMedicationId: null,
    relatedMedicationName: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeMedication(overrides: Partial<MedicationListDto> = {}): MedicationListDto {
  return {
    id: 'med-1',
    participantId: 'participant-1',
    participantName: 'Sophie Brown',
    name: 'Risperidone',
    strength: '1mg',
    form: 'Tablet',
    route: 'Oral',
    doseDescription: '1 tablet',
    type: 'Regular',
    timesOfDay: '08:00',
    frequency: 'Daily',
    daysOfWeek: [],
    intervalDays: null,
    anchorDate: null,
    status: 'Active',
    isHighRisk: false,
    isPsychotropic: true,
    isChemicalRestraint: true,
    drugSchedule: 'Schedule4',
    supportLevel: 'Administer',
    packaging: 'OriginalPackaging',
    startDate: '2026-01-01',
    endDate: null,
    nextReviewDue: null,
    complianceFlags: [],
    ...overrides,
  }
}

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

beforeEach(() => {
  mockCreateMutateAsync.mockClear()
  mockUpdateMutateAsync.mockClear()
  mockDeleteMutateAsync.mockClear()
  mockBulkCreateMutateAsync.mockClear()
  mockUseRestrictivePractices.mockReturnValue({ data: [], isLoading: false })
  mockUseParticipantMedications.mockReturnValue({ data: [], isLoading: false })
  setUserRole('Coordinator')
})

afterEach(() => {
  localStorage.clear()
})

describe('RestrictivePracticesTab', () => {
  it('renders an empty state when there are no register entries', () => {
    render(<RestrictivePracticesTab participantId="participant-1" />)
    expect(screen.getByText('No restrictive practices recorded')).toBeInTheDocument()
  })

  it('renders active entries with type badge and description', () => {
    mockUseRestrictivePractices.mockReturnValue({
      data: [makePractice({ type: 'Seclusion', description: 'Seclusion room used during acute crisis periods only.' })],
      isLoading: false,
    })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    expect(screen.getByText('Seclusion')).toBeInTheDocument()
    expect(screen.getByText('Seclusion room used during acute crisis periods only.')).toBeInTheDocument()
  })

  it('shows an overdue review-date pill for a past review date on an active entry', () => {
    mockUseRestrictivePractices.mockReturnValue({
      data: [makePractice({ reviewDate: '2020-01-01' })],
      isLoading: false,
    })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    expect(screen.getByText(/review overdue/i)).toBeInTheDocument()
  })

  it('shows a non-overdue review-due pill for a future review date', () => {
    const future = new Date()
    future.setFullYear(future.getFullYear() + 1)
    mockUseRestrictivePractices.mockReturnValue({
      data: [makePractice({ reviewDate: future.toISOString().split('T')[0] })],
      isLoading: false,
    })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    expect(screen.getByText(/review due/i)).toBeInTheDocument()
    expect(screen.queryByText(/review overdue/i)).not.toBeInTheDocument()
  })

  it('hides Edit/Delete/New entry actions for a ReadOnly user', () => {
    setUserRole('ReadOnly')
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new entry/i })).not.toBeInTheDocument()
  })

  it('hides Edit/Delete/New entry actions for a SupportWorker (narrower than routines/notes)', () => {
    setUserRole('SupportWorker')
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new entry/i })).not.toBeInTheDocument()
  })

  it('does not show a medication picker when Type is not Chemical restraint', async () => {
    const user = userEvent.setup()
    mockUseParticipantMedications.mockReturnValue({ data: [makeMedication()], isLoading: false })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /new entry/i })[0])

    expect(screen.queryByText(/linked medication/i)).not.toBeInTheDocument()
  })

  it('shows a medication picker populated from the participant medications when Type is Chemical restraint', async () => {
    const user = userEvent.setup()
    mockUseParticipantMedications.mockReturnValue({ data: [makeMedication({ name: 'Risperidone', strength: '1mg' })], isLoading: false })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /new entry/i })[0])
    await user.click(screen.getByLabelText('Type'))
    // Each type option now carries a plain-language description alongside its label (jargon-barrier
    // fix), which becomes part of the option's accessible name — match on the label prefix instead
    // of an exact string.
    await user.click(screen.getByRole('option', { name: /^chemical restraint/i }))

    expect(screen.getByText(/linked medication/i)).toBeInTheDocument()
    await user.click(screen.getByLabelText(/linked medication/i))
    expect(screen.getByRole('option', { name: 'Risperidone 1mg' })).toBeInTheDocument()
  })

  it('guides the user to the Medications tab when linking a chemical restraint and the participant has no medications on record', async () => {
    const user = userEvent.setup()
    mockUseParticipantMedications.mockReturnValue({ data: [], isLoading: false })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /new entry/i })[0])
    await user.click(screen.getByLabelText('Type'))
    await user.click(screen.getByRole('option', { name: /^chemical restraint/i }))

    expect(screen.getByText(/no active medications on record/i)).toBeInTheDocument()
  })

  it('creates a new register entry with the entered type and description', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /new entry/i })[0])
    await user.type(screen.getByLabelText(/description/i), 'Environmental restriction — locked doors overnight.')
    await user.click(screen.getByRole('button', { name: /save entry/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockCreateMutateAsync.mock.calls[0]
    expect(call.participantId).toBe('participant-1')
    expect(call.data.description).toBe('Environmental restriction — locked doors overnight.')
    expect(call.data.type).toBe('Unclassified')
    expect(call.data.relatedMedicationId).toBeNull()
  })

  it('requires a description before saving', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /new entry/i })[0])
    await user.click(screen.getByRole('button', { name: /save entry/i }))

    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('Description is required')).toBeInTheDocument()
  })

  it('edits an existing entry, prefilling the form', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({
      data: [makePractice({ description: 'Original description' })],
      isLoading: false,
    })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText(/description/i)).toHaveValue('Original description')

    await user.clear(screen.getByLabelText(/description/i))
    await user.type(screen.getByLabelText(/description/i), 'Updated description')
    await user.click(screen.getByRole('button', { name: /save entry/i }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockUpdateMutateAsync.mock.calls[0]
    expect(call.id).toBe('rp-1')
    expect(call.data.description).toBe('Updated description')
  })

  it('deletes an entry after confirmation', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(mockDeleteMutateAsync).toHaveBeenCalledWith({ id: 'rp-1', participantId: 'participant-1' })
  })

  it('groups inactive entries behind a collapsed toggle', () => {
    mockUseRestrictivePractices.mockReturnValue({
      data: [makePractice({ id: 'active-1', isActive: true }), makePractice({ id: 'inactive-1', isActive: false, description: 'Retired entry' })],
      isLoading: false,
    })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    expect(screen.getByText('Inactive entries (1)')).toBeInTheDocument()
    expect(screen.queryByText('Retired entry')).not.toBeInTheDocument()
  })
})

describe('RestrictivePracticesTab — bulk add (RP-01)', () => {
  async function openBulkRows(user: ReturnType<typeof userEvent.setup>, count: string) {
    await user.click(screen.getByRole('button', { name: /bulk add/i }))
    await user.clear(screen.getByLabelText(/number of entries/i))
    await user.type(screen.getByLabelText(/number of entries/i), count)
    await user.click(screen.getByRole('button', { name: /continue/i }))
  }

  it('hides the Bulk add action for a ReadOnly user', () => {
    setUserRole('ReadOnly')
    render(<RestrictivePracticesTab participantId="participant-1" />)

    expect(screen.queryByRole('button', { name: /bulk add/i })).not.toBeInTheDocument()
  })

  it('opens the bulk-add setup step, offering every type except Chemical restraint', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: /bulk add/i }))
    expect(screen.getByRole('dialog', { name: /bulk add restrictive practices/i })).toBeInTheDocument()

    await user.click(screen.getByLabelText(/restrictive practice type/i))
    expect(screen.getByRole('option', { name: /^seclusion/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^chemical restraint/i })).not.toBeInTheDocument()
  })

  it('rejects an invalid row count before generating rows', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: /bulk add/i }))
    await user.clear(screen.getByLabelText(/number of entries/i))
    await user.type(screen.getByLabelText(/number of entries/i), '0')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByText(/enter a whole number between 1 and 50/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Description, row 1')).not.toBeInTheDocument()
  })

  it('generates an editable table with the requested number of rows, all editable at once', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await openBulkRows(user, '2')

    expect(screen.getByLabelText('Description, row 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Authorised by, row 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Authorisation date, row 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Review date, row 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Description, row 2')).toBeInTheDocument()
    expect(screen.queryByLabelText('Description, row 3')).not.toBeInTheDocument()
  })

  it('adds another row via the Add row control', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await openBulkRows(user, '1')
    await user.click(screen.getByRole('button', { name: /add row/i }))

    expect(screen.getByLabelText('Description, row 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Description, row 2')).toBeInTheDocument()
  })

  it('removes a row via its remove control, but disables removing the last remaining row', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await openBulkRows(user, '2')
    await user.click(screen.getByRole('button', { name: 'Remove row 2' }))

    expect(screen.queryByLabelText('Description, row 2')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove row 1' })).toBeDisabled()
  })

  it('requires a description on every row before saving, surfaced per row', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await openBulkRows(user, '1')
    await user.click(screen.getByRole('button', { name: /save 1 entry/i }))

    expect(mockBulkCreateMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Description is required')
  })

  it('saves every row sharing the picked type in a single bulk request, then closes', async () => {
    const user = userEvent.setup()
    mockBulkCreateMutateAsync.mockResolvedValue({ success: true, data: [] })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await openBulkRows(user, '2')
    await user.type(screen.getByLabelText('Description, row 1'), 'First entry')
    await user.type(screen.getByLabelText('Description, row 2'), 'Second entry')
    await user.click(screen.getByRole('button', { name: /save 2 entries/i }))

    expect(mockBulkCreateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockBulkCreateMutateAsync.mock.calls[0]
    expect(call.participantId).toBe('participant-1')
    expect(call.data.items).toHaveLength(2)
    expect(call.data.items[0]).toMatchObject({ type: 'Seclusion', description: 'First entry' })
    expect(call.data.items[1]).toMatchObject({ type: 'Seclusion', description: 'Second entry' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('surfaces a server row-level error against the right row without closing the modal', async () => {
    const user = userEvent.setup()
    mockBulkCreateMutateAsync.mockRejectedValue({
      response: { data: { errors: ['Row 2: Description is required'] } },
    })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await openBulkRows(user, '2')
    await user.type(screen.getByLabelText('Description, row 1'), 'First entry')
    await user.type(screen.getByLabelText('Description, row 2'), 'Second entry')
    await user.click(screen.getByRole('button', { name: /save 2 entries/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Description is required')
    expect(screen.getByRole('dialog', { name: /bulk add/i })).toBeInTheDocument()
  })

  it('surfaces a whole-request server error as a banner when it is not row-prefixed', async () => {
    const user = userEvent.setup()
    mockBulkCreateMutateAsync.mockRejectedValue({
      response: { data: { errors: ['Participant not found'] } },
    })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await openBulkRows(user, '1')
    await user.type(screen.getByLabelText('Description, row 1'), 'First entry')
    await user.click(screen.getByRole('button', { name: /save 1 entry/i }))

    expect(await screen.findByText('Participant not found')).toBeInTheDocument()
  })

  it('goes back to the setup step via Back', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await openBulkRows(user, '1')
    await user.click(screen.getByRole('button', { name: /back/i }))

    expect(screen.getByRole('dialog', { name: /bulk add restrictive practices/i })).toBeInTheDocument()
  })

  it('leaves the single-entry New entry modal flow unaffected by the bulk-add path', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /new entry/i })[0])
    expect(screen.getByRole('dialog', { name: /new restrictive practice entry/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/number of entries/i)).not.toBeInTheDocument()
  })
})
