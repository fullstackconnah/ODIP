import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import AvailabilityEditor from './AvailabilityEditor'
import type { StaffAvailabilityDto } from '@/api/types'

const { mockUpdateMutate, mockDeleteMutate } = vi.hoisted(() => ({
  mockUpdateMutate: vi.fn(),
  mockDeleteMutate: vi.fn(),
}))

vi.mock('../../api/hooks', () => ({
  useUpdateStaffAvailability: () => ({ mutate: mockUpdateMutate, isPending: false }),
  useDeleteStaffAvailability: () => ({ mutate: mockDeleteMutate, isPending: false }),
}))

function makeAvailability(overrides: Partial<StaffAvailabilityDto> = {}): StaffAvailabilityDto {
  return {
    id: 'avail-1',
    staffId: 'staff-1',
    startDateTime: '2026-09-01T00:00:00',
    endDateTime: '2026-09-05T23:59:59',
    availabilityType: 'Unavailable',
    isRecurring: false,
    recurrenceNotes: null,
    notes: null,
    ...overrides,
  }
}

function renderEditor(availability: StaffAvailabilityDto[] = []) {
  render(
    <MemoryRouter>
      <AvailabilityEditor staffId="staff-1" staffName="Alex Rivera" availability={availability} />
    </MemoryRouter>,
  )
}

describe('AvailabilityEditor — Leave creation removed', () => {
  it('renders no "Add Leave" action', () => {
    renderEditor([makeAvailability()])
    expect(screen.queryByRole('button', { name: /add leave/i })).not.toBeInTheDocument()
  })

  it('links to /rostering/leave from the header', () => {
    renderEditor([makeAvailability()])
    expect(screen.getByRole('link', { name: /manage leave requests/i })).toHaveAttribute('href', '/rostering/leave')
  })

  it('links to /rostering/leave from the empty state', () => {
    renderEditor([])
    expect(screen.getByRole('link', { name: /leave approvals/i })).toHaveAttribute('href', '/rostering/leave')
  })

  it('still renders and lets a coordinator delete an existing legacy availability record', () => {
    renderEditor([makeAvailability()])
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByTitle('Delete')).toBeInTheDocument()
  })
})

describe('AvailabilityEditor — invalid date range validation', () => {
  it('surfaces a visible error and does not save when the end date is before the start date', async () => {
    const user = userEvent.setup()
    renderEditor([makeAvailability()])

    const [startInput, endInput] = screen.getAllByDisplayValue(/2026-09-0[15]/)
    await user.clear(endInput)
    await user.type(endInput, '2026-08-31')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/end date must be on or after the start date/i)
    expect(mockUpdateMutate).not.toHaveBeenCalled()
    expect(startInput).toHaveAttribute('aria-invalid', 'true')
    expect(endInput).toHaveAttribute('aria-invalid', 'true')
  })

  it('clears the error once the range is corrected and save succeeds', async () => {
    const user = userEvent.setup()
    renderEditor([makeAvailability()])

    const [, endInput] = screen.getAllByDisplayValue(/2026-09-0[15]/)
    await user.clear(endInput)
    await user.type(endInput, '2026-08-31')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.clear(endInput)
    await user.type(endInput, '2026-09-10')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mockUpdateMutate).toHaveBeenCalledTimes(1)
  })
})
