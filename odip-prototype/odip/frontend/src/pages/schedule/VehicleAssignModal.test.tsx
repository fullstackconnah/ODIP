import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VehicleAssignModal from './VehicleAssignModal'
import type { ScheduleVehicleDto, ScheduleTripDto } from '@/api/types'

const { mockCheckMutate, mockGetRosterFindings } = vi.hoisted(() => ({
  mockCheckMutate: vi.fn(),
  mockGetRosterFindings: vi.fn(),
}))

// Only the API layer is mocked — FindingsList/RosterGateFields are the real components, so this
// exercises the actual findings rendering + override-gate wiring (same choice
// StaffAssignModal.test.tsx makes for the staff-side parity modal).
vi.mock('@/api/hooks', () => ({
  useCheckVehicleAssignment: () => ({ mutate: mockCheckMutate }),
  getRosterFindings: mockGetRosterFindings,
}))

const vehicle = { id: 'vehicle-1', vehicleName: 'Bus 1', registration: 'ABC123', totalSeats: 10, wheelchairPositions: 2 } as ScheduleVehicleDto
const trip = { id: 'trip-1', tripName: 'Gold Coast Beach Break', startDate: '2026-09-10', endDate: '2026-09-12', durationDays: 3 } as ScheduleTripDto

beforeEach(() => {
  mockCheckMutate.mockReset()
  mockGetRosterFindings.mockReset()
})

describe('VehicleAssignModal — live conflict check (trip-side parity with StaffAssignModal)', () => {
  it('renders findings returned by the live dry-run check on open', async () => {
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'VEHICLE_OVER_SEATS', severity: 'Warning', message: 'Bus 1 seats 10 but this trip has 12 participants.', requiresReason: true }])
    })
    render(<VehicleAssignModal vehicle={vehicle} trip={trip} staff={[]} onClose={vi.fn()} onAssign={vi.fn()} isLoading={false} />)

    expect(await screen.findByText(/but this trip has 12 participants/)).toBeInTheDocument()
  })

  it('requires a non-empty override reason before submitting when a finding requires one', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'VEHICLE_OVER_WHEELCHAIR', severity: 'Warning', message: 'Wheelchair overflow', requiresReason: true }])
    })
    const onAssign = vi.fn().mockResolvedValue(undefined)
    render(<VehicleAssignModal vehicle={vehicle} trip={trip} staff={[]} onClose={vi.fn()} onAssign={onAssign} isLoading={false} />)

    await screen.findByText('Wheelchair overflow')
    expect(screen.queryByText(/a reason is required to save over the warnings marked/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /assign with override/i }))

    expect(onAssign).not.toHaveBeenCalled()
    expect(screen.getByText(/a reason is required to save over the warnings marked/i)).toBeInTheDocument()
  })

  it('submits with overrideReason and acknowledgedFindingCodes once a reason is entered', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'VEHICLE_OVER_SEATS', severity: 'Warning', message: 'Seat overflow', requiresReason: true }])
    })
    const onAssign = vi.fn().mockResolvedValue(undefined)
    render(<VehicleAssignModal vehicle={vehicle} trip={trip} staff={[]} onClose={vi.fn()} onAssign={onAssign} isLoading={false} />)

    await screen.findByText('Seat overflow')
    await user.type(screen.getByPlaceholderText(/why this assignment should proceed/i), 'Approved by coordinator.')
    await user.click(screen.getByRole('button', { name: /assign with override/i }))

    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({
      overrideReason: 'Approved by coordinator.',
      acknowledgedFindingCodes: ['VEHICLE_OVER_SEATS'],
    }))
  })

  it('surfaces a blocking finding and disables submit', async () => {
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'VEHICLE_DOUBLE_BOOKED', severity: 'Blocking', message: 'Bus 1 is already assigned to a trip covering 10 Sep 2026-12 Sep 2026.', requiresReason: false }])
    })
    render(<VehicleAssignModal vehicle={vehicle} trip={trip} staff={[]} onClose={vi.fn()} onAssign={vi.fn()} isLoading={false} />)

    await screen.findByText(/already assigned to a trip covering/)
    expect(screen.getByRole('button', { name: /assign vehicle/i })).toBeDisabled()
  })

  it('surfaces server-rejected findings from a 422 on submit', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => onSuccess([]))
    const serverFindings = [{ code: 'VEHICLE_OVER_SEATS', severity: 'Warning', message: 'Seat overflow (server)', requiresReason: true }]
    mockGetRosterFindings.mockReturnValue(serverFindings)
    const onAssign = vi.fn().mockRejectedValue(new Error('422'))
    render(<VehicleAssignModal vehicle={vehicle} trip={trip} staff={[]} onClose={vi.fn()} onAssign={onAssign} isLoading={false} />)

    await user.click(screen.getByRole('button', { name: /assign vehicle/i }))

    expect(await screen.findByText('Seat overflow (server)')).toBeInTheDocument()
  })

  it('renders no reason field when no findings are present', async () => {
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => onSuccess([]))
    render(<VehicleAssignModal vehicle={vehicle} trip={trip} staff={[]} onClose={vi.fn()} onAssign={vi.fn()} isLoading={false} />)

    await screen.findByText(vehicle.vehicleName)
    expect(screen.queryByLabelText(/reason for override/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /assign vehicle/i })).not.toBeDisabled()
  })
})

describe('VehicleAssignModal — buttons are the Button primitive', () => {
  it('closes from the dialog Close button and from Cancel', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => onSuccess([]))
    const onClose = vi.fn()
    render(<VehicleAssignModal vehicle={vehicle} trip={trip} staff={[]} onClose={onClose} onAssign={vi.fn()} isLoading={false} />)

    const close = screen.getByRole('button', { name: 'Close dialog' })
    await user.click(close)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('draws Cancel and the submit button at --control-h', () => {
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => onSuccess([]))
    render(<VehicleAssignModal vehicle={vehicle} trip={trip} staff={[]} onClose={vi.fn()} onAssign={vi.fn()} isLoading={false} />)

    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const submit = screen.getByRole('button', { name: /assign vehicle/i })
    for (const button of [cancel, submit]) {
      expect(button).toHaveClass('h-[var(--control-h)]', 'rounded-[var(--radius-sm)]')
      expect(button.className).not.toMatch(/rounded-full|py-2\.5/)
    }
    expect(submit).toHaveAttribute('type', 'submit')
    expect(cancel).toHaveAttribute('type', 'button')
  })
})

describe('VehicleAssignModal — dialog behaviour', () => {
  it('is a named dialog that Escape closes, returning focus to the control that opened it', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Open it</button>
          {open && <VehicleAssignModal vehicle={vehicle} trip={trip} staff={[]} onClose={() => setOpen(false)} onAssign={vi.fn()} isLoading={false} />}
        </>
      )
    }
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open it' })
    await user.click(opener)
    expect(screen.getByRole('dialog', { name: 'Assign Vehicle' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
