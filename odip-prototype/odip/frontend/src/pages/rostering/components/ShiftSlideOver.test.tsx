import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShiftSlideOver } from './ShiftSlideOver'
import { makeShift, makeFinding } from '../test-fixtures'
import type { ParticipantRoutineDto, CompatibilityRowDto } from '@/api/types'

const {
  mockCheckMutate, mockCreateMutateAsync, mockUpdateMutateAsync, mockDeleteMutateAsync, mockGetRosterFindings,
  mockUseParticipantRoutines, mockUseCompatibility,
} = vi.hoisted(() => ({
  mockCheckMutate: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockDeleteMutateAsync: vi.fn(),
  mockGetRosterFindings: vi.fn(() => null),
  mockUseParticipantRoutines: vi.fn(() => ({ data: [] as ParticipantRoutineDto[] })),
  mockUseCompatibility: vi.fn(() => ({ data: [] as CompatibilityRowDto[] })),
}))

// Only the API layer is mocked — every other collaborator (FindingsList, useSlideOverA11y,
// Dropdown, FormField) is the real component, so this exercises the actual override gate wiring.
vi.mock('@/api/hooks', () => ({
  useCheckShift: () => ({ mutate: mockCheckMutate, isPending: false }),
  useCreateShift: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateShift: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useDeleteShift: () => ({ mutateAsync: mockDeleteMutateAsync, isPending: false }),
  useParticipantRoutines: mockUseParticipantRoutines,
  useCompatibility: mockUseCompatibility,
  getRosterFindings: mockGetRosterFindings,
}))

function noop() {}

