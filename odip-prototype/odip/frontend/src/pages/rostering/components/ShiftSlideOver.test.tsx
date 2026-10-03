import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShiftSlideOver } from './ShiftSlideOver'
import { makeShift, makeFinding } from '../test-fixtures'
import type { ParticipantRoutineDto, CompatibilityRowDto, ShiftDto, ShiftNoteDto, ShiftPatternDto } from '@/api/types'

const {
  mockCheckMutate, mockCreateMutateAsync, mockUpdateMutateAsync, mockDeleteMutateAsync, mockGetRosterFindings,
  mockUseParticipantRoutines, mockUseCompatibility, mockUseShiftNotes, mockUsePattern,
} = vi.hoisted(() => ({
  mockCheckMutate: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockDeleteMutateAsync: vi.fn(),
  mockGetRosterFindings: vi.fn(() => null),
  mockUseParticipantRoutines: vi.fn(() => ({ data: [] as ParticipantRoutineDto[] })),
  mockUseCompatibility: vi.fn(() => ({ data: [] as CompatibilityRowDto[] })),
  mockUseShiftNotes: vi.fn(() => ({ data: [] as ShiftNoteDto[] })),
  mockUsePattern: vi.fn(() => ({ data: undefined as ShiftPatternDto | undefined })),
}))

