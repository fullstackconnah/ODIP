import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RestrictivePracticesTab from './RestrictivePracticesTab'
import type { RestrictivePracticeDto } from '@/api/types/restrictive-practices'
import type { MedicationListDto } from '@/api/types/medications'

const {
  mockUseRestrictivePractices, mockUseParticipantMedications,
  mockUpdateMutateAsync, mockDeleteMutateAsync, mockBulkCreateMutateAsync,
} = vi.hoisted(() => ({
  mockUseRestrictivePractices: vi.fn(() => ({ data: [] as RestrictivePracticeDto[], isLoading: false })),
  mockUseParticipantMedications: vi.fn(() => ({ data: [] as MedicationListDto[], isLoading: false })),
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
    isAuthorised: false,
    useKind: 'Routine',
    authorisationEndDate: null,
    firstUsedOn: null,
    interimBspDate: null,
    comprehensiveBspDate: null,
    earliestRecordedUseDate: null,
    interimBspDueOn: null,
    comprehensiveBspDueOn: null,
    interimBspState: 'NotStarted',
    comprehensiveBspState: 'NotStarted',
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

  it('paints the type badges and the "Needs classification" chip from tokens, not raw Tailwind palette or hex', () => {
    mockUseRestrictivePractices.mockReturnValue({
      data: [
        makePractice({ id: 'rp-m', type: 'MechanicalRestraint', description: 'Lap belt in the vehicle.' }),
        makePractice({ id: 'rp-p', type: 'PhysicalRestraint', description: 'Guided hold during transfers.' }),
        makePractice({ id: 'rp-e', type: 'EnvironmentalRestraint', description: 'Locked pantry.' }),
        makePractice({ id: 'rp-u', type: 'Unclassified', description: 'Locked doors overnight for safety.' }),
      ],
      isLoading: false,
    })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    // amber-100 / amber-800 are exactly --color-warning-container / --color-on-warning-container.
    const warning = ['bg-[var(--color-warning-container)]', 'text-[var(--color-on-warning-container)]']
    expect(screen.getByText('Mechanical restraint')).toHaveClass(...warning)
    expect(screen.getByText('Physical restraint')).toHaveClass(...warning)
    expect(screen.getByText(/needs classification/i)).toHaveClass(...warning)
    // The hard-coded #0d1c2e text on the info pill is the foreground token now.
    expect(screen.getByText('Environmental restraint')).toHaveClass('bg-[var(--color-secondary-container)]', 'text-[var(--color-foreground)]')
    for (const el of document.querySelectorAll('span')) {
      expect(el.className).not.toMatch(/amber-|#[0-9a-f]{3,6}/i)
    }
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

  it('hides Edit/Delete/Add entries actions for a ReadOnly user', () => {
    setUserRole('ReadOnly')
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add entries/i })).not.toBeInTheDocument()
  })

  it('hides Edit/Delete/Add entries actions for a SupportWorker (narrower than routines/notes)', () => {
    setUserRole('SupportWorker')
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add entries/i })).not.toBeInTheDocument()
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
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(mockDeleteMutateAsync).toHaveBeenCalledWith({ id: 'rp-1', participantId: 'participant-1', expectedUpdatedAt: makePractice().updatedAt })
  })

  it('shows the delete refusal in the list error and refetches the list when someone else changed the entry', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    const message = "Someone else just changed this entry, so it wasn't deleted. Check their change, then delete it again if you still want to."
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false, refetch } as never)
    mockDeleteMutateAsync.mockRejectedValueOnce({ response: { status: 409, data: { success: false, errors: [message] } } })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    // A stale delete is not a failure: it is a warning, not the error tone.
    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('--color-warning-container')
    expect(alert.className).not.toContain('--color-destructive')
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('keeps the error tone when a delete fails for another reason', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false, refetch: vi.fn() } as never)
    mockDeleteMutateAsync.mockRejectedValueOnce({ response: { status: 500, data: { success: false, errors: ['Server exploded.'] } } })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Server exploded.')
    expect(alert.className).toContain('--color-destructive')
    expect(alert.className).not.toContain('--color-warning-container')
  })

  const EXPLANATIONS = ['No authorisation date on file', 'No authoriser on file', 'No authorisation recorded']

  it.each([
    ['active with name and date', { authorisedBy: 'Dr Lee', authorisationDate: '2026-03-01', isAuthorised: true }, 'Authorised', null],
    ['active with a name but no date', { authorisedBy: 'Dr Lee' }, 'Not authorised', 'No authorisation date on file'],
    ['active with a date but no name', { authorisationDate: '2026-03-01' }, 'Not authorised', 'No authoriser on file'],
    ['active with neither', {}, 'Not authorised', 'No authorisation recorded'],
  ])('shows the authorisation badge on the row: %s', (_label, overrides, badge, explanation) => {
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice(overrides)], isLoading: false })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    expect(screen.getByText(badge)).toBeInTheDocument()
    expect(screen.queryByText(badge === 'Authorised' ? 'Not authorised' : 'Authorised')).not.toBeInTheDocument()
    // Only the line that says why, and none at all for an authorised row.
    for (const line of EXPLANATIONS) {
      if (line === explanation) expect(screen.getByText(line)).toBeInTheDocument()
      else expect(screen.queryByText(line)).not.toBeInTheDocument()
    }
  })

  it('says "Not yet in force" for an entry with both fields set whose date is still ahead', () => {
    mockUseRestrictivePractices.mockReturnValue({
      data: [makePractice({ authorisedBy: 'Dr Chen', authorisationDate: '2026-10-31', isAuthorised: false })],
      isLoading: false,
    })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    expect(screen.getByText('Not authorised')).toBeInTheDocument()
    expect(screen.getByText('Not yet in force')).toBeInTheDocument()
    expect(screen.getByText('Authorised 31/10/2026, no end date')).toBeInTheDocument()
    expect(screen.queryByText(/Authorised from/)).toBeNull()
    for (const line of EXPLANATIONS) expect(screen.queryByText(line)).not.toBeInTheDocument()
  })

  it('shows no authorisation badge or explanation on an inactive entry (the Inactive pill carries its state, as in the wizard)', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({
      data: [makePractice({ isActive: false, authorisedBy: 'Dr Lee' })],
      isLoading: false,
    })

    render(<RestrictivePracticesTab participantId="participant-1" />)
    await user.click(screen.getByText('Inactive (1)'))

    expect(screen.getByText('Authorised by Dr Lee')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
    expect(screen.queryByText('Not authorised')).not.toBeInTheDocument()
    expect(screen.queryByText('Authorised')).not.toBeInTheDocument()
    for (const line of EXPLANATIONS) expect(screen.queryByText(line)).not.toBeInTheDocument()
  })

  it('groups inactive entries behind a collapsed toggle', () => {
    mockUseRestrictivePractices.mockReturnValue({
      data: [makePractice({ id: 'active-1', isActive: true }), makePractice({ id: 'inactive-1', isActive: false, description: 'Retired entry' })],
      isLoading: false,
    })

    render(<RestrictivePracticesTab participantId="participant-1" />)

    expect(screen.getByText('Inactive (1)')).toBeInTheDocument()
    expect(screen.queryByText('Retired entry')).not.toBeInTheDocument()
  })
})

