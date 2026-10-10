import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StaffTab from './StaffTab'
import type { TripDetailDto } from '@/api/types/trips'
import type { StaffAssignmentDto } from '@/api/types/staff'
import { TAP_AREA } from '@/components/tapArea'

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

const trip = { id: 'trip-1', startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-05T00:00:00Z', staffRequired: null, calculatedStaffRequired: 0 } as TripDetailDto

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
  render(<StaffTab tripId="trip-1" trip={trip} staff={[]} canWrite />)
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

    render(<StaffTab tripId="trip-1" trip={trip} staff={[staffRow]} canWrite />)

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

    render(<StaffTab tripId="trip-1" trip={trip} staff={[staffRow]} canWrite />)

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
    render(<StaffTab tripId="trip-1" trip={trip} staff={[editableStaffRow]} canWrite />)

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
    render(<StaffTab tripId="trip-1" trip={trip} staff={[editableStaffRow]} canWrite />)

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
    render(<StaffTab tripId="trip-1" trip={trip} staff={[editableStaffRow]} canWrite />)

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
    render(<StaffTab tripId="trip-1" trip={trip} staff={[editableStaffRow]} canWrite />)

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

  it('preloads the stored override reason when reopening an assignment that already has one, and keeps the field visible once the finding that required it clears', async () => {
    const user = userEvent.setup()
    // No live findings on this dry-run — the finding that originally justified the override is
    // gone, but the assignment's own record still carries the reason from when it was made.
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => onSuccess([]))
    const staffRowWithReason = {
      ...editableStaffRow,
      overrideReason: 'Covering a last-minute shortfall.',
    } as StaffAssignmentDto
    render(<StaffTab tripId="trip-1" trip={trip} staff={[staffRowWithReason]} canWrite />)

    await user.click(screen.getByTitle('Edit assignment'))

    // forceVisible keeps the field showing and readable even with zero live findings, matching
    // ShiftSlideOver's existing/forceVisible pattern.
    expect(await screen.findByDisplayValue('Covering a last-minute shortfall.')).toBeInTheDocument()
  })

  it('does not silently blank a stored override reason on save when no live finding requires one any more', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => onSuccess([]))
    const staffRowWithReason = {
      ...editableStaffRow,
      overrideReason: 'Covering a last-minute shortfall.',
    } as StaffAssignmentDto
    render(<StaffTab tripId="trip-1" trip={trip} staff={[staffRowWithReason]} canWrite />)

    await user.click(screen.getByTitle('Edit assignment'))
    await screen.findByDisplayValue('Covering a last-minute shortfall.')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assign-1',
        data: expect.objectContaining({ overrideReason: 'Covering a last-minute shortfall.' }),
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
    render(<StaffTab tripId="trip-1" trip={trip} staff={[editableStaffRow]} canWrite />)

    await user.click(screen.getByTitle('Edit assignment'))
    // Wait for the 400ms-debounced live dry-run to fire before saving — same guard the add-modal
    // version of this test (below) already uses. Without it, the debounced check's onSuccess
    // (setEditFindings([])) can land AFTER the save's onError sets the server findings, wiping
    // them right back out — a real race that only showed up in a slower (deploy-image) container.
    await waitFor(() => expect(mockCheckMutate).toHaveBeenCalled())
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

// Density polish (touch): the Edit assignment / Remove from trip icon buttons were 22px on touch. They take the shared
// TAP_ICON_SQUARE (22px on a mouse as before; the 36px --control-h-sm square with a 44px hit area on touch), spaced by the
// row's 8px gap so the pads touch and never overlap.
describe('StaffTab — touch targets in the row actions', () => {
  const row = {
    id: 'assign-1', tripInstanceId: 'trip-1', tripName: 'Gold Coast Beach Break',
    staffId: 'staff-1', staffName: 'Alex Rivera', assignmentRole: 'Support Worker',
    assignmentStart: '2026-09-10', assignmentEnd: '2026-09-12', status: 'Confirmed',
    isDriver: false, sleepoverType: 'None', shiftNotes: null,
    hasConflict: false, overrideReason: null, acknowledgedFindingCodes: null,
  } as StaffAssignmentDto

  it('gives Edit assignment and Remove from trip the 44px touch shape without changing the mouse look', () => {
    render(<StaffTab tripId="trip-1" trip={trip} staff={[row]} canWrite />)

    for (const title of ['Edit assignment', 'Remove from trip']) {
      const button = screen.getByTitle(title)
      expect(button, title).toHaveClass(...TAP_AREA.split(' '))
      expect(button, title).toHaveClass('pointer-coarse:inline-flex', 'pointer-coarse:size-[var(--control-h-sm)]', 'pointer-coarse:items-center', 'pointer-coarse:justify-center', 'pointer-coarse:p-0')
      expect(button, title).toHaveClass('p-1', 'rounded', 'transition-colors')
    }
  })

  it('keeps the two buttons 8px apart in one centred row', () => {
    render(<StaffTab tripId="trip-1" trip={trip} staff={[row]} canWrite />)

    const cluster = screen.getByTitle('Edit assignment').parentElement as HTMLElement
    expect(cluster).toHaveClass('flex', 'items-center', 'justify-center', 'gap-2')
    expect(cluster).toContainElement(screen.getByTitle('Remove from trip'))
  })
})

// The staffing summary shows the figure the server sends as staffRequired (TripInstance.StaffRequired, the one the schedule screen uses). The tab used to sum the
// bookings' override ratios itself: a booking with no override counted 0 (the server uses the participant's ratio, else 1:1) and ratio Other counted 0 (the
// server counts 1), so a trip that needed 3 staff read a green "0/0 staff".
describe('StaffTab — the staffing summary shows what the server says the trip needs', () => {
  const tripNeeding = (calculatedStaffRequired: number, staffRequired: number | null) => ({ ...trip, calculatedStaffRequired, staffRequired }) as TripDetailDto

  it('shows 0 / 3 and "need 3 more" for a trip the server says needs 3, not a green 0/0', () => {
    render(<StaffTab tripId="trip-1" trip={tripNeeding(3, 3)} staff={[]} canWrite />)

    expect(screen.getByText('0 / 3 staff')).toBeInTheDocument()
    expect(screen.getByText(/need 3 more/i)).toBeInTheDocument()
  })

  it('shows the whole-staff figure the server sends, with the exact figure beside it, and does not work the whole figure out again', () => {
    render(<StaffTab tripId="trip-1" trip={tripNeeding(2.5, 4)} staff={[]} canWrite />)

    expect(screen.getByText('0 / 4 staff')).toBeInTheDocument()
    expect(screen.getByText(/2\.50 required from ratios/)).toBeInTheDocument()
  })

  it('shows the figure the server sends while no booking has set one (the trip\'s own minimum)', () => {
    render(<StaffTab tripId="trip-1" trip={tripNeeding(0, 2)} staff={[]} canWrite />)

    expect(screen.getByText('0 / 2 staff')).toBeInTheDocument()
  })

  it('shows ? when the server has no figure yet (nothing booked and no minimum), as the schedule screen does, not a 0 that reads as fully staffed', () => {
    render(<StaffTab tripId="trip-1" trip={tripNeeding(0, null)} staff={[]} canWrite />)

    expect(screen.getByText('0 / ? staff')).toBeInTheDocument()
  })
})
