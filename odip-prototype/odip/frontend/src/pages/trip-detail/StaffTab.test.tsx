import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StaffTab from './StaffTab'
import type { TripDetailDto } from '@/api/types/trips'

const { mockCreateMutate, mockUseAvailableStaff } = vi.hoisted(() => ({
  mockCreateMutate: vi.fn(),
  mockUseAvailableStaff: vi.fn(),
}))

// Only the API layer is mocked — DataTable, ConfirmDialog are the real components, so this
// exercises the actual Add Staff picker wiring (UX-01: migrated from a native <select> to
// SearchableSelect).
vi.mock('@/api/hooks', () => ({
  useUpdateStaffAssignment: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useDeleteStaffAssignment: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCreateStaffAssignment: () => ({ mutate: mockCreateMutate, isPending: false, isError: false }),
  useStaff: () => ({ data: [
    { id: 'staff-1', fullName: 'Alex Rivera' },
    { id: 'staff-2', fullName: 'Jo Lee' },
  ] }),
  useAvailableStaff: mockUseAvailableStaff,
}))

const trip = { id: 'trip-1', startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-05T00:00:00Z' } as TripDetailDto

beforeEach(() => {
  mockCreateMutate.mockReset()
  // Both staff are available for the trip dates by default — the "(Unavailable)" suffix is
  // covered separately from the picker migration itself.
  mockUseAvailableStaff.mockReturnValue({ data: [
    { id: 'staff-1', fullName: 'Alex Rivera' },
    { id: 'staff-2', fullName: 'Jo Lee' },
  ] })
})

function openAddStaffModal() {
  render(<StaffTab tripId="trip-1" trip={trip} staff={[]} bookings={[]} canWrite />)
  return userEvent.setup()
}

describe('StaffTab — UX-01 Add Staff picker (SearchableSelect)', () => {
  it('shows a combobox (not a native select) for Staff Member', async () => {
    const user = openAddStaffModal()
    await user.click(screen.getByRole('button', { name: /add staff/i }))

    expect(screen.getByRole('combobox', { name: 'Staff Member' })).toBeInTheDocument()
  })

  it('adds the selected staff member on submit', async () => {
    const user = openAddStaffModal()
    await user.click(screen.getByRole('button', { name: /add staff/i }))

    await user.click(screen.getByRole('combobox', { name: 'Staff Member' }))
    await user.click(screen.getByRole('option', { name: 'Jo Lee' }))
    // Two "Add Staff" buttons exist — the summary's open-modal trigger and the modal's own
    // submit button — the submit button is the one rendered last.
    const addStaffButtons = screen.getAllByRole('button', { name: /^add staff$/i })
    await user.click(addStaffButtons[addStaffButtons.length - 1])

    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ tripInstanceId: 'trip-1', staffId: 'staff-2' }),
      expect.anything(),
    )
  })

  it('selects a staff member via keyboard only (ArrowDown + Enter)', async () => {
    const user = openAddStaffModal()
    await user.click(screen.getByRole('button', { name: /add staff/i }))

    const staffPicker = screen.getByRole('combobox', { name: 'Staff Member' })
    await user.click(staffPicker)
    await user.keyboard('{ArrowDown}{Enter}')

    expect(staffPicker).toHaveValue('Alex Rivera')
  })
})