// PD-2: the single-entry create form is gone — "Add entries" (the former bulk-add modal) is now
// the only create path, including for a single practice. Its former RP-01 create-path coverage
// (creating an entry, description-required validation, chemical-restraint medication linking on
// create) now lives here, exercised through the modal, plus new coverage for defaulting to one
// row and for Chemical restraint becoming selectable (it used to be excluded from bulk).
describe('RestrictivePracticesTab — Add entries (bulk add, PD-2)', () => {
  async function openBulkRows(user: ReturnType<typeof userEvent.setup>, count: string) {
    await user.click(screen.getAllByRole('button', { name: /add entries/i })[0])
    await user.clear(screen.getByLabelText(/number of entries/i))
    await user.type(screen.getByLabelText(/number of entries/i), count)
    await user.click(screen.getByRole('button', { name: /continue/i }))
  }

  async function selectBulkType(user: ReturnType<typeof userEvent.setup>, optionName: RegExp) {
    await user.click(screen.getByLabelText(/restrictive practice type/i))
    await user.click(screen.getByRole('option', { name: optionName }))
  }

  it('hides the Add entries action for a ReadOnly user', () => {
    setUserRole('ReadOnly')
    render(<RestrictivePracticesTab participantId="participant-1" />)

    expect(screen.queryByRole('button', { name: /add entries/i })).not.toBeInTheDocument()
  })

  it('opens the setup step offering every restrictive practice type, including Chemical restraint', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /add entries/i })[0])
    expect(screen.getByRole('dialog', { name: /add entries/i })).toBeInTheDocument()

    await user.click(screen.getByLabelText(/restrictive practice type/i))
    expect(screen.getByRole('option', { name: /^seclusion/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^chemical restraint/i })).toBeInTheDocument()
  })

  it('defaults to a single empty row so a one-off entry stays as fast as the old single-entry form', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /add entries/i })[0])
    expect(screen.getByLabelText(/number of entries/i)).toHaveValue(1)

    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByLabelText('Description, row 1')).toBeInTheDocument()
    expect(screen.queryByLabelText('Description, row 2')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save 1 entry/i })).toBeInTheDocument()
  })

  it('rejects an invalid row count before generating rows', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /add entries/i })[0])
    await user.clear(screen.getByLabelText(/number of entries/i))
    await user.type(screen.getByLabelText(/number of entries/i), '0')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByText(/enter a whole number between 1 and 50/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Description, row 1')).not.toBeInTheDocument()
  })

  it('generates an editable table with the requested number of rows, all editable at once', async () => {
    const user = userEvent.setup()
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /add entries/i })[0])
    await user.click(screen.getByRole('checkbox', { name: /this restrictive practice is authorised/i }))
    await user.clear(screen.getByLabelText(/number of entries/i))
    await user.type(screen.getByLabelText(/number of entries/i), '2')
    await user.click(screen.getByRole('button', { name: /continue/i }))

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
    expect(screen.getByRole('alert')).toHaveTextContent('Add a description.')
  })

  it('creates a single entry end to end through Add entries (the only create path)', async () => {
    const user = userEvent.setup()
    mockBulkCreateMutateAsync.mockResolvedValue({ success: true, data: [] })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await openBulkRows(user, '1')
    await user.type(screen.getByLabelText('Description, row 1'), 'Environmental restriction — locked doors overnight.')
    await user.click(screen.getByRole('button', { name: /save 1 entry/i }))

    expect(mockBulkCreateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockBulkCreateMutateAsync.mock.calls[0]
    expect(call.participantId).toBe('participant-1')
    expect(call.data.items).toHaveLength(1)
    expect(call.data.items[0]).toMatchObject({
      type: 'Seclusion',
      description: 'Environmental restriction — locked doors overnight.',
      relatedMedicationId: null,
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

  it('does not show a Linked medication column when the batch type is not Chemical restraint', async () => {
    const user = userEvent.setup()
    mockUseParticipantMedications.mockReturnValue({ data: [makeMedication()], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await openBulkRows(user, '1')

    expect(screen.queryByText(/linked medication/i)).not.toBeInTheDocument()
  })

  it('shows a Linked medication column populated from participant medications when Chemical restraint is picked', async () => {
    const user = userEvent.setup()
    mockUseParticipantMedications.mockReturnValue({ data: [makeMedication({ name: 'Risperidone', strength: '1mg' })], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /add entries/i })[0])
    await selectBulkType(user, /^chemical restraint/i)
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByRole('columnheader', { name: 'Linked medication' })).toBeInTheDocument()
    await user.click(screen.getByLabelText('Linked medication, row 1'))
    expect(screen.getByRole('option', { name: 'Risperidone 1mg' })).toBeInTheDocument()
  })

  it('shows the no-active-medications hint when Chemical restraint is picked and the participant has none on record', async () => {
    const user = userEvent.setup()
    mockUseParticipantMedications.mockReturnValue({ data: [], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /add entries/i })[0])
    await selectBulkType(user, /^chemical restraint/i)
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByText(/no active medications on record/i)).toBeInTheDocument()
  })

  it('creates a Chemical restraint entry with a linked medication, matching the old single-entry shape', async () => {
    const user = userEvent.setup()
    mockUseParticipantMedications.mockReturnValue({ data: [makeMedication({ id: 'med-9', name: 'Risperidone', strength: '1mg' })], isLoading: false })
    mockBulkCreateMutateAsync.mockResolvedValue({ success: true, data: [] })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /add entries/i })[0])
    await selectBulkType(user, /^chemical restraint/i)
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await user.type(screen.getByLabelText('Description, row 1'), 'Chemical restraint via Risperidone.')
    await user.click(screen.getByLabelText('Linked medication, row 1'))
    await user.click(screen.getByRole('option', { name: 'Risperidone 1mg' }))
    await user.click(screen.getByRole('button', { name: /save 1 entry/i }))

    expect(mockBulkCreateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockBulkCreateMutateAsync.mock.calls[0]
    expect(call.data.items[0]).toMatchObject({
      type: 'ChemicalRestraint',
      description: 'Chemical restraint via Risperidone.',
      relatedMedicationId: 'med-9',
    })
  })

  it('leaves relatedMedicationId null for a Chemical restraint row with no medication selected', async () => {
    const user = userEvent.setup()
    mockBulkCreateMutateAsync.mockResolvedValue({ success: true, data: [] })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /add entries/i })[0])
    await selectBulkType(user, /^chemical restraint/i)
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await user.type(screen.getByLabelText('Description, row 1'), 'Chemical restraint, unlinked for now.')
    await user.click(screen.getByRole('button', { name: /save 1 entry/i }))

    expect(mockBulkCreateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockBulkCreateMutateAsync.mock.calls[0]
    expect(call.data.items[0].relatedMedicationId).toBeNull()
  })

  // Partial-failure handling: this is deliberately all-or-nothing, matching the backend's
  // single-transaction write. Nothing is saved until every row is valid — a mixed batch never
  // leaves some rows silently created and others dropped — and a row the server rejects is
  // reported against exactly that row, with every other row's already-entered content left
  // intact so the user only has to fix the flagged row and resubmit, not retype the batch.
  it('surfaces a server row-level error against the right row without closing the modal or losing other rows', async () => {
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
    expect(screen.getByRole('dialog', { name: /add entries/i })).toBeInTheDocument()
    // Nothing was silently dropped: the other, valid row's content is still there for the user
    // to just fix row 2 and resubmit.
    expect(screen.getByLabelText('Description, row 1')).toHaveValue('First entry')
    expect(screen.getByLabelText('Description, row 2')).toHaveValue('Second entry')
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

    expect(screen.getByRole('dialog', { name: /add entries/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/number of entries/i)).toBeInTheDocument()
  })
})