function makeRoutine(overrides: Partial<ParticipantRoutineDto> = {}): ParticipantRoutineDto {
  return {
    id: 'routine-1',
    participantId: 'participant-1',
    title: 'Morning routine',
    description: 'Wake gently, offer a warm drink.',
    category: 'PersonalCare',
    dayOfWeek: null,
    startTime: null,
    endTime: null,
    isCritical: false,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const participantOptions = [{ value: 'participant-1', label: 'Mia Chen' }]
const staffOptions = [{ value: 'staff-1', label: 'Alex Rivera' }]

function makeCompatibilityRow(overrides: Partial<CompatibilityRowDto> = {}): CompatibilityRowDto {
  return {
    staffId: 'staff-1',
    staffName: 'Alex Rivera',
    participantId: 'participant-1',
    participantName: 'Mia Chen',
    level: 'Preferred',
    reason: null,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  mockCheckMutate.mockClear()
  mockCreateMutateAsync.mockClear()
  mockUpdateMutateAsync.mockClear()
  mockDeleteMutateAsync.mockClear()
  mockUseParticipantRoutines.mockReturnValue({ data: [] as ParticipantRoutineDto[] })
  mockUseCompatibility.mockReturnValue({ data: [] as CompatibilityRowDto[] })
})

describe('ShiftSlideOver override gate', () => {
  it('disables save and renders no override-reason field when a Blocking finding is present', () => {
    const shift = makeShift({ findings: [makeFinding({ severity: 'Blocking', message: 'Hard conflict' })] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
    expect(screen.queryByLabelText(/reason for override/i)).not.toBeInTheDocument()
  })

  it('blocks save with Warning findings and an empty reason', async () => {
    const user = userEvent.setup()
    const shift = makeShift({
      findings: [makeFinding({ severity: 'Warning', message: 'Needs a look' })],
      overrideReason: null,
    })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.click(screen.getByRole('button', { name: /save with override/i }))

    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText(/a reason is required to save with open warnings/i)).toBeInTheDocument()
  })

  it('enables save with Warning findings once a reason is entered, and submits overrideReason + acknowledgedFindingCodes', async () => {
    const user = userEvent.setup()
    const shift = makeShift({
      findings: [makeFinding({ code: 'RATIO_SHORTFALL', severity: 'Warning', message: 'Ratio not met' })],
      overrideReason: null,
    })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    const saveButton = screen.getByRole('button', { name: /save with override/i })
    expect(saveButton).not.toBeDisabled()

    await user.type(screen.getByLabelText(/reason for override/i), 'Coordinator approved short-term')
    await user.click(saveButton)

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockUpdateMutateAsync.mock.calls[0]
    expect(call.id).toBe(shift.id)
    expect(call.data.overrideReason).toBe('Coordinator approved short-term')
    expect(call.data.acknowledgedFindingCodes).toEqual(['RATIO_SHORTFALL'])
  })

  it('populates an existing overrideReason when reopening a shift', () => {
    const shift = makeShift({ overrideReason: 'Approved by team lead', findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.getByLabelText(/reason for override/i)).toHaveValue('Approved by team lead')
  })
})

describe('ShiftSlideOver routines & specifics', () => {
  // makeShift's default serviceDate (2026-08-17) is a Monday, 09:00–17:00.
  it('renders a routine whose window overlaps the shift', () => {
    mockUseParticipantRoutines.mockReturnValue({
      data: [makeRoutine({ title: 'Lunch support', startTime: '12:00:00', endTime: '13:00:00' })],
    })
    const shift = makeShift({ findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.getByText('Routines & specifics')).toBeInTheDocument()
    expect(screen.getByText('Lunch support')).toBeInTheDocument()
  })

  it('does not render a routine whose window falls outside the shift', () => {
    mockUseParticipantRoutines.mockReturnValue({
      data: [makeRoutine({ title: 'Evening wind-down', startTime: '20:00:00', endTime: '21:00:00' })],
    })
    const shift = makeShift({ findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.queryByText('Routines & specifics')).not.toBeInTheDocument()
    expect(screen.queryByText('Evening wind-down')).not.toBeInTheDocument()
  })

  it('always surfaces an untimed critical routine on a matching day, flagged as critical', () => {
    mockUseParticipantRoutines.mockReturnValue({
      data: [makeRoutine({ title: 'Seizure protocol', isCritical: true, startTime: null, endTime: null })],
    })
    const shift = makeShift({ findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.getByText('Seizure protocol')).toBeInTheDocument()
    expect(screen.getByLabelText('Critical')).toBeInTheDocument()
  })

  it('does not surface an untimed non-critical routine', () => {
    mockUseParticipantRoutines.mockReturnValue({
      data: [makeRoutine({ title: 'General preference', isCritical: false, startTime: null, endTime: null })],
    })
    const shift = makeShift({ findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.queryByText('General preference')).not.toBeInTheDocument()
  })

  it('does not render the routines section for a create-mode shift with no service date yet', () => {
    mockUseParticipantRoutines.mockReturnValue({
      data: [makeRoutine({ title: 'Morning routine', startTime: '09:00:00', endTime: '10:00:00' })],
    })
    render(
      <ShiftSlideOver
        target={{ mode: 'create', participantId: 'participant-1' }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.queryByText('Routines & specifics')).not.toBeInTheDocument()
  })
})

describe('ShiftSlideOver staff compatibility (task 6d)', () => {
  const twoStaffOptions = [
    { value: 'staff-1', label: 'Alex Rivera' },
    { value: 'staff-2', label: 'Jordan Smith' },
  ]

  it('sorts a Preferred staff member to the top of the Staff dropdown, with a hint', async () => {
    const user = userEvent.setup()
    mockUseCompatibility.mockReturnValue({
      data: [makeCompatibilityRow({ staffId: 'staff-2', staffName: 'Jordan Smith', level: 'Preferred' })],
    })
    const shift = makeShift({ staffId: null, findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={twoStaffOptions}
      />,
    )

    await user.click(screen.getByLabelText('Staff'))

    const options = screen.getAllByRole('option')
    const labels = options.map(o => o.textContent)
    // Jordan Smith (Preferred) sorts ahead of Alex Rivera (no compatibility row), after Unassigned.
    expect(labels.findIndex(l => l?.includes('Jordan Smith'))).toBeLessThan(labels.findIndex(l => l?.includes('Alex Rivera')))
    expect(screen.getByText('Preferred for this participant')).toBeInTheDocument()
  })

  it('sinks an Excluded staff member to the bottom of the Staff dropdown, with a warning label', async () => {
    const user = userEvent.setup()
    mockUseCompatibility.mockReturnValue({
      data: [makeCompatibilityRow({ staffId: 'staff-1', staffName: 'Alex Rivera', level: 'Excluded' })],
    })
    const shift = makeShift({ staffId: null, findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={twoStaffOptions}
      />,
    )

    await user.click(screen.getByLabelText('Staff'))

    const options = screen.getAllByRole('option')
    const labels = options.map(o => o.textContent)
    expect(labels.findIndex(l => l?.includes('Jordan Smith'))).toBeLessThan(labels.findIndex(l => l?.includes('Alex Rivera')))
    expect(screen.getByText('Not compatible with this participant')).toBeInTheDocument()
  })

  it('shows a non-blocking warning when the currently selected staff member is marked Excluded', () => {
    mockUseCompatibility.mockReturnValue({
      data: [makeCompatibilityRow({ staffId: 'staff-1', staffName: 'Alex Rivera', level: 'Excluded' })],
    })
    // Default makeShift() staffId is staff-1 (Alex Rivera).
    const shift = makeShift({ findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    // role="status" (polite), not "alert" (assertive) — this is non-blocking, informational
    // context, not a save-blocking error, so it shouldn't interrupt like the Blocking-finding alert does.
    expect(screen.getByRole('status')).toHaveTextContent(/alex rivera is marked not compatible with this participant/i)
    expect(screen.getByRole('status')).toHaveTextContent(/you can still save this shift/i)
    // Non-blocking: no Blocking/Warning findings present, so Save stays enabled.
    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled()
  })

  it('includes the exclusion reason in the warning when one is recorded on the compatibility row', () => {
    mockUseCompatibility.mockReturnValue({
      data: [makeCompatibilityRow({ staffId: 'staff-1', staffName: 'Alex Rivera', level: 'Excluded', reason: 'Prior incident on shift' })],
    })
    const shift = makeShift({ findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(/prior incident on shift/i)
  })

  it('shows a preferred hint (not an alert) when the currently selected staff member is marked Preferred', () => {
    mockUseCompatibility.mockReturnValue({
      data: [makeCompatibilityRow({ staffId: 'staff-1', staffName: 'Alex Rivera', level: 'Preferred' })],
    })
    const shift = makeShift({ findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.getByText(/alex rivera is a preferred staff member for this participant/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows neither hint nor warning for a staff member with no compatibility row (Allowed default)', () => {
    mockUseCompatibility.mockReturnValue({ data: [] as CompatibilityRowDto[] })
    const shift = makeShift({ findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.queryByText(/preferred staff member/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/not compatible with this participant/i)).not.toBeInTheDocument()
  })

  it('does not dangle aria-describedby for an explicit Allowed-level compatibility row (no notice paragraph is rendered for it)', () => {
    // Distinct from the "no compatibility row" case above: this asserts the guard checks the
    // *level*, not merely "a row exists" — an explicit Allowed row must behave the same as no
    // row at all, since only Excluded/Preferred ever render the linked notice paragraph.
    mockUseCompatibility.mockReturnValue({
      data: [makeCompatibilityRow({ staffId: 'staff-1', staffName: 'Alex Rivera', level: 'Allowed' })],
    })
    const shift = makeShift({ findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.queryByText(/preferred staff member/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/not compatible with this participant/i)).not.toBeInTheDocument()

    // aria-labelledby (wired by FormField for the custom SearchableSelect control) makes the
    // field's accessible name the "Staff" label text, not the combobox's placeholder/typed value.
    // The field still carries the built-in "Leave unassigned..." hint's id (that's independent
    // of compatibility level) — the bug this guards against is every id in aria-describedby
    // resolving to a real element, i.e. no id referencing the Excluded/Preferred notice
    // paragraph when neither is rendered.
    const field = screen.getByRole('combobox', { name: 'Staff' })
    const describedBy = field.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    for (const id of describedBy!.split(' ')) {
      expect(document.getElementById(id)).not.toBeNull()
    }
  })
})

describe('ShiftSlideOver Staff field — SearchableSelect (DS-01/UX-01 migration)', () => {
  const threeStaffOptions = [
    { value: 'staff-1', label: 'Alex Rivera' },
    { value: 'staff-2', label: 'Jordan Smith' },
    { value: 'staff-3', label: 'Bianca Novak' },
  ]

  it('renders the Staff field as a combobox and narrows the option list as the user types', async () => {
    const user = userEvent.setup()
    const shift = makeShift({ staffId: null, findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={threeStaffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Staff' })
    await user.click(field)
    expect(screen.getAllByRole('option')).toHaveLength(4) // Unassigned + 3 staff

    await user.type(field, 'jordan')

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Jordan Smith')
  })

  it('selects a staff member via keyboard (arrow down + enter)', async () => {
    const user = userEvent.setup()
    const shift = makeShift({ staffId: null, findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={threeStaffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Staff' })
    await user.click(field)
    // Unassigned, Alex Rivera, Jordan Smith, Bianca Novak — two ArrowDowns lands on Alex Rivera.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(field).toHaveValue('Alex Rivera')
    expect(field).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on Escape without changing the current selection', async () => {
    const user = userEvent.setup()
    const shift = makeShift({ staffId: 'staff-1', findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={threeStaffOptions}
      />,
    )

    const field = screen.getByRole('combobox', { name: 'Staff' })
    expect(field).toHaveValue('Alex Rivera')

    await user.click(field)
    await user.type(field, 'zzz')
    expect(screen.getByText('No results found')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(field).toHaveAttribute('aria-expanded', 'false')
    expect(field).toHaveValue('Alex Rivera')
  })
})
