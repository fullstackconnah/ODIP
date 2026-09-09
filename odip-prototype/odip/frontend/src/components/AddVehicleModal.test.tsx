import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddVehicleModal from './AddVehicleModal'

const { mockCheckMutate, mockCreateAssignmentMutate, mockGetRosterFindings } = vi.hoisted(() => ({
  mockCheckMutate: vi.fn(),
  mockCreateAssignmentMutate: vi.fn(),
  mockGetRosterFindings: vi.fn(),
}))

// Only the API layer is mocked — RosterGateFields/FindingsList are the real components, so this
// exercises the actual findings rendering + override-gate wiring, mirroring StaffTab.test.tsx's
// "add modal live conflict gate" coverage for the trip-side parity modal.
vi.mock('@/api/hooks', () => ({
  useVehicles: () => ({ data: [
    { id: 'vehicle-1', vehicleName: 'Bus 1', registration: 'ABC123', vehicleType: 'Bus', totalSeats: 10, wheelchairPositions: 2, isActive: true },
    { id: 'vehicle-2', vehicleName: 'Van 2', registration: 'XYZ789', vehicleType: 'Van', totalSeats: 6, wheelchairPositions: 0, isActive: true },
  ] }),
  useCreateVehicleAssignment: () => ({ mutate: mockCreateAssignmentMutate, isPending: false, isError: false, reset: vi.fn() }),
  useCreateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, reset: vi.fn() }),
  useCheckVehicleAssignment: () => ({ mutate: mockCheckMutate }),
  getRosterFindings: mockGetRosterFindings,
}))

beforeEach(() => {
  mockCheckMutate.mockReset()
  mockCreateAssignmentMutate.mockReset()
  mockGetRosterFindings.mockReset()
})

function renderModal() {
  return render(
    <AddVehicleModal tripInstanceId="trip-1" assignedVehicleIds={new Set()} onClose={vi.fn()} />,
  )
}

describe('AddVehicleModal — Select Existing live conflict gate (trip-side parity)', () => {
  it('runs the live dry-run check with the selected vehicle/trip, rendering a requiresReason finding', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'VEHICLE_OVER_SEATS', severity: 'Warning', message: 'Bus 1 seats 10 but this trip has 12 participants.', requiresReason: true }])
    })
    renderModal()

    await user.click(screen.getByText('Bus 1'))

    await waitFor(() => expect(mockCheckMutate).toHaveBeenCalled())
    expect(mockCheckMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ vehicleId: 'vehicle-1', tripInstanceId: 'trip-1' }),
      expect.anything(),
    )
    expect(await screen.findByText(/but this trip has 12 participants/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/why this assignment should proceed/i)).toBeInTheDocument()
  })

  it('requires a non-empty override reason before submitting when a finding requires one', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'VEHICLE_OVER_WHEELCHAIR', severity: 'Warning', message: 'Wheelchair overflow', requiresReason: true }])
    })
    renderModal()

    await user.click(screen.getByText('Bus 1'))
    await screen.findByText('Wheelchair overflow')

    await user.click(screen.getByRole('button', { name: /assign with override/i }))

    expect(mockCreateAssignmentMutate).not.toHaveBeenCalled()
    expect(screen.getByText(/a reason is required to save over the warnings marked/i)).toBeInTheDocument()
  })

  it('submits with overrideReason and acknowledgedFindingCodes once a reason is entered', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'VEHICLE_OVER_SEATS', severity: 'Warning', message: 'Seat overflow', requiresReason: true }])
    })
    renderModal()

    await user.click(screen.getByText('Bus 1'))
    await screen.findByText('Seat overflow')
    await user.type(screen.getByPlaceholderText(/why this assignment should proceed/i), 'Approved by coordinator.')
    await user.click(screen.getByRole('button', { name: /assign with override/i }))

    expect(mockCreateAssignmentMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        tripInstanceId: 'trip-1',
        vehicleId: 'vehicle-1',
        overrideReason: 'Approved by coordinator.',
        acknowledgedFindingCodes: ['VEHICLE_OVER_SEATS'],
      }),
      expect.anything(),
    )
  })

  it('disables the submit button and shows the blocking alert when a finding is Blocking', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'VEHICLE_DOUBLE_BOOKED', severity: 'Blocking', message: 'Bus 1 is already assigned to a trip covering 10 Sep 2026-12 Sep 2026.', requiresReason: false }])
    })
    renderModal()

    await user.click(screen.getByText('Bus 1'))
    await screen.findByText(/already assigned to a trip covering/)

    expect(screen.getByRole('button', { name: /assign vehicle/i })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/can't be saved while a blocking finding is open/i)
  })

  it('surfaces server-rejected findings from a 422 on submit without a generic error alongside them', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => onSuccess([]))
    const serverFindings = [{ code: 'VEHICLE_OVER_SEATS', severity: 'Warning', message: 'Seat overflow (server)', requiresReason: true }]
    mockGetRosterFindings.mockReturnValue(serverFindings)
    mockCreateAssignmentMutate.mockImplementation((_vars, { onError }) => onError(new Error('422')))
    renderModal()

    await user.click(screen.getByText('Bus 1'))
    await waitFor(() => expect(mockCheckMutate).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /assign vehicle/i }))

    expect(await screen.findByText('Seat overflow (server)')).toBeInTheDocument()
    expect(screen.queryByText(/Failed to assign vehicle\. Please try again\./)).toBeNull()
  })

  it('renders no reason field and an enabled submit button when no findings are present', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => onSuccess([]))
    renderModal()

    await user.click(screen.getByText('Bus 1'))
    await waitFor(() => expect(mockCheckMutate).toHaveBeenCalled())

    expect(screen.queryByPlaceholderText(/why this assignment should proceed/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /assign vehicle/i })).not.toBeDisabled()
  })
})