describe('RestrictivePracticesTab — long list (T10)', () => {
  it('shows 5 of 23 active rows, then all 23 with focus on the 6th row', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({
      data: Array.from({ length: 23 }, (_, i) => makePractice({ id: `p${i}` })),
      isLoading: false,
    })
    const { container } = render(<RestrictivePracticesTab participantId="participant-1" />)
    expect(container.querySelectorAll('[data-show-row]')).toHaveLength(5)
    await user.click(screen.getByRole('button', { name: 'Show all 23' }))
    const rows = container.querySelectorAll('[data-show-row]')
    expect(rows).toHaveLength(23)
    expect(rows[5]).toHaveFocus()
  })
})

describe('RestrictivePracticesTab — edit form authorised checkbox', () => {
  const box = () => screen.getByRole('checkbox', { name: /this restrictive practice is authorised/i })

  it('opens ticked, with who and when, for an authorised record', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice({ authorisedBy: 'Dr Lee', authorisationDate: '2026-03-01' })], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(box()).toBeChecked()
    expect(screen.getByLabelText(/^authorised by/i)).toHaveValue('Dr Lee')
    expect(screen.getByLabelText(/^authorisation date/i)).toHaveValue('2026-03-01')
  })

  it('opens unticked, with no authorisation fields, for an unauthorised record', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(box()).not.toBeChecked()
    expect(screen.queryByLabelText(/^authorised by/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^authorisation date/i)).not.toBeInTheDocument()
  })

  it('unticking and saving sends null for both', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice({ authorisedBy: 'Dr Lee', authorisationDate: '2026-03-01' })], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(box())
    await user.click(screen.getByRole('button', { name: /save entry/i }))

    const [call] = mockUpdateMutateAsync.mock.calls[0]
    expect(call).toEqual({ id: 'rp-1', data: { type: 'Unclassified', description: 'Locked doors overnight for safety.', reviewDate: null, relatedMedicationId: null, authorisedBy: null, authorisationDate: null, datesIncluded: true, authorisationEndDate: null, useKind: 'Routine', firstUsedOn: null, interimBspDate: null, comprehensiveBspDate: null, isActive: true, requiresReporting: null, expectedUpdatedAt: '2026-01-01T00:00:00Z' } })
  })

  it('ticked with a field emptied shows the field error and does not save', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice({ authorisedBy: 'Dr Lee', authorisationDate: '2026-03-01' })], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByLabelText(/^authorised by/i))
    await user.click(screen.getByRole('button', { name: /save entry/i }))

    expect(screen.getByText('Add who authorised it')).toBeInTheDocument()
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
  })

  it('ticking an unauthorised record then filling both saves them', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(box())
    await user.type(screen.getByLabelText(/^authorised by/i), 'Dr Lee')
    await user.type(screen.getByLabelText(/^authorisation date/i), '2026-03-01')
    await user.click(screen.getByRole('button', { name: /save entry/i }))

    const [call] = mockUpdateMutateAsync.mock.calls[0]
    expect(call).toEqual({ id: 'rp-1', data: { type: 'Unclassified', description: 'Locked doors overnight for safety.', reviewDate: null, relatedMedicationId: null, authorisedBy: 'Dr Lee', authorisationDate: '2026-03-01', datesIncluded: true, authorisationEndDate: null, useKind: 'Routine', firstUsedOn: null, interimBspDate: null, comprehensiveBspDate: null, isActive: true, requiresReporting: null, expectedUpdatedAt: '2026-01-01T00:00:00Z' } })
  })

  it('opens ticked for an inactive record and a description-only edit posts both values unchanged', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice({ isActive: false, authorisedBy: 'Dr Lee', authorisationDate: '2026-03-01' })], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByText('Inactive (1)'))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(box()).toBeChecked()
    await user.type(screen.getByLabelText(/description/i), ' Reviewed.')
    await user.click(screen.getByRole('button', { name: /save entry/i }))

    const [call] = mockUpdateMutateAsync.mock.calls[0]
    expect(call).toEqual({ id: 'rp-1', data: { type: 'Unclassified', description: 'Locked doors overnight for safety. Reviewed.', reviewDate: null, relatedMedicationId: null, authorisedBy: 'Dr Lee', authorisationDate: '2026-03-01', datesIncluded: true, authorisationEndDate: null, useKind: 'Routine', firstUsedOn: null, interimBspDate: null, comprehensiveBspDate: null, isActive: false, requiresReporting: null, expectedUpdatedAt: '2026-01-01T00:00:00Z' } })
  })

  it('opens ticked for a date-only record, shows the date, and blocks the save asking who', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice({ authorisationDate: '2026-03-01' })], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(box()).toBeChecked()
    expect(screen.getByLabelText(/^authorisation date/i)).toHaveValue('2026-03-01')
    await user.click(screen.getByRole('button', { name: /save entry/i }))

    expect(screen.getByText('Add who authorised it')).toBeInTheDocument()
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
  })

  it('opens ticked for a name-only record, shows the name, and blocks the save asking for the date', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice({ authorisedBy: 'Dr Lee' })], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(box()).toBeChecked()
    expect(screen.getByLabelText(/^authorised by/i)).toHaveValue('Dr Lee')
    await user.click(screen.getByRole('button', { name: /save entry/i }))

    expect(screen.getByText('Add the date it was authorised')).toBeInTheDocument()
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
  })

  it('keeps the form as typed, ticked, when the server rejects the save', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false })
    mockUpdateMutateAsync.mockRejectedValueOnce({ response: { data: { errors: ['Authorised by is too long'] } } })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(box())
    await user.type(screen.getByLabelText(/^authorised by/i), 'Dr Lee')
    await user.type(screen.getByLabelText(/^authorisation date/i), '2026-03-01')
    await user.click(screen.getByRole('button', { name: /save entry/i }))

    expect(await screen.findByText('Authorised by is too long')).toBeInTheDocument()
    expect(box()).toBeChecked()
    expect(screen.getByLabelText(/^authorised by/i)).toHaveValue('Dr Lee')
    expect(screen.getByLabelText(/^authorisation date/i)).toHaveValue('2026-03-01')
  })

  it('sends the version the entry was opened with', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByLabelText(/description/i), ' More.')
    await user.click(screen.getByRole('button', { name: /save entry/i }))

    expect(mockUpdateMutateAsync.mock.calls[0][0].data.expectedUpdatedAt).toBe('2026-01-01T00:00:00Z')
  })

  it('keeps sending the opened version when the list refetches behind the open form', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false })
    const { rerender } = render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice({ updatedAt: '2026-02-02T00:00:00Z' })], isLoading: false })
    rerender(<RestrictivePracticesTab participantId="participant-1" />)
    await user.type(screen.getByLabelText(/description/i), ' More.')
    await user.click(screen.getByRole('button', { name: /save entry/i }))

    expect(mockUpdateMutateAsync.mock.calls[0][0].data.expectedUpdatedAt).toBe('2026-01-01T00:00:00Z')
  })

  it('shows the conflict sentence, keeps the form as typed and refetches the list when someone else changed the entry', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false, refetch } as never)
    mockUpdateMutateAsync.mockRejectedValueOnce({
      response: { status: 409, data: { success: false, errors: ['Someone else just changed this entry, so your changes weren\'t saved. Close it and open it again to see theirs.'] } },
    })
    render(<RestrictivePracticesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByLabelText(/description/i), ' My change.')
    await user.click(screen.getByRole('button', { name: /save entry/i }))

    expect(await screen.findByText('Someone else just changed this entry, so your changes weren\'t saved. Close it and open it again to see theirs.')).toBeInTheDocument()
    expect(screen.getByLabelText(/description/i)).toHaveValue('Locked doors overnight for safety. My change.')
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /save entry/i })).toBeInTheDocument()
  })

  describe('a refused save is seen', () => {
    const conflict = { response: { status: 409, data: { success: false, errors: ['Someone else just changed this entry, so your changes weren\'t saved. Close it and open it again to see theirs.'] } } }
    const serverError = { response: { status: 500, data: { success: false, errors: ['Something went wrong on our side.'] } } }

    async function openAndSave(user: ReturnType<typeof userEvent.setup>) {
      render(<RestrictivePracticesTab participantId="participant-1" />)
      await user.click(screen.getByRole('button', { name: 'Edit' }))
      await user.type(screen.getByLabelText(/description/i), ' More.')
      await user.click(screen.getByRole('button', { name: /save entry/i }))
    }

    it('a 409 is a warning and takes focus, with the Callout scrolled into view', async () => {
      const user = userEvent.setup()
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
      mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false, refetch: vi.fn() } as never)
      mockUpdateMutateAsync.mockRejectedValueOnce(conflict)
      await openAndSave(user)

      const alert = await screen.findByRole('alert')
      expect(alert.className).toContain('--color-warning-container')
      expect(alert.parentElement).toHaveFocus()
      expect(alert.parentElement?.className).toContain('focus-visible:ring-2')
      expect(scrollIntoView).toHaveBeenCalled()
      scrollIntoView.mockRestore()
    })

    it('another error keeps the error tone', async () => {
      const user = userEvent.setup()
      mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false } as never)
      mockUpdateMutateAsync.mockRejectedValueOnce(serverError)
      await openAndSave(user)

      const alert = await screen.findByRole('alert')
      expect(alert.className).toContain('--color-destructive')
      expect(alert.className).not.toContain('--color-warning-container')
    })

    it('a second refusal takes focus again', async () => {
      const user = userEvent.setup()
      mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false, refetch: vi.fn() } as never)
      mockUpdateMutateAsync.mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict)
      await openAndSave(user)
      await screen.findByRole('alert')

      await user.click(screen.getByLabelText(/description/i))
      expect(screen.getByRole('alert').parentElement).not.toHaveFocus()
      await user.click(screen.getByRole('button', { name: /save entry/i }))

      await waitFor(() => expect(screen.getByRole('alert').parentElement).toHaveFocus())
    })
  })
})

