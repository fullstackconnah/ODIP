import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShiftSlideOver } from './ShiftSlideOver'
import { makeShift, makeFinding } from '../test-fixtures'
import type { ParticipantRoutineDto } from '@/api/types'

const {
  mockCheckMutate, mockCreateMutateAsync, mockUpdateMutateAsync, mockDeleteMutateAsync, mockGetRosterFindings,
  mockUseParticipantRoutines,
} = vi.hoisted(() => ({
  mockCheckMutate: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockDeleteMutateAsync: vi.fn(),
  mockGetRosterFindings: vi.fn(() => null),
  mockUseParticipantRoutines: vi.fn(() => ({ data: [] as ParticipantRoutineDto[] })),
}))

// Only the API layer is mocked — every other collaborator (FindingsList, useSlideOverA11y,
// Dropdown, FormField) is the real component, so this exercises the actual override gate wiring.
vi.mock('@/api/hooks', () => ({
  useCheckShift: () => ({ mutate: mockCheckMutate, isPending: false }),
  useCreateShift: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateShift: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useDeleteShift: () => ({ mutateAsync: mockDeleteMutateAsync, isPending: false }),
  useParticipantRoutines: mockUseParticipantRoutines,
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

beforeEach(() => {
  mockCheckMutate.mockClear()
  mockCreateMutateAsync.mockClear()
  mockUpdateMutateAsync.mockClear()
  mockDeleteMutateAsync.mockClear()
  mockUseParticipantRoutines.mockReturnValue({ data: [] as ParticipantRoutineDto[] })
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
