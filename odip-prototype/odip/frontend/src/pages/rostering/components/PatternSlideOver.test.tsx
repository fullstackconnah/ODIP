import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PatternSlideOver } from './PatternSlideOver'
import type { ShiftPatternDto } from '@/api/types'

const { mockCreateMutateAsync, mockUpdateMutateAsync, mockDeleteMutateAsync } = vi.hoisted(() => ({
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockDeleteMutateAsync: vi.fn(),
}))

// Only the API layer is mocked — FormField, Dropdown, SearchableSelect, ConfirmDialog are the
// real components, so this exercises the actual Default staff field wiring.
vi.mock('@/api/hooks', () => ({
  useCreatePattern: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdatePattern: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useDeletePattern: () => ({ mutateAsync: mockDeleteMutateAsync, isPending: false }),
}))

function noop() {}

function makePattern(overrides: Partial<ShiftPatternDto> = {}): ShiftPatternDto {
  return {
    id: 'pattern-1',
    participantId: 'participant-1',
    participantName: 'Mia Chen',
    defaultStaffId: 'staff-1',
    defaultStaffName: 'Alex Rivera',
    dayOfWeek: 'Monday',
    startTime: '09:00:00',
    endTime: '17:00:00',
    endsNextDay: false,
    ratio: 'OneToOne',
    nightType: 'None',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    isActive: true,
    notes: null,
    ...overrides,
  }
}

const participantOptions = [{ value: 'participant-1', label: 'Mia Chen' }]
const staffOptions = [
  { value: 'staff-1', label: 'Alex Rivera' },
  { value: 'staff-2', label: 'Jordan Smith' },
  { value: 'staff-3', label: 'Bianca Novak' },
]

beforeEach(() => {
  mockCreateMutateAsync.mockClear()
  mockUpdateMutateAsync.mockClear()
  mockDeleteMutateAsync.mockClear()
})

describe('PatternSlideOver Default staff field — SearchableSelect (DS-01/UX-01 migration)', () => {
  it('renders the field as a combobox showing the current default staff label', () => {
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern() }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Default staff' })
    expect(field).toHaveValue('Alex Rivera')
  })

  it('shows "Unassigned" as the first option and current value when no default staff is set', async () => {
    const user = userEvent.setup()
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern({ defaultStaffId: null, defaultStaffName: null }) }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Default staff' })
    expect(field).toHaveValue('Unassigned')

    await user.click(field)
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Unassigned')
    expect(options).toHaveLength(4)
  })

  it('narrows the option list as the user types', async () => {
    const user = userEvent.setup()
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern({ defaultStaffId: null, defaultStaffName: null }) }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Default staff' })
    await user.click(field)
    await user.type(field, 'bianca')

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Bianca Novak')
  })

  it('selects a new default staff member by clicking an option, and saves it', async () => {
    const user = userEvent.setup()
    mockUpdateMutateAsync.mockResolvedValue(undefined)
    const pattern = makePattern({ defaultStaffId: null, defaultStaffName: null })
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Default staff' })
    await user.click(field)
    await user.click(screen.getByRole('option', { name: 'Jordan Smith' }))

    expect(field).toHaveValue('Jordan Smith')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: pattern.id,
      data: expect.objectContaining({ defaultStaffId: 'staff-2' }),
    }))
  })

  it('selects via keyboard (arrow down + enter)', async () => {
    const user = userEvent.setup()
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern({ defaultStaffId: null, defaultStaffName: null }) }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Default staff' })
    await user.click(field)
    // Unassigned, Alex Rivera, Jordan Smith, Bianca Novak — three ArrowDowns lands on Jordan Smith.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')

    expect(field).toHaveValue('Jordan Smith')
    expect(field).toHaveAttribute('aria-expanded', 'false')
  })

  it('Escape closes the popup and discards an unsubmitted query, keeping the prior selection', async () => {
    const user = userEvent.setup()
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern() }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Default staff' })
    expect(field).toHaveValue('Alex Rivera')

    await user.click(field)
    await user.type(field, 'nomatch')
    expect(screen.getByText('No results found')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(field).toHaveAttribute('aria-expanded', 'false')
    expect(field).toHaveValue('Alex Rivera')
  })

  it('is disabled when canWrite is false', () => {
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern() }}
        onClose={noop}
        canWrite={false}
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Default staff' })).toBeDisabled()
  })
})