describe('RestrictivePracticesTab — medicine-linked entries', () => {
  const linked = (o: Partial<RestrictivePracticeDto> = {}) => makePractice({
    type: 'ChemicalRestraint', relatedMedicationId: 'med-1', relatedMedicationName: 'Risperidone 1mg',
    relatedMedicationStatus: 'Active', ...o,
  })

  it('shows the report chip, the no-report text and the ceased marker on cards', () => {
    mockUseRestrictivePractices.mockReturnValue({
      data: [
        linked({ id: 'a', requiresReporting: true, relatedMedicationStatus: 'Ceased' }),
        linked({ id: 'b', requiresReporting: false }),
      ],
      isLoading: false,
    })
    render(<RestrictivePracticesTab participantId="participant-1" />)
    expect(screen.getByText('Report to NDIS Commission')).toBeInTheDocument()
    expect(screen.getByText('Report to NDIS Commission').querySelector('svg')).not.toBeNull()
    expect(screen.getByText('No report needed')).toBeInTheDocument()
    expect(screen.getByText(/Linked to Risperidone 1mg \(ceased\)/)).toBeInTheDocument()
  })

  it('sends the reporting answer when an unauthorised entry is saved', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: /save entry/i }))
    expect(mockUpdateMutateAsync.mock.calls[0][0].data).toEqual(expect.objectContaining({ requiresReporting: true }))
  })

  it('locks type and medicine on a linked entry and warns before deactivating it', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [linked()], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByText('Set by the linked medicine, so it stays a chemical restraint.')).toBeInTheDocument()
    expect(screen.getByText('To stop this restraint, untick Chemical restraint on the medicine or deactivate this entry.')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /^active/i }))
    expect(screen.getByText('Deactivating this entry also unticks Chemical restraint on Risperidone 1mg. Its history is kept.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save and untick medicine' })).toBeInTheDocument()
  })

  it('scrolls the deactivating and reactivating callouts into view above the sticky footer', async () => {
    const user = userEvent.setup()
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    mockUseRestrictivePractices.mockReturnValue({ data: [linked()], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    scrollIntoView.mockClear()
    await user.click(screen.getByRole('checkbox', { name: /^active/i }))
    const wrapper = screen.getByText(/Deactivating this entry also unticks/).closest('.pb-4.scroll-mb-24')
    expect(wrapper).not.toBeNull()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(scrollIntoView.mock.contexts).toContain(wrapper)
    scrollIntoView.mockRestore()
  })

  it('does not show the removed reporting hint', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice()], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.queryByText('Saved on the register entry.')).not.toBeInTheDocument()
  })

  it('explains why a linked entry cannot be deleted and offers to open it', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [linked()], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText("This entry can't be deleted")).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Open entry' }))
    expect(mockDeleteMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('Edit restrictive practice entry')).toBeInTheDocument()
  })

  it('says an inactive linked entry is kept as the record, with only Close', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [linked({ isActive: false })], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)
    await user.click(screen.getByRole('button', { name: /^Inactive/ }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText("This entry is linked to Risperidone 1mg, so it's kept as the record of that restraint.")).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Open entry' })).not.toBeInTheDocument()
    // The header X plus the single footer Close.
    expect(within(dialog).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Close dialog', 'Close'])
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mockDeleteMutateAsync).not.toHaveBeenCalled()
  })

  it('shows the stale-entry copy on a 409', async () => {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [linked()], isLoading: false, refetch: vi.fn() } as never)
    mockUpdateMutateAsync.mockRejectedValueOnce({ response: { status: 409, data: {} } })
    render(<RestrictivePracticesTab participantId="participant-1" />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: /save entry/i }))
    expect(await screen.findByText(/This entry was changed while you had it open/)).toBeInTheDocument()
  })
})

