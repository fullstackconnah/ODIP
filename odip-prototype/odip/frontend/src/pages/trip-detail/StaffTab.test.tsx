import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StaffTab from './StaffTab'
import type { TripDetailDto } from '@/api/types/trips'
import type { StaffAssignmentDto } from '@/api/types/staff'

const { mockCreateMutate, mockUpdateMutate, mockCheckMutate, mockGetRosterFindings, mockUseAvailableStaff } = vi.hoisted(() => ({
  mockCreateMutate: vi.fn(),
  mockUpdateMutate: vi.fn(),
  mockCheckMutate: vi.fn(),
  mockGetRosterFindings: vi.fn(),
  mockUseAvailableStaff: vi.fn(),
}))

// Only the API layer is mocked — DataTable, ConfirmDialog, FindingsList, RosterGateFields are the
// real components, so this exercises the actual Add Staff picker wiring (UX-01: migrated from a
// native <select> to SearchableSelect) and the actual edit-modal conflict-gate wiring (same choice
// StaffAssignModal.test.tsx makes for its own live-check tests).
vi.mock('@/api/hooks', () => ({
  useUpdateStaffAssignment: () => ({ mutate: mockUpdateMutate, isPending: false, isError: false }),
  useDeleteStaffAssignment: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCreateStaffAssignment: () => ({ mutate: mockCreateMutate, isPending: false, isError: false }),
  useCheckStaffAssignment: () => ({ mutate: mockCheckMutate }),
  getRosterFindings: mockGetRosterFindings,
  useStaff: () => ({ data: [
    { id: 'staff-1', fullName: 'Alex Rivera' },
    { id: 'staff-2', fullName: 'Jo Lee' },
  ] }),
  useAvailableStaff: mockUseAvailableStaff,
}))