// ── The server's refusal (readiness Enforce mode) ────────────────────────────────────────────────────────────────────
// In Enforce mode the API answers a pattern write for a participant who is not ready with a 400 carrying
// "Participant is not ready for booking or rostering." The panel used to swallow it behind a generic line.
const NOT_READY_MESSAGE = 'Participant is not ready for booking or rostering.'
const GENERIC_PATTERN_ERROR = 'Something went wrong saving this pattern. Please try again.'

/** What axios rejects with for a 400 carrying the API's ApiResponse envelope. */
function badRequest(...errors: string[]) {
  return { response: { status: 400, data: { success: false, errors } } }
}

describe('PatternSlideOver — the server\'s refusal reaches the user', () => {
  it('edit: shows the server\'s own message, not the generic line, keeps the edited values, and sent the full body', async () => {
    const user = userEvent.setup()
    mockUpdateMutateAsync.mockRejectedValueOnce(badRequest(NOT_READY_MESSAGE))
    const onClose = vi.fn()
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern() }}
        onClose={onClose}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.type(screen.getByLabelText('Notes'), 'Fortnightly review')
    await user.click(screen.getByLabelText('Ends the next day'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
      id: 'pattern-1',
      data: {
        participantId: 'participant-1',
        defaultStaffId: 'staff-1',
        dayOfWeek: 'Monday',
        startTime: '09:00',
        endTime: '17:00',
        endsNextDay: true,
        ratio: 'OneToOne',
        nightType: 'None',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        isActive: true,
        notes: 'Fortnightly review',
      },
    })
    const message = await screen.findByText(NOT_READY_MESSAGE)
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(screen.queryByText(GENERIC_PATTERN_ERROR)).not.toBeInTheDocument()
    // The panel stays open and the form is as the user left it.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Notes')).toHaveValue('Fortnightly review')
    expect(screen.getByLabelText('Ends the next day')).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('create: shows the server\'s own message and sent the full body', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockRejectedValueOnce(badRequest(NOT_READY_MESSAGE))
    render(
      <PatternSlideOver
        target={{ mode: 'create' }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.click(screen.getByLabelText(/^participant/i))
    await user.click(screen.getByRole('option', { name: 'Mia Chen' }))
    await user.type(screen.getByLabelText(/effective from/i), '2026-10-05')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      defaultStaffId: null,
      dayOfWeek: 'Monday',
      startTime: '09:00',
      endTime: '09:00',
      endsNextDay: false,
      ratio: 'OneToOne',
      nightType: 'None',
      effectiveFrom: '2026-10-05',
      effectiveTo: null,
      isActive: true,
      notes: null,
    })
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(GENERIC_PATTERN_ERROR)).not.toBeInTheDocument()
  })

  it.each([
    ['a network failure with no response', new Error('Network Error')],
    ['a 500 with an empty body', { response: { status: 500, data: {} } }],
  ])('falls back to the generic line for %s', async (_label, failure) => {
    const user = userEvent.setup()
    mockUpdateMutateAsync.mockRejectedValueOnce(failure)
    render(
      <PatternSlideOver
        target={{ mode: 'edit', pattern: makePattern() }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(GENERIC_PATTERN_ERROR)).toBeInTheDocument()
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })
})