// RP register PR 1: use kind, the authorisation span, the behaviour support plan line and the edit modal's new fields.
describe('RestrictivePracticesTab use kind, authorisation span and plan line', () => {
  const authorised = { authorisedBy: 'Dr Chen', authorisationDate: '2026-08-01', isAuthorised: true }

  function renderWith(p: Partial<RestrictivePracticeDto>, role = 'Coordinator') {
    setUserRole(role)
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice(p)], isLoading: false })
    return render(<RestrictivePracticesTab participantId="participant-1" />)
  }

  it('leads the meta line with the use kind', () => {
    renderWith({ useKind: 'Prn', ...authorised })
    expect(screen.getByText('As needed (PRN)')).toBeInTheDocument()
  })

  it('reads "Authorised {start} to {end}" with an end date and "no end date" without one', () => {
    const first = renderWith({ ...authorised, authorisationEndDate: '2099-08-01' })
    expect(screen.getByText('Authorised 01/08/2026 to 01/08/2099')).toBeInTheDocument()
    first.unmount()
    renderWith({ ...authorised })
    expect(screen.getByText('Authorised 01/08/2026, no end date')).toBeInTheDocument()
  })

  it('says "Authorisation ended {end}" instead of the other reasons once the end date has passed', () => {
    renderWith({ ...authorised, authorisationEndDate: '2020-01-31', isAuthorised: false })
    expect(screen.getByText('Not authorised')).toBeInTheDocument()
    expect(screen.getByText('Authorisation ended 31/01/2020')).toBeInTheDocument()
    expect(screen.queryByText('Not yet in force')).not.toBeInTheDocument()
  })

  it('shows the plan pills from the server states, interim and comprehensive', () => {
    renderWith({
      ...authorised, firstUsedOn: '2026-09-01',
      interimBspState: 'Overdue', interimBspDueOn: '2026-10-01', comprehensiveBspState: 'DueSoon', comprehensiveBspDueOn: '2027-03-01',
    })
    expect(screen.getByText('Behaviour support plan')).toBeInTheDocument()
    expect(screen.getByText('Interim plan overdue 01/10/2026')).toBeInTheDocument()
    expect(screen.getByText('Comprehensive plan due 01/03/2027')).toBeInTheDocument()
  })

  it('hides the interim pill once the comprehensive plan is in place', () => {
    renderWith({
      ...authorised, firstUsedOn: '2026-03-01', interimBspDate: '2026-03-20', comprehensiveBspDate: '2026-08-20',
      interimBspState: 'InPlace', comprehensiveBspState: 'InPlace', interimBspDueOn: '2026-04-01', comprehensiveBspDueOn: '2026-09-01',
    })
    expect(screen.getByText('Comprehensive plan in place 20/08/2026')).toBeInTheDocument()
    expect(screen.queryByText(/Interim plan/)).not.toBeInTheDocument()
  })

  it('shows "in place" for the interim plan with its recorded date', () => {
    renderWith({
      ...authorised, firstUsedOn: '2026-09-01', interimBspDate: '2026-09-10',
      interimBspState: 'InPlace', interimBspDueOn: '2026-10-01', comprehensiveBspState: 'Due', comprehensiveBspDueOn: '2027-03-01',
    })
    expect(screen.getByText('Interim plan in place 10/09/2026')).toBeInTheDocument()
    expect(screen.getByText('Comprehensive plan due 01/03/2027')).toBeInTheDocument()
  })

  it('asks a writer to add the first use date, and tells a reader it is not recorded', () => {
    const writer = renderWith({ ...authorised })
    expect(screen.getByText('Add the first use date to see when plans are due')).toBeInTheDocument()
    writer.unmount()
    renderWith({ ...authorised }, 'ReadOnly')
    expect(screen.getByText('First use date not recorded')).toBeInTheDocument()
    expect(screen.queryByText(/Add the first use date/)).not.toBeInTheDocument()
  })

  it('does not ask for the first use date once an interim plan is on file', () => {
    renderWith({ ...authorised, interimBspDate: '2026-09-10', interimBspState: 'InPlace' })
    expect(screen.getByText(/Interim plan in place/)).toBeInTheDocument()
    expect(screen.queryByText(/Add the first use date/)).not.toBeInTheDocument()
  })

  it('shows no plan line on an inactive entry', async () => {
    const user = userEvent.setup()
    renderWith({ ...authorised, isActive: false })
    await user.click(screen.getByText('Inactive (1)'))
    expect(screen.queryByText('Behaviour support plan')).not.toBeInTheDocument()
  })
})

