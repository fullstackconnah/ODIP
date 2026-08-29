import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShiftSlideOver } from './ShiftSlideOver'
import { makeShift, makeFinding } from '../test-fixtures'

const {
  mockCheckMutate, mockCreateMutateAsync, mockUpdateMutateAsync, mockDeleteMutateAsync, mockGetRosterFindings,
} = vi.hoisted(() => ({
  mockCheckMutate: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockDeleteMutateAsync: vi.fn(),
  mockGetRosterFindings: vi.fn(() => null),
}))

// Only the API layer is mocked — every other collaborator (FindingsList, useSlideOverA11y,
// Dropdown, FormField) is the real component, so this exercises the actual override gate wiring.
vi.mock('@/api/hooks', () => ({
  useCheckShift: () => ({ mutate: mockCheckMutate, isPending: false }),
  useCreateShift: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateShift: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useDeleteShift: () => ({ mutateAsync: mockDeleteMutateAsync, isPending: false }),
  getRosterFindings: mockGetRosterFindings,
}))

function noop() {}

const participantOptions = [{ value: 'participant-1', label: 'Mia Chen' }]
const staffOptions = [{ value: 'staff-1', label: 'Alex Rivera' }]

beforeEach(() => {
  mockCheckMutate.mockClear()
  mockCreateMutateAsync.mockClear()
  mockUpdateMutateAsync.mockClear()
  mockDeleteMutateAsync.mockClear()
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