describe('PatternSlideOver as a dialog', () => {
  const props = { canWrite: true, participantOptions, staffOptions }

  it('is a modal dialog named "New pattern" or "Edit pattern"', () => {
    const { unmount } = render(<PatternSlideOver {...props} target={{ mode: 'create' }} onClose={noop} />)
    expect(screen.getByRole('dialog', { name: 'New pattern' })).toHaveAttribute('aria-modal', 'true')
    unmount()
    render(<PatternSlideOver {...props} target={{ mode: 'edit', pattern: makePattern() }} onClose={noop} />)
    expect(screen.getByRole('dialog', { name: 'Edit pattern' })).toBeInTheDocument()
  })

  it('Escape closes an untouched panel straight away', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PatternSlideOver {...props} target={{ mode: 'edit', pattern: makePattern() }} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape after an edit asks before closing; Keep editing keeps the edit', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PatternSlideOver {...props} target={{ mode: 'edit', pattern: makePattern() }} onClose={onClose} />)
    await user.type(screen.getByLabelText('Notes'), 'Fortnightly')
    await user.keyboard('{Escape}')
    const prompt = screen.getByRole('alertdialog', { name: 'Discard changes?' })
    expect(onClose).not.toHaveBeenCalled()
    await user.click(within(prompt).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('dialog', { name: 'Edit pattern' })).toBeInTheDocument()
    expect(screen.getByLabelText('Notes')).toHaveValue('Fortnightly')
  })

  it('Delete opens a confirm dialog; Escape closes only that dialog and leaves the panel open', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PatternSlideOver {...props} target={{ mode: 'edit', pattern: makePattern() }} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('alertdialog', { name: 'Delete pattern' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Edit pattern' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
  })
})

// Plan builder phase D: a pattern an approved agreement made stays editable, and says so when it is edited (nothing is locked).
describe('PatternSlideOver — a pattern an agreement made', () => {
  const agreementPattern = () => makePattern({
    sourceDraftId: 'draft-2', sourceBlockKey: 'mornings', sourceDraftVersion: 2, workerSlot: 1, notes: 'From agreement v2: Community access, community',
    requirements: { workerGender: 'Female', driver: true, skills: ['FirstAid'] },
  })

  const open = (pattern: ShiftPatternDto | null) => render(
    <PatternSlideOver
      target={pattern ? { mode: 'edit', pattern } : { mode: 'create' }}
      onClose={noop}
      canWrite
      participantOptions={participantOptions}
      staffOptions={staffOptions}
    />,
  )

  it('warns, in the agreement\'s own version, that changing it here makes the roster differ from the agreement', () => {
    open(agreementPattern())

    expect(screen.getByText('This pattern came from agreement v2; changing it here makes the roster differ from the agreement.')).toBeInTheDocument()
  })

  it('says nothing of the kind about a hand-made pattern, or when making a new one', () => {
    const { unmount } = open(makePattern())
    expect(screen.queryByText(/came from agreement/)).not.toBeInTheDocument()
    unmount()

    open(null)
    expect(screen.queryByText(/came from agreement/)).not.toBeInTheDocument()
  })

  it('shows what the agreement asks of a worker as chips, which are information and not a field to change', () => {
    open(agreementPattern())

    const chips = within(screen.getByRole('list', { name: 'Asks for' }))
    expect(chips.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Female worker', 'Driver', 'First aid'])
  })

  it('still saves a change, and sends only the fields it always sent: where the pattern came from is not the form\'s to change', async () => {
    const user = userEvent.setup()
    mockUpdateMutateAsync.mockResolvedValue({})
    open(agreementPattern())

    fireEvent.change(screen.getByLabelText(/Start time/), { target: { value: '10:00' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
      id: 'pattern-1',
      data: {
        participantId: 'participant-1', defaultStaffId: 'staff-1', dayOfWeek: 'Monday', startTime: '10:00', endTime: '17:00', endsNextDay: false, ratio: 'OneToOne', nightType: 'None',
        effectiveFrom: '2026-01-01', effectiveTo: null, isActive: true, notes: 'From agreement v2: Community access, community',
      },
    })
  })
})