describe('RestrictivePracticesTab edit modal: use kind, end date and plan dates', () => {
  const authorised = { authorisedBy: 'Dr Chen', authorisationDate: '2026-08-01', isAuthorised: true }

  async function openEdit(p: Partial<RestrictivePracticeDto>) {
    const user = userEvent.setup()
    mockUseRestrictivePractices.mockReturnValue({ data: [makePractice(p)], isLoading: false })
    render(<RestrictivePracticesTab participantId="participant-1" />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    return user
  }

  it('saves the use kind and sends it with the plan dates', async () => {
    const user = await openEdit({ ...authorised, firstUsedOn: '2026-09-01', interimBspDate: '2026-09-10' })
    expect(screen.getByText('Routine is part of the everyday plan. As needed (PRN) is used only when a set situation arises.')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'As needed (PRN)' }))
    await user.click(screen.getByRole('button', { name: /save entry/i }))
    const data = mockUpdateMutateAsync.mock.calls[0][0].data
    expect(data).toMatchObject({ useKind: 'Prn', firstUsedOn: '2026-09-01', interimBspDate: '2026-09-10', comprehensiveBspDate: null, authorisationEndDate: null })
  })

  it('locks the use kind for a linked chemical entry and says the medicine sets it', async () => {
    await openEdit({ ...authorised, type: 'ChemicalRestraint', relatedMedicationId: 'med-1', relatedMedicationName: 'Risperidone', useKind: 'Prn' })
    expect(screen.getByText('Set by the linked medicine, which is PRN.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Routine' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'As needed (PRN)' })).toBeDisabled()
  })

  it('hints on a blank end date, and on one that has passed', async () => {
    const user = await openEdit({ ...authorised })
    expect(screen.getByText('Leave blank if the authorisation has no end date.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Authorisation end date'), '2020-01-31')
    expect(screen.getByText('This date has passed, so the entry reads Not authorised.')).toBeInTheDocument()
  })

  it("refuses an end date before the authorisation date and doesn't save", async () => {
    const user = await openEdit({ ...authorised })
    await user.type(screen.getByLabelText('Authorisation end date'), '2026-07-31')
    await user.click(screen.getByRole('button', { name: /save entry/i }))
    expect(await screen.findByText("The end date can't be before the authorisation date")).toBeInTheDocument()
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
  })

  it('saves the end date as null when Authorised is unticked', async () => {
    const user = await openEdit({ ...authorised, authorisationEndDate: '2099-08-01' })
    await user.click(screen.getByRole('checkbox', { name: /this restrictive practice is authorised/i }))
    await user.click(screen.getByRole('button', { name: /save entry/i }))
    expect(mockUpdateMutateAsync.mock.calls[0][0].data).toMatchObject({ authorisedBy: null, authorisationDate: null, authorisationEndDate: null })
  })

  it('refuses a first use date in the future', async () => {
    const user = await openEdit({ ...authorised })
    await user.type(screen.getByLabelText('First used on'), '2099-01-01')
    await user.click(screen.getByRole('button', { name: /save entry/i }))
    expect(await screen.findByText("The first use date can't be in the future")).toBeInTheDocument()
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
  })

  it('offers the earliest use on record and fills it on tap', async () => {
    const user = await openEdit({ ...authorised, earliestRecordedUseDate: '2026-09-05' })
    expect(screen.getByText('Earliest use on record: 05/09/2026.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use 05/09/2026' }))
    expect(screen.getByLabelText('First used on')).toHaveValue('2026-09-05')
    expect(screen.queryByRole('button', { name: 'Use 05/09/2026' })).not.toBeInTheDocument()
  })

  it('says a use is on record before the date entered', async () => {
    await openEdit({ ...authorised, firstUsedOn: '2026-10-01', earliestRecordedUseDate: '2026-09-05' })
    expect(screen.getByText('A use is on record from 05/09/2026, before this date.')).toBeInTheDocument()
  })

  it('explains the field when nothing is on record, with the plan timing in the fieldset intro', async () => {
    await openEdit({ ...authorised })
    expect(screen.getByText('The date this practice was first used. It starts the plan due dates.')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Behaviour support plan' })).toBeInTheDocument()
    expect(screen.getByText('The interim plan is due 1 month after first use, and the comprehensive plan 6 months after.')).toBeInTheDocument()
  })
})

