import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