const trip = { id: 'trip-1', startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-05T00:00:00Z' } as TripDetailDto

beforeEach(() => {
  mockCreateMutate.mockReset()
  mockUpdateMutate.mockReset()
  mockCheckMutate.mockReset()
  mockGetRosterFindings.mockReset()
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

describe('StaffTab — acknowledged-conflict marker (trip-side parity)', () => {
  it('shows the stored override reason on hover for a staff row with hasConflict', () => {
    const staffRow = {
      id: 'assign-1', tripInstanceId: 'trip-1', tripName: 'Gold Coast Beach Break',
      staffId: 'staff-1', staffName: 'Alex Rivera', assignmentRole: 'Support Worker',
      assignmentStart: '2026-09-10', assignmentEnd: '2026-09-12', status: 'Confirmed',
      isDriver: false, sleepoverType: 'None', shiftNotes: null,
      hasConflict: true, overrideReason: 'Covering a last-minute shortfall.', acknowledgedFindingCodes: 'STAFF_ON_LEAVE',
    } as StaffAssignmentDto

    render(<StaffTab tripId="trip-1" trip={trip} staff={[staffRow]} bookings={[]} canWrite />)

    expect(screen.getByTitle('Overridden: Covering a last-minute shortfall.')).toBeInTheDocument()
  })

  it('falls back to a generic label when hasConflict is true but overrideReason is somehow absent', () => {
    const staffRow = {
      id: 'assign-1', tripInstanceId: 'trip-1', tripName: 'Gold Coast Beach Break',
      staffId: 'staff-1', staffName: 'Alex Rivera', assignmentRole: 'Support Worker',
      assignmentStart: '2026-09-10', assignmentEnd: '2026-09-12', status: 'Confirmed',
      isDriver: false, sleepoverType: 'None', shiftNotes: null,
      hasConflict: true, overrideReason: null, acknowledgedFindingCodes: null,
    } as StaffAssignmentDto

    render(<StaffTab tripId="trip-1" trip={trip} staff={[staffRow]} bookings={[]} canWrite />)

    expect(screen.getByTitle('Conflict acknowledged')).toBeInTheDocument()
  })
})

describe('StaffTab — edit modal live conflict gate (trip-side parity)', () => {
  const editableStaffRow = {
    id: 'assign-1', tripInstanceId: 'trip-1', tripName: 'Gold Coast Beach Break',
    staffId: 'staff-1', staffName: 'Alex Rivera', assignmentRole: 'Support Worker',
    assignmentStart: '2026-09-10', assignmentEnd: '2026-09-12', status: 'Confirmed',
    isDriver: false, sleepoverType: 'None', shiftNotes: null,
    hasConflict: false, overrideReason: null, acknowledgedFindingCodes: null,
  } as StaffAssignmentDto

  it('renders findings from the live dry-run check when the edit modal opens', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: "Alex Rivera's approved leave covers this window — cannot roster without a reason.", requiresReason: true }])
    })
    render(<StaffTab tripId="trip-1" trip={trip} staff={[editableStaffRow]} bookings={[]} canWrite />)

    await user.click(screen.getByTitle('Edit assignment'))

    expect(await screen.findByText(/approved leave covers this window/)).toBeInTheDocument()
  })

  it('re-runs the dry-run check when Assignment Start/End are edited', async () => {
    const user = userEvent.setup()
    mockCheckMutate
      .mockImplementationOnce((_vars, { onSuccess }) => {
        onSuccess([{ code: 'WSC_EXPIRED', severity: 'Blocking', message: 'Worker screening expired.', requiresReason: false }])
      })
      .mockImplementationOnce((_vars, { onSuccess }) => {
        onSuccess([])
      })
    render(<StaffTab tripId="trip-1" trip={trip} staff={[editableStaffRow]} bookings={[]} canWrite />)

    await user.click(screen.getByTitle('Edit assignment'))
    await screen.findByText('Worker screening expired.')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()

    fireEvent.change(screen.getByDisplayValue('2026-09-10'), { target: { value: '2026-09-15' } })

    await waitFor(() => expect(mockCheckMutate).toHaveBeenCalledTimes(2))
    expect(mockCheckMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ assignmentStart: '2026-09-15' }),
      expect.anything(),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled())
  })

  it('requires a non-empty override reason before submitting when a finding requires one', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap', requiresReason: true }])
    })
    render(<StaffTab tripId="trip-1" trip={trip} staff={[editableStaffRow]} bookings={[]} canWrite />)

    await user.click(screen.getByTitle('Edit assignment'))
    await screen.findByText('Leave overlap')
    expect(screen.queryByText(/a reason is required to save over the warnings marked/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /save with override/i }))

    expect(mockUpdateMutate).not.toHaveBeenCalled()
    expect(screen.getByText(/a reason is required to save over the warnings marked/i)).toBeInTheDocument()
  })

  it('submits with overrideReason and acknowledgedFindingCodes once a reason is entered', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap', requiresReason: true }])
    })
    render(<StaffTab tripId="trip-1" trip={trip} staff={[editableStaffRow]} bookings={[]} canWrite />)

    await user.click(screen.getByTitle('Edit assignment'))
    await screen.findByText('Leave overlap')
    await user.type(screen.getByPlaceholderText(/why this assignment should proceed/i), 'Covering a shortfall.')
    await user.click(screen.getByRole('button', { name: /save with override/i }))

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assign-1',
        data: expect.objectContaining({
          overrideReason: 'Covering a shortfall.',
          acknowledgedFindingCodes: ['STAFF_ON_LEAVE'],
        }),
      }),
      expect.anything(),
    )
  })

  it('surfaces server-rejected findings from a 422 on submit', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => onSuccess([]))
    const serverFindings = [{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap (server)', requiresReason: true }]
    mockGetRosterFindings.mockReturnValue(serverFindings)
    mockUpdateMutate.mockImplementation((_vars, { onError }) => onError(new Error('422')))
    render(<StaffTab tripId="trip-1" trip={trip} staff={[editableStaffRow]} bookings={[]} canWrite />)

    await user.click(screen.getByTitle('Edit assignment'))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText('Leave overlap (server)')).toBeInTheDocument()
    expect(screen.queryByText(/Failed to update assignment/)).toBeNull()
  })
})