// Only the API layer is mocked — every other collaborator (FindingsList, SlideOver,
// Dropdown, FormField) is the real component, so this exercises the actual override gate wiring.
vi.mock('@/api/hooks', () => ({
  useCheckShift: () => ({ mutate: mockCheckMutate, isPending: false }),
  useCreateShift: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateShift: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useDeleteShift: () => ({ mutateAsync: mockDeleteMutateAsync, isPending: false }),
  useParticipantRoutines: mockUseParticipantRoutines,
  useCompatibility: mockUseCompatibility,
  useRosterShiftNotes: mockUseShiftNotes,
  usePattern: mockUsePattern,
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
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
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
  mockUseShiftNotes.mockReturnValue({ data: [] as ShiftNoteDto[] })
  mockUsePattern.mockReset()
  mockUsePattern.mockReturnValue({ data: undefined })
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
      findings: [makeFinding({ severity: 'Warning', message: 'Needs a look', requiresReason: true })],
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
    expect(screen.getByText(/a reason is required to save over the warnings marked/i)).toBeInTheDocument()
  })

  it('enables save with Warning findings once a reason is entered, and submits overrideReason + acknowledgedFindingCodes', async () => {
    const user = userEvent.setup()
    const shift = makeShift({
      findings: [makeFinding({ code: 'RATIO_SHORTFALL', severity: 'Warning', message: 'Ratio not met', requiresReason: true })],
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

  it('allows save with a Warning finding that does not require a reason, still recording its code in acknowledgedFindingCodes', async () => {
    const user = userEvent.setup()
    const shift = makeShift({
      findings: [makeFinding({ code: 'STAFF_LEAVE_PENDING', severity: 'Warning', message: 'Pending leave overlaps this window.', requiresReason: false })],
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

    await user.click(saveButton)

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockUpdateMutateAsync.mock.calls[0]
    expect(call.data.overrideReason).toBeNull()
    expect(call.data.acknowledgedFindingCodes).toEqual(['STAFF_LEAVE_PENDING'])
    expect(screen.queryByText(/a reason is required to save over the warnings marked/i)).not.toBeInTheDocument()
  })

  it('renders the override-reason field as optional when the only Warning present does not require a reason', () => {
    const shift = makeShift({
      findings: [makeFinding({ code: 'STAFF_LEAVE_PENDING', severity: 'Warning', requiresReason: false })],
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

    // The roster board invites a voluntary override note on ANY warning (showOnAnyWarning) —
    // deliberate, and distinct from the trip-side surfaces which only show the field when a
    // finding actually requires a reason. See RosterGateFieldsProps.showOnAnyWarning.
    const field = screen.getByLabelText(/reason for override/i)
    expect(field).not.toHaveAttribute('aria-required', 'true')
  })
})

describe('ShiftSlideOver status (PP-8)', () => {
  it('echoes the shift\'s current status back unchanged on save, without the user touching it', async () => {
    const user = userEvent.setup()
    const shift = makeShift({ status: 'Published', findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockUpdateMutateAsync.mock.calls[0]
    expect(call.data.status).toBe('Published')
  })

  it('lets the coordinator move a shift from Draft to Published via the Status control', async () => {
    const user = userEvent.setup()
    const shift = makeShift({ status: 'Draft', findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.click(screen.getByLabelText('Status'))
    await user.click(screen.getByRole('option', { name: 'Published' }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockUpdateMutateAsync.mock.calls[0]
    expect(call.data.status).toBe('Published')
  })

  it('does not render a Status control in create mode', () => {
    render(
      <ShiftSlideOver
        target={{ mode: 'create', participantId: 'participant-1' }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
  })
})

// PP-8 follow-up: RosteringController.UpdateShift's fromAllowed/toAllowed gate only ever allows
// a Draft/Published/Cancelled status — InProgress/PendingReview/Completed are worker/reviewer-
// driven states reached only through the completion endpoints, and the dropdown must never
// offer a transition the backend will always 409 (ShiftErrorCodes.ShiftStatusLocked).
describe('ShiftSlideOver status — coordinator-settable statuses only', () => {
  it('offers only Draft/Published/Cancelled when the shift is in a coordinator-settable status', async () => {
    const user = userEvent.setup()
    const shift = makeShift({ status: 'Draft', findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.click(screen.getByLabelText('Status'))

    expect(screen.getByRole('option', { name: 'Draft' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Published' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Cancelled' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Completed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'InProgress' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'PendingReview' })).not.toBeInTheDocument()
  })

  it.each(['InProgress', 'PendingReview', 'Completed'] as const)(
    'shows the current status read-only (disabled, not offering other options) when the shift is %s',
    (workerStatus) => {
      const shift = makeShift({ status: workerStatus, findings: [] })
      render(
        <ShiftSlideOver
          target={{ mode: 'edit', shift }}
          onClose={noop}
          canWrite
          participantOptions={participantOptions}
          staffOptions={staffOptions}
        />,
      )

      const statusControl = screen.getByLabelText('Status')
      expect(statusControl).toHaveTextContent(workerStatus)
      expect(statusControl).toBeDisabled()
    },
  )

  it('lets the coordinator save other field changes unchanged for a shift already in a worker-driven status', async () => {
    const user = userEvent.setup()
    const shift = makeShift({ status: 'InProgress', findings: [] })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockUpdateMutateAsync.mock.calls[0]
    expect(call.data.status).toBe('InProgress')
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

describe('ShiftSlideOver shift notes (NOTES-01, read-only)', () => {
  function makeNote(overrides: Partial<ShiftNoteDto> = {}): ShiftNoteDto {
    return {
      id: 'note-1',
      shiftId: 'shift-1',
      authorUserId: 'staff-1',
      authorName: 'Alex Rivera',
      body: 'Quiet shift, no concerns.',
      createdAt: '2026-08-17T09:30:00Z',
      updatedAt: '2026-08-17T09:30:00Z',
      flaggedCategories: [],
      flagsAcknowledgedAt: null,
      incidentId: null,
      ...overrides,
    }
  }

  it('renders no notes section for a brand-new (unsaved) shift', () => {
    render(
      <ShiftSlideOver
        target={{ mode: 'create', participantId: 'participant-1' }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.queryByText('Shift notes')).not.toBeInTheDocument()
  })

  it('renders each note with its author and no disclosure toggle for two or fewer notes', () => {
    mockUseShiftNotes.mockReturnValue({
      data: [makeNote({ id: 'note-1', body: 'First note.' }), makeNote({ id: 'note-2', body: 'Second note.' })],
    })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift: makeShift() }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.getByText('Shift notes')).toBeInTheDocument()
    expect(screen.getByText('First note.')).toBeInTheDocument()
    expect(screen.getByText('Second note.')).toBeInTheDocument()
    expect(screen.getAllByText('Alex Rivera').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument()
  })

  it('collapses beyond two notes behind a disclosure toggle', async () => {
    const user = userEvent.setup()
    mockUseShiftNotes.mockReturnValue({
      data: [
        makeNote({ id: 'note-1', body: 'First note.' }),
        makeNote({ id: 'note-2', body: 'Second note.' }),
        makeNote({ id: 'note-3', body: 'Third note.' }),
      ],
    })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift: makeShift() }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.getByText('First note.')).toBeInTheDocument()
    expect(screen.getByText('Second note.')).toBeInTheDocument()
    expect(screen.queryByText('Third note.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show all 3 notes' }))

    expect(screen.getByText('Third note.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show fewer notes' })).toBeInTheDocument()
  })

  it('NOTES-02: shows a category badge on a flagged note, but not on an unflagged one', () => {
    mockUseShiftNotes.mockReturnValue({
      data: [
        makeNote({ id: 'note-1', body: 'She had a fall near the bathroom.', flaggedCategories: ['Falls'] }),
        makeNote({ id: 'note-2', body: 'Quiet shift, no concerns.', flaggedCategories: [] }),
      ],
    })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift: makeShift() }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.getByText('falls')).toBeInTheDocument()
  })

  it('NOTES-02: shows a joined badge for a note flagged in more than one category', () => {
    mockUseShiftNotes.mockReturnValue({
      data: [makeNote({ flaggedCategories: ['Falls', 'Medication'] })],
    })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift: makeShift() }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.getByText('falls and medication')).toBeInTheDocument()
  })
})

// ── Participant readiness (WARN mode) ────────────────────────────────────────────────────────────────────────────────
// The server either lets the write through and reports what is missing (Warn), or refuses with a 400 whose message is
// "Participant is not ready for booking or rostering." (Enforce). The panel must show that real message, never the generic
// line, keep what the user typed, and never block a save on the quiet warning.
const NOT_READY_MESSAGE = 'Participant is not ready for booking or rostering.'
const GENERIC_SHIFT_ERROR = /Something went wrong saving this shift/i

/** What axios rejects with for a 400 carrying the API's ApiResponse envelope. */
function badRequest(...errors: string[]) {
  return { response: { status: 400, data: { success: false, errors } } }
}

describe('ShiftSlideOver — the server\'s refusal reaches the user', () => {
  it('create: shows the server\'s own message, not the generic line, keeps what was typed, and sent the full body', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockRejectedValueOnce(badRequest(NOT_READY_MESSAGE))
    const onClose = vi.fn()
    render(
      <ShiftSlideOver
        target={{ mode: 'create', participantId: 'participant-1', staffId: null, serviceDate: '2026-08-17' }}
        onClose={onClose}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.type(screen.getByLabelText('Notes'), 'Bring the sling')
    await user.click(screen.getByLabelText('Ends the next day'))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      staffId: null,
      serviceDate: '2026-08-17',
      startTime: '09:00',
      endTime: '09:00',
      endsNextDay: true,
      ratio: 'OneToOne',
      nightType: 'None',
      status: 'Draft',
      notes: 'Bring the sling',
      overrideReason: null,
      acknowledgedFindingCodes: [],
    })
    const message = await screen.findByText(NOT_READY_MESSAGE)
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(screen.queryByText(GENERIC_SHIFT_ERROR)).not.toBeInTheDocument()
    // The panel stays open and the form is exactly as the user left it.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Notes')).toHaveValue('Bring the sling')
    expect(screen.getByLabelText('Ends the next day')).toBeChecked()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled()
  })

  it('edit: shows the server\'s own message, keeps the edited values, and sent the full body', async () => {
    const user = userEvent.setup()
    mockUpdateMutateAsync.mockRejectedValueOnce(badRequest(NOT_READY_MESSAGE))
    const shift = makeShift({ status: 'Published', findings: [], notes: null })
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.type(screen.getByLabelText('Notes'), 'Swap with Tuesday')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
      id: 'shift-1',
      data: {
        participantId: 'participant-1',
        staffId: 'staff-1',
        serviceDate: '2026-08-17',
        startTime: '09:00',
        endTime: '17:00',
        endsNextDay: false,
        ratio: 'OneToOne',
        nightType: 'None',
        status: 'Published',
        notes: 'Swap with Tuesday',
        overrideReason: null,
        acknowledgedFindingCodes: [],
      },
    })
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(GENERIC_SHIFT_ERROR)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Notes')).toHaveValue('Swap with Tuesday')
  })

  it('reads the top-level message when the error has no errors list', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockRejectedValueOnce({ response: { status: 400, data: { success: false, message: 'Participant is archived.' } } })
    render(
      <ShiftSlideOver
        target={{ mode: 'create', participantId: 'participant-1' }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByText('Participant is archived.')).toBeInTheDocument()
    expect(screen.queryByText(GENERIC_SHIFT_ERROR)).not.toBeInTheDocument()
  })

  it.each([
    ['a network failure with no response', new Error('Network Error')],
    ['a 500 with an empty body', { response: { status: 500, data: {} } }],
    ['a 400 with an empty errors list', { response: { status: 400, data: { success: false, errors: [] } } }],
  ])('falls back to the generic line for %s', async (_label, failure) => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockRejectedValueOnce(failure)
    render(
      <ShiftSlideOver
        target={{ mode: 'create', participantId: 'participant-1' }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByText('Something went wrong saving this shift. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })

  it('keeps the 422 findings protocol first: the findings show, and the response\'s own errors line is not made the error', async () => {
    const user = userEvent.setup()
    const finding = makeFinding({ code: 'STAFF_LEAVE_PENDING', severity: 'Warning', message: 'Pending leave overlaps this window.', requiresReason: false })
    mockGetRosterFindings.mockReturnValueOnce([finding] as never)
    mockCreateMutateAsync.mockRejectedValueOnce({ response: { status: 422, data: { success: false, errors: ['Roster findings need review.'], data: [finding] } } })
    render(
      <ShiftSlideOver
        target={{ mode: 'create', participantId: 'participant-1' }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByText('Pending leave overlaps this window.')).toBeInTheDocument()
    expect(screen.queryByText('Roster findings need review.')).not.toBeInTheDocument()
    expect(screen.queryByText(GENERIC_SHIFT_ERROR)).not.toBeInTheDocument()
  })
})

describe('ShiftSlideOver — readiness note (WARN mode)', () => {
  const ISSUES = ['Intake not complete', 'No signed service agreement']
  const WARNING = 'Not ready: Intake not complete · No signed service agreement'

  it('shows the quiet warning directly under the Participant field, and the shift still saves with the same body', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockResolvedValueOnce(makeShift({ readinessIssues: ISSUES }))
    const onClose = vi.fn()
    const { container } = render(
      <ShiftSlideOver
        target={{ mode: 'create', participantId: 'participant-1', staffId: null, serviceDate: '2026-08-17' }}
        onClose={onClose}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
        participantReadiness={{ 'participant-1': ISSUES }}
      />,
    )

    const note = screen.getByText(WARNING)
    expect(note.closest('[title]')).toHaveAttribute('title', WARNING)
    // Under the Participant field, inside its own block, after the picker.
    const participantBlock = container.querySelector('[data-shift-field="participant"]') as HTMLElement
    expect(participantBlock).toContainElement(note)
    const picker = screen.getByLabelText(/^participant/i)
    expect(participantBlock).toContainElement(picker)
    expect(Boolean(picker.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    // Informational: not an alert, and Save is as available as ever.
    expect(note.closest('[role="alert"]')).toBeNull()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      staffId: null,
      serviceDate: '2026-08-17',
      startTime: '09:00',
      endTime: '09:00',
      endsNextDay: false,
      ratio: 'OneToOne',
      nightType: 'None',
      status: 'Draft',
      notes: null,
      overrideReason: null,
      acknowledgedFindingCodes: [],
    })
    expect(mockCreateMutateAsync.mock.calls[0][0]).not.toHaveProperty('readinessIssues')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('follows the participant dropdown: the warning of whoever is selected, nothing for a ready participant', async () => {
    const user = userEvent.setup()
    const options = [
      { value: 'p1', label: 'Mia Chen' },
      { value: 'p2', label: 'Noah Reid' },
      { value: 'p3', label: 'Ivy Tran' },
    ]
    render(
      <ShiftSlideOver
        target={{ mode: 'create', serviceDate: '2026-08-17' }}
        onClose={noop}
        canWrite
        participantOptions={options}
        staffOptions={staffOptions}
        participantReadiness={{
          p1: ['Intake not complete'],
          p2: [],
          p3: ['Onboarding not complete: profile', 'No signed service agreement'],
        }}
      />,
    )
    expect(screen.queryByText(/not ready/i)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText(/^participant/i))
    await user.click(screen.getByRole('option', { name: 'Mia Chen' }))
    expect(screen.getByText('Not ready: Intake not complete')).toBeInTheDocument()

    await user.click(screen.getByLabelText(/^participant/i))
    await user.click(screen.getByRole('option', { name: 'Noah Reid' }))
    expect(screen.queryByText(/not ready/i)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText(/^participant/i))
    await user.click(screen.getByRole('option', { name: 'Ivy Tran' }))
    expect(screen.getByText('Not ready: Onboarding not complete: profile · No signed service agreement')).toBeInTheDocument()
    expect(screen.queryByText('Not ready: Intake not complete')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled()
  })

  it('edit: falls back to the shift\'s own readinessIssues when the list does not know the participant', () => {
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift: makeShift({ readinessIssues: ['Intake not complete'] }) }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
        participantReadiness={{}}
      />,
    )

    expect(screen.getByText('Not ready: Intake not complete')).toBeInTheDocument()
  })

  it('edit: shows the shift\'s own readinessIssues when no list is given at all', () => {
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift: makeShift({ readinessIssues: ['No signed service agreement'] }) }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )

    expect(screen.getByText('Not ready: No signed service agreement')).toBeInTheDocument()
  })

  it('edit: a list that says the participant is ready wins over the shift\'s older snapshot', () => {
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift: makeShift({ readinessIssues: ['Intake not complete'] }) }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
        participantReadiness={{ 'participant-1': [] }}
      />,
    )

    expect(screen.queryByText(/not ready/i)).not.toBeInTheDocument()
  })

  it('draws nothing for a participant with no issues, with or without the prop', () => {
    const { rerender } = render(
      <ShiftSlideOver
        target={{ mode: 'create', participantId: 'participant-1' }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
      />,
    )
    expect(screen.queryByText(/not ready/i)).not.toBeInTheDocument()

    rerender(
      <ShiftSlideOver
        target={{ mode: 'create', participantId: 'participant-1' }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
        participantReadiness={{ 'participant-1': [] }}
      />,
    )
    expect(screen.queryByText(/not ready/i)).not.toBeInTheDocument()
  })

  it('never changes what Save is allowed to do: readiness issues alone never disable it, Blocking findings still do', () => {
    const { unmount } = render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift: makeShift({ findings: [], readinessIssues: ISSUES }) }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
        participantReadiness={{ 'participant-1': ISSUES }}
      />,
    )
    expect(screen.getByText(WARNING)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled()
    unmount()

    // A fresh mount (the board keys the panel by shift): the same warning alongside a Blocking finding still disables Save, for its own reason.
    render(
      <ShiftSlideOver
        target={{ mode: 'edit', shift: makeShift({ findings: [makeFinding({ severity: 'Blocking', message: 'Hard conflict' })], readinessIssues: ISSUES }) }}
        onClose={noop}
        canWrite
        participantOptions={participantOptions}
        staffOptions={staffOptions}
        participantReadiness={{ 'participant-1': ISSUES }}
      />,
    )
    expect(screen.getByText(WARNING)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })
})

// ── The live dry-run is gated too ────────────────────────────────────────────────────────────────────────────────────
// POST /rostering/shifts/check runs the same readiness gate as the save, so in Enforce mode (or for an inactive participant, in either
// mode) it answers 400 with the same message. The panel used to ignore a failed preview, so the user learned it only at Save.
describe('ShiftSlideOver — the live dry-run\'s refusal', () => {
  const twoParticipants = [
    { value: 'participant-1', label: 'Mia Chen' },
    { value: 'participant-2', label: 'Noah Reid' },
  ]
  type PreviewCallbacks = { onSuccess?: (findings: unknown[]) => void; onError?: (err: unknown) => void }

  afterEach(() => {
    mockCheckMutate.mockReset()
  })

  function renderCreate(participantOptionsToUse = twoParticipants) {
    return render(
      <ShiftSlideOver
        target={{ mode: 'create', participantId: 'participant-1', staffId: null, serviceDate: '2026-08-17' }}
        onClose={noop}
        canWrite
        participantOptions={participantOptionsToUse}
        staffOptions={staffOptions}
      />,
    )
  }

  it('shows the server\'s message as soon as the preview is refused, with no Save needed, and never disables Save', async () => {
    mockCheckMutate.mockImplementation((_candidate: unknown, opts?: PreviewCallbacks) => opts?.onError?.(badRequest(NOT_READY_MESSAGE)))
    renderCreate()

    const message = await screen.findByText(NOT_READY_MESSAGE)
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
    expect(mockCheckMutate).toHaveBeenCalledWith(
      { id: undefined, participantId: 'participant-1', staffId: null, serviceDate: '2026-08-17', startTime: '09:00', endTime: '09:00', endsNextDay: false, ratio: 'OneToOne', nightType: 'None' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled()
  })

  it('hides it the moment the candidate changes, and shows nothing once the new candidate previews fine', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((candidate: { participantId: string }, opts?: PreviewCallbacks) => {
      if (candidate.participantId === 'participant-1') opts?.onError?.(badRequest(NOT_READY_MESSAGE))
      else opts?.onSuccess?.([])
    })
    renderCreate()
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()

    await user.click(screen.getByLabelText(/^participant/i))
    await user.click(screen.getByRole('option', { name: 'Noah Reid' }))

    // Gone at once (it was about Mia), before the next preview has even been asked.
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
    await waitFor(() => expect(mockCheckMutate).toHaveBeenCalledWith(expect.objectContaining({ participantId: 'participant-2' }), expect.anything()))
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })

  it('never shows a late reply for an older candidate', async () => {
    const user = userEvent.setup()
    const pending: Array<{ candidate: { participantId: string }; opts: PreviewCallbacks }> = []
    mockCheckMutate.mockImplementation((candidate: { participantId: string }, opts?: PreviewCallbacks) => { pending.push({ candidate, opts: opts ?? {} }) })
    renderCreate()
    await waitFor(() => expect(pending).toHaveLength(1))

    await user.click(screen.getByLabelText(/^participant/i))
    await user.click(screen.getByRole('option', { name: 'Noah Reid' }))
    await waitFor(() => expect(pending).toHaveLength(2))

    // Mia's preview is refused after the user has moved on to Noah: it is about a candidate that is no longer on screen.
    await act(async () => { pending[0].opts.onError?.(badRequest(NOT_READY_MESSAGE)) })
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()

    // Noah's own refusal does show.
    await act(async () => { pending[1].opts.onError?.(badRequest('Participant is archived.')) })
    expect(await screen.findByText('Participant is archived.')).toBeInTheDocument()
  })

  it('says nothing when the preview fails without a server message (a network blip, a 500)', async () => {
    mockCheckMutate.mockImplementation((_candidate: unknown, opts?: PreviewCallbacks) => opts?.onError?.(new Error('Network Error')))
    renderCreate()

    await waitFor(() => expect(mockCheckMutate).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled()
  })

  it('shows the same message once, not twice, when the save is refused with it too, and the save still sends the full body', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_candidate: unknown, opts?: PreviewCallbacks) => opts?.onError?.(badRequest(NOT_READY_MESSAGE)))
    mockCreateMutateAsync.mockRejectedValueOnce(badRequest(NOT_READY_MESSAGE))
    renderCreate()
    await screen.findByText(NOT_READY_MESSAGE)

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      staffId: null,
      serviceDate: '2026-08-17',
      startTime: '09:00',
      endTime: '09:00',
      endsNextDay: false,
      ratio: 'OneToOne',
      nightType: 'None',
      status: 'Draft',
      notes: null,
      overrideReason: null,
      acknowledgedFindingCodes: [],
    })
    await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1))
    expect(screen.getAllByText(NOT_READY_MESSAGE)).toHaveLength(1)
  })

  it('clears a save\'s refusal when another participant is picked: it was about the participant it was for', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockRejectedValueOnce(badRequest(NOT_READY_MESSAGE))
    renderCreate()

    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()

    await user.click(screen.getByLabelText(/^participant/i))
    await user.click(screen.getByRole('option', { name: 'Noah Reid' }))

    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })
})

describe('ShiftSlideOver as a dialog', () => {
  const props = { canWrite: true, participantOptions, staffOptions }

  it('is a modal dialog named "Shift details" when editing and "New shift" when creating', () => {
    const { rerender } = render(<ShiftSlideOver {...props} target={{ mode: 'edit', shift: makeShift() }} onClose={noop} />)
    expect(screen.getByRole('dialog', { name: 'Shift details' })).toHaveAttribute('aria-modal', 'true')
    rerender(<ShiftSlideOver {...props} target={{ mode: 'create' }} onClose={noop} />)
    expect(screen.getByRole('dialog', { name: 'New shift' })).toBeInTheDocument()
  })

  it('renders nothing while there is no target', () => {
    render(<ShiftSlideOver {...props} target={null} onClose={noop} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Escape closes an untouched panel without asking', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ShiftSlideOver {...props} target={{ mode: 'edit', shift: makeShift() }} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('Escape after an edit asks "Discard changes?": Keep editing leaves the panel and the edit as they were, Discard closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ShiftSlideOver {...props} target={{ mode: 'edit', shift: makeShift() }} onClose={onClose} />)
    await user.type(screen.getByLabelText('Notes'), 'Bring the hoist sling')

    await user.keyboard('{Escape}')
    const prompt = screen.getByRole('alertdialog', { name: 'Discard changes?' })
    expect(onClose).not.toHaveBeenCalled()

    await user.click(within(prompt).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Shift details' })).toBeInTheDocument()
    expect(screen.getByLabelText('Notes')).toHaveValue('Bring the hoist sling')
    expect(onClose).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an edit that is typed and then undone is not an unsaved change', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ShiftSlideOver {...props} target={{ mode: 'edit', shift: makeShift() }} onClose={onClose} />)
    await user.type(screen.getByLabelText('Notes'), 'x')
    await user.clear(screen.getByLabelText('Notes'))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Cancel is an explicit discard: it closes at once even after an edit', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ShiftSlideOver {...props} target={{ mode: 'edit', shift: makeShift() }} onClose={onClose} />)
    await user.type(screen.getByLabelText('Notes'), 'x')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('a read-only panel has nothing to discard', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ShiftSlideOver {...props} canWrite={false} target={{ mode: 'edit', shift: makeShift() }} onClose={onClose} />)
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Delete opens a confirm dialog; Escape closes only that dialog, the panel stays open and Delete has focus again', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ShiftSlideOver {...props} target={{ mode: 'edit', shift: makeShift() }} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('alertdialog', { name: 'Delete shift' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Shift details' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
  })

  it('focus starts on the close button, or on the field named by focusField when the board prefilled the others', () => {
    const { unmount } = render(<ShiftSlideOver {...props} target={{ mode: 'create' }} onClose={noop} />)
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus()
    unmount()
    render(
      <ShiftSlideOver {...props} target={{ mode: 'create', participantId: 'participant-1', serviceDate: '2026-08-17', focusField: 'staff' }} onClose={noop} />,
    )
    expect(screen.getByRole('combobox', { name: 'Staff' })).toHaveFocus()
  })
})

// Plan builder phase D: a shift generated from an agreement's pattern carries what the agreement asks of a worker, and the panel shows it (informational: nothing checks it against the worker yet).
describe('ShiftSlideOver — what the shift asks of a worker', () => {
  const openShift = (requirements?: ShiftDto['requirements']) => render(
    <ShiftSlideOver
      target={{ mode: 'edit', shift: makeShift({ requirements }) }}
      onClose={noop}
      canWrite
      participantOptions={participantOptions}
      staffOptions={staffOptions}
    />,
  )

  it('shows a chip for each thing the shift asks of a worker, with a note that it is not checked yet', () => {
    openShift({ workerGender: 'Female', driver: true, skills: ['MedicationCompetent'] })

    const chips = within(screen.getByRole('list', { name: 'Asks for' }))
    expect(chips.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Female worker', 'Driver', 'Medication competent'])
    expect(screen.getByText('From the agreement. Shown, not checked against the worker yet.')).toBeInTheDocument()
  })

  it('shows nothing for a shift that asks for nothing, or has no requirements (a one-off, an older shift)', () => {
    const { unmount } = openShift({ workerGender: 'NoPreference', driver: false, skills: [] })
    expect(screen.queryByRole('list', { name: 'Asks for' })).not.toBeInTheDocument()
    unmount()

    openShift(undefined)
    expect(screen.queryByText('Asks for')).not.toBeInTheDocument()
  })
})

// The shifts an approval made sit on the board at the same times as the shifts of the revision before it: the panel says which agreement a shift came from, read only (nothing here changes it).
describe('ShiftSlideOver — which agreement a shift came from', () => {
  const agreementPattern = (version?: number): ShiftPatternDto => ({
    id: 'pattern-7', participantId: 'participant-1', participantName: 'Mia Chen', dayOfWeek: 'Monday', startTime: '09:00:00', endTime: '13:00:00', endsNextDay: false, ratio: 'OneToOne', nightType: 'None',
    effectiveFrom: '2026-10-01', isActive: true, sourceDraftId: 'draft-2', sourceBlockKey: 'b1', sourceDraftVersion: version, workerSlot: 1,
  } as ShiftPatternDto)

  const open = (shiftPatternId: string | null) => render(
    <ShiftSlideOver target={{ mode: 'edit', shift: makeShift({ shiftPatternId }) }} onClose={noop} canWrite participantOptions={participantOptions} staffOptions={staffOptions} />,
  )

  it('says "From agreement v2" for a shift made from an agreement pattern, and reads the pattern by the shift\'s own pattern id', () => {
    mockUsePattern.mockReturnValue({ data: agreementPattern(2) })
    open('pattern-7')

    expect(screen.getByText('From agreement v2')).toBeInTheDocument()
    expect(mockUsePattern).toHaveBeenCalledWith('pattern-7')
  })

  it('says "From an agreement" when the version is not known, and nothing for a hand-made pattern, a shift with no pattern, or while the pattern is still loading', () => {
    mockUsePattern.mockReturnValue({ data: agreementPattern(undefined) })
    const first = open('pattern-7')
    expect(screen.getByText('From an agreement')).toBeInTheDocument()
    first.unmount()

    mockUsePattern.mockReturnValue({ data: { ...agreementPattern(2), sourceDraftId: undefined, sourceDraftVersion: undefined } })
    const second = open('pattern-7')
    expect(screen.queryByText(/From agreement|From an agreement/)).not.toBeInTheDocument()
    second.unmount()

    mockUsePattern.mockReturnValue({ data: undefined })
    open(null)
    expect(screen.queryByText(/From agreement|From an agreement/)).not.toBeInTheDocument()
    expect(mockUsePattern).toHaveBeenLastCalledWith(undefined)                          // no pattern to ask for
  })
})