// RP register PR 1: the bulk dialog asks how the batch is used and, for an authorised batch, each row's end date.
describe('Add entries: use kind and authorisation end date', () => {
  async function openSetup(user: ReturnType<typeof userEvent.setup>) {
    render(<RestrictivePracticesTab participantId="participant-1" />)
    await user.click(screen.getAllByRole('button', { name: /add entries/i })[0])
  }

  it('defaults the batch to Routine and sends the chosen use kind with each row', async () => {
    const user = userEvent.setup()
    mockBulkCreateMutateAsync.mockResolvedValueOnce({ data: [] })
    await openSetup(user)
    expect(screen.getByRole('radio', { name: 'Routine' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'As needed (PRN)' }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.type(screen.getByLabelText('Description, row 1'), 'Held at the kerb')
    await user.click(screen.getByRole('button', { name: /save 1 entry/i }))
    const item = mockBulkCreateMutateAsync.mock.calls[0][0].data.items[0]
    expect(item).toMatchObject({ useKind: 'Prn', authorisationEndDate: null })
  })

  it('says a linked medicine sets the use kind, for a chemical restraint only', async () => {
    const user = userEvent.setup()
    await openSetup(user)
    expect(screen.queryByText('A linked medicine sets this from its Regular or PRN setting.')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText(/restrictive practice type/i))
    await user.click(screen.getByRole('option', { name: /chemical restraint/i }))
    expect(screen.getByText('A linked medicine sets this from its Regular or PRN setting.')).toBeInTheDocument()
  })

  it('adds an end date column only for an authorised batch, and sends the date', async () => {
    const user = userEvent.setup()
    mockBulkCreateMutateAsync.mockResolvedValueOnce({ data: [] })
    await openSetup(user)
    await user.click(screen.getByRole('checkbox', { name: /this restrictive practice is authorised/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.type(screen.getByLabelText('Description, row 1'), 'Held at the kerb')
    await user.type(screen.getByLabelText('Authorised by, row 1'), 'Dr Chen')
    await user.type(screen.getByLabelText('Authorisation date, row 1'), '2026-08-01')
    await user.type(screen.getByLabelText('Authorisation end date, row 1'), '2027-08-01')
    await user.click(screen.getByRole('button', { name: /save 1 entry/i }))
    expect(mockBulkCreateMutateAsync.mock.calls[0][0].data.items[0]).toMatchObject({ authorisationDate: '2026-08-01', authorisationEndDate: '2027-08-01', useKind: 'Routine' })
  })

  it('has no end date column for an unauthorised batch', async () => {
    const user = userEvent.setup()
    await openSetup(user)
    await user.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.queryByLabelText('Authorisation end date, row 1')).not.toBeInTheDocument()
  })

  it("refuses an end date before the authorisation date on that row", async () => {
    const user = userEvent.setup()
    await openSetup(user)
    await user.click(screen.getByRole('checkbox', { name: /this restrictive practice is authorised/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.type(screen.getByLabelText('Description, row 1'), 'Held at the kerb')
    await user.type(screen.getByLabelText('Authorised by, row 1'), 'Dr Chen')
    await user.type(screen.getByLabelText('Authorisation date, row 1'), '2026-08-01')
    await user.type(screen.getByLabelText('Authorisation end date, row 1'), '2026-07-31')
    await user.click(screen.getByRole('button', { name: /save 1 entry/i }))
    expect(await screen.findByText("The end date can't be before the authorisation date.")).toBeInTheDocument()
    expect(mockBulkCreateMutateAsync).not.toHaveBeenCalled()
  })
})