describe('StaffTab — add modal live conflict gate (trip-side parity)', () => {
  function lastAddStaffButton() {
    const buttons = screen.getAllByRole('button', { name: /^add staff$|add with override/i })
    return buttons[buttons.length - 1]
  }

  it('runs the live dry-run check with the selected staff/trip and no excludeAssignmentId, rendering a requiresReason finding', async () => {
    const user = openAddStaffModal()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: "Jo Lee's approved leave covers this window — cannot roster without a reason.", requiresReason: true }])
    })
    await user.click(screen.getByRole('button', { name: /add staff/i }))

    await user.click(screen.getByRole('combobox', { name: 'Staff Member' }))
    await user.click(screen.getByRole('option', { name: 'Jo Lee' }))

    await waitFor(() => expect(mockCheckMutate).toHaveBeenCalled())
    expect(mockCheckMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ staffId: 'staff-2', tripInstanceId: 'trip-1' }),
      expect.anything(),
    )
    expect(mockCheckMutate.mock.calls.at(-1)?.[0]).not.toHaveProperty('excludeAssignmentId')

    expect(await screen.findByText(/approved leave covers this window/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/why this assignment should proceed/i)).toBeInTheDocument()
  })

  it('requires a non-empty override reason before submitting when a finding requires one', async () => {
    const user = openAddStaffModal()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap', requiresReason: true }])
    })
    await user.click(screen.getByRole('button', { name: /add staff/i }))
    await user.click(screen.getByRole('combobox', { name: 'Staff Member' }))
    await user.click(screen.getByRole('option', { name: 'Jo Lee' }))
    await screen.findByText('Leave overlap')

    await user.click(lastAddStaffButton())

    expect(mockCreateMutate).not.toHaveBeenCalled()
    expect(screen.getByText(/a reason is required to save over the warnings marked/i)).toBeInTheDocument()
  })

  it('submits with overrideReason and acknowledgedFindingCodes once a reason is entered', async () => {
    const user = openAddStaffModal()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap', requiresReason: true }])
    })
    await user.click(screen.getByRole('button', { name: /add staff/i }))
    await user.click(screen.getByRole('combobox', { name: 'Staff Member' }))
    await user.click(screen.getByRole('option', { name: 'Jo Lee' }))
    await screen.findByText('Leave overlap')

    await user.type(screen.getByPlaceholderText(/why this assignment should proceed/i), 'Covering shortfall')
    await user.click(screen.getByRole('button', { name: /add with override/i }))

    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ overrideReason: 'Covering shortfall', acknowledgedFindingCodes: ['STAFF_ON_LEAVE'] }),
      expect.anything(),
    )
  })

  it('disables the submit button and shows the blocking alert when a finding is Blocking', async () => {
    const user = openAddStaffModal()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'WSC_EXPIRED', severity: 'Blocking', message: 'Worker screening expired.', requiresReason: false }])
    })
    await user.click(screen.getByRole('button', { name: /add staff/i }))
    await user.click(screen.getByRole('combobox', { name: 'Staff Member' }))
    await user.click(screen.getByRole('option', { name: 'Jo Lee' }))
    await screen.findByText('Worker screening expired.')

    expect(lastAddStaffButton()).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/can't be saved while a blocking finding is open/i)
  })

  it('surfaces server-rejected findings from a 422 on submit without a generic error alongside them', async () => {
    const user = openAddStaffModal()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => onSuccess([]))
    const serverFindings = [{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap (server)', requiresReason: true }]
    mockGetRosterFindings.mockReturnValue(serverFindings)
    mockCreateMutate.mockImplementation((_vars, { onError }) => onError(new Error('422')))
    await user.click(screen.getByRole('button', { name: /add staff/i }))
    await user.click(screen.getByRole('combobox', { name: 'Staff Member' }))
    await user.click(screen.getByRole('option', { name: 'Jo Lee' }))
    await waitFor(() => expect(mockCheckMutate).toHaveBeenCalled())

    await user.click(lastAddStaffButton())

    expect(await screen.findByText('Leave overlap (server)')).toBeInTheDocument()
    expect(screen.queryByText(/Failed to add staff/)).toBeNull()
  })
})
