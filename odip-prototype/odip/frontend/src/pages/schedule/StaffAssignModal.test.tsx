import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StaffAssignModal from './StaffAssignModal'
import type { ScheduleStaffDto, ScheduleTripDto } from '@/api/types'

const { mockCheckMutate, mockGetRosterFindings } = vi.hoisted(() => ({
  mockCheckMutate: vi.fn(),
  mockGetRosterFindings: vi.fn(),
}))

// Only the API layer is mocked — FindingsList is the real component, so this exercises the
// actual findings rendering + override-gate wiring (same choice ShiftSlideOver.test.tsx makes).
vi.mock('@/api/hooks', () => ({
  useCheckStaffAssignment: () => ({ mutate: mockCheckMutate }),
  getRosterFindings: mockGetRosterFindings,
}))

const staff = { id: 'staff-1', fullName: 'Alex Rivera', isDriverEligible: true } as ScheduleStaffDto
const trip = { id: 'trip-1', tripName: 'Gold Coast Beach Break', startDate: '2026-09-10', endDate: '2026-09-12', durationDays: 3 } as ScheduleTripDto

beforeEach(() => {
  mockCheckMutate.mockReset()
  mockGetRosterFindings.mockReset()
})

describe('StaffAssignModal — live conflict check (trip-side parity)', () => {
  it('renders findings returned by the live dry-run check on open', async () => {
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: "Alex Rivera's approved leave covers this window — cannot roster without a reason.", requiresReason: true }])
    })
    render(<StaffAssignModal staff={staff} trip={trip} onClose={vi.fn()} onAssign={vi.fn()} isLoading={false} />)

    expect(await screen.findByText(/approved leave covers this window/)).toBeInTheDocument()
  })

  it('requires a non-empty override reason before submitting when a finding requires one', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap', requiresReason: true }])
    })
    const onAssign = vi.fn().mockResolvedValue(undefined)
    render(<StaffAssignModal staff={staff} trip={trip} onClose={vi.fn()} onAssign={onAssign} isLoading={false} />)

    await screen.findByText('Leave overlap')
    expect(screen.queryByText(/a reason is required to save over the warnings marked/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /assign with override/i }))

    expect(onAssign).not.toHaveBeenCalled()
    expect(screen.getByText(/a reason is required to save over the warnings marked/i)).toBeInTheDocument()
  })

  it('submits with overrideReason and acknowledgedFindingCodes once a reason is entered', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap', requiresReason: true }])
    })
    const onAssign = vi.fn().mockResolvedValue(undefined)
    render(<StaffAssignModal staff={staff} trip={trip} onClose={vi.fn()} onAssign={onAssign} isLoading={false} />)

    await screen.findByText('Leave overlap')
    await user.type(screen.getByPlaceholderText(/why this assignment should proceed/i), 'Covering a shortfall.')
    await user.click(screen.getByRole('button', { name: /assign with override/i }))

    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({
      overrideReason: 'Covering a shortfall.',
      acknowledgedFindingCodes: ['STAFF_ON_LEAVE'],
    }))
  })

  it('surfaces a blocking finding and disables submit', async () => {
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([{ code: 'WSC_EXPIRED', severity: 'Blocking', message: 'Worker screening expired.', requiresReason: false }])
    })
    render(<StaffAssignModal staff={staff} trip={trip} onClose={vi.fn()} onAssign={vi.fn()} isLoading={false} />)

    await screen.findByText('Worker screening expired.')
    expect(screen.getByRole('button', { name: /assign staff/i })).toBeDisabled()
  })

  it('surfaces server-rejected findings from a 422 on submit', async () => {
    const user = userEvent.setup()
    mockCheckMutate.mockImplementation((_vars, { onSuccess }) => onSuccess([]))
    const serverFindings = [{ code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Leave overlap (server)', requiresReason: true }]
    mockGetRosterFindings.mockReturnValue(serverFindings)
    const onAssign = vi.fn().mockRejectedValue(new Error('422'))
    render(<StaffAssignModal staff={staff} trip={trip} onClose={vi.fn()} onAssign={onAssign} isLoading={false} />)

    await user.click(screen.getByRole('button', { name: /assign staff/i }))

    expect(await screen.findByText('Leave overlap (server)')).toBeInTheDocument()
  })
})
