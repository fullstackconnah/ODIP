import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import LeaveApprovalsPage from './LeaveApprovalsPage'
import { makeLeaveRequest, makeRecurringRule } from './test-fixtures-leave'
import type { StaffListDto } from '@/api/types'

// LeaveApprovalsPage renders LeaveRequestFormModal/UnavailabilityFormModal ("Enter on behalf"),
// which call useUnsavedChangesWarning — a data router is required (see Task 7's Interfaces
// section; mirrors VehicleCreatePage.test.tsx:3,13-20).
function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/rostering/leave', element: <LeaveApprovalsPage /> }],
    { initialEntries: ['/rostering/leave'] },
  )
  return render(<RouterProvider router={router} />)
}

const {
  mockUseLeaveRequests, mockUseRecurringUnavailabilities, mockUseStaff,
  mockApproveLeaveMutateAsync, mockDeclineLeaveMutateAsync, mockCancelLeaveMutateAsync,
  mockApproveUnavailabilityMutateAsync, mockDeclineUnavailabilityMutateAsync, mockCancelUnavailabilityMutateAsync,
  mockCreateLeaveOnBehalfMutateAsync, mockCreateUnavailabilityOnBehalfMutateAsync,
} = vi.hoisted(() => ({
  mockUseLeaveRequests: vi.fn(),
  mockUseRecurringUnavailabilities: vi.fn(),
  mockUseStaff: vi.fn(() => ({ data: [{ id: 'staff-1', fullName: 'Alex Rivera' }] as StaffListDto[] })),
  mockApproveLeaveMutateAsync: vi.fn(),
  mockDeclineLeaveMutateAsync: vi.fn(),
  mockCancelLeaveMutateAsync: vi.fn(),
  mockApproveUnavailabilityMutateAsync: vi.fn(),
  mockDeclineUnavailabilityMutateAsync: vi.fn(),
  mockCancelUnavailabilityMutateAsync: vi.fn(),
  mockCreateLeaveOnBehalfMutateAsync: vi.fn(),
  mockCreateUnavailabilityOnBehalfMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useLeaveRequests: mockUseLeaveRequests,
  useRecurringUnavailabilities: mockUseRecurringUnavailabilities,
  useStaff: mockUseStaff,
  useApproveLeave: () => ({ mutateAsync: mockApproveLeaveMutateAsync, isPending: false }),
  useDeclineLeave: () => ({ mutateAsync: mockDeclineLeaveMutateAsync, isPending: false }),
  useCancelLeave: () => ({ mutateAsync: mockCancelLeaveMutateAsync, isPending: false }),
  useApproveUnavailability: () => ({ mutateAsync: mockApproveUnavailabilityMutateAsync, isPending: false }),
  useDeclineUnavailability: () => ({ mutateAsync: mockDeclineUnavailabilityMutateAsync, isPending: false }),
  useCancelUnavailability: () => ({ mutateAsync: mockCancelUnavailabilityMutateAsync, isPending: false }),
  useCreateLeaveOnBehalf: () => ({ mutateAsync: mockCreateLeaveOnBehalfMutateAsync, isPending: false }),
  useCreateUnavailabilityOnBehalf: () => ({ mutateAsync: mockCreateUnavailabilityOnBehalfMutateAsync, isPending: false }),
}))

beforeEach(() => {
  mockUseLeaveRequests.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
  mockUseRecurringUnavailabilities.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
  mockApproveLeaveMutateAsync.mockReset()
  mockDeclineLeaveMutateAsync.mockReset()
  mockCancelLeaveMutateAsync.mockReset()
  mockApproveUnavailabilityMutateAsync.mockReset()
  mockDeclineUnavailabilityMutateAsync.mockReset()
  mockCreateLeaveOnBehalfMutateAsync.mockReset()
  mockCreateUnavailabilityOnBehalfMutateAsync.mockReset()
})

describe('LeaveApprovalsPage', () => {
  it('defaults the status filter to Pending', () => {
    renderPage()
    expect(mockUseLeaveRequests).toHaveBeenCalledWith(expect.objectContaining({ status: 'Pending' }))
    expect(mockUseRecurringUnavailabilities).toHaveBeenCalledWith(expect.objectContaining({ status: 'Pending' }))
  })

  it('renders both leave requests and recurring unavailability rows in one table', () => {
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ userFullName: 'Alex Rivera', leaveType: 'Sick' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockUseRecurringUnavailabilities.mockReturnValue({ data: [makeRecurringRule({ userFullName: 'Jordan Smith', dayOfWeek: 'Tuesday' })], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.getByText('Leave — Sick')).toBeInTheDocument()
    expect(screen.getByText('Jordan Smith')).toBeInTheDocument()
    expect(screen.getByText('Regular unavailability')).toBeInTheDocument()
  })

  it('approves a leave request and shows a follow-up notice listing the overlaps returned by the approve call', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1', userFullName: 'Alex Rivera' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockApproveLeaveMutateAsync.mockResolvedValue({
      leave: makeLeaveRequest({ id: 'leave-1', status: 'Approved' }),
      overlaps: [{ code: 'DOUBLE_BOOKED_SHIFT', severity: 'Warning', message: 'Overlaps a published shift.', requiresReason: false }],
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^approve$/i }))
    const confirmDialog = screen.getByRole('dialog')
    await user.click(within(confirmDialog).getByRole('button', { name: /^approve$/i }))

    expect(mockApproveLeaveMutateAsync).toHaveBeenCalledWith('leave-1')
    expect(await screen.findByText(/approved — this overlaps 1 rostered shift\/trip/i)).toBeInTheDocument()
    expect(screen.getByText('Overlaps a published shift.')).toBeInTheDocument()
  })

  it('approves a request with no overlaps and shows the plain success notice', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockApproveLeaveMutateAsync.mockResolvedValue({ leave: makeLeaveRequest({ id: 'leave-1', status: 'Approved' }), overlaps: [] })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^approve$/i }))
    const confirmDialog = screen.getByRole('dialog')
    await user.click(within(confirmDialog).getByRole('button', { name: /^approve$/i }))

    expect(await screen.findByText(/no rostered shifts or trips overlap this window/i)).toBeInTheDocument()
  })

  it('shows a server error and keeps the approve dialog open when the approve mutation rejects', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1', userFullName: 'Alex Rivera' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockApproveLeaveMutateAsync.mockRejectedValue({ response: { data: { message: 'This request has already been decided.' } } })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^approve$/i }))
    const confirmDialog = screen.getByRole('dialog')
    await user.click(within(confirmDialog).getByRole('button', { name: /^approve$/i }))

    expect(await within(confirmDialog).findByText(/this request has already been decided\./i)).toBeInTheDocument()
    // The approve dialog stays open (not the overlaps notice) and the row is unchanged — still
    // Pending, with its Approve/Decline actions intact — since the mutation never resolved.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument()
  })

  it('requires a decline reason before submitting', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1' })], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^decline$/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^decline$/i }))

    expect(mockDeclineLeaveMutateAsync).not.toHaveBeenCalled()
    expect(within(dialog).getByText(/a decline reason is required/i)).toBeInTheDocument()
  })

  it('declines with a note', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockDeclineLeaveMutateAsync.mockResolvedValue(makeLeaveRequest({ id: 'leave-1', status: 'Declined' }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /^decline$/i }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'Short-staffed that week')
    await user.click(within(dialog).getByRole('button', { name: /^decline$/i }))

    expect(mockDeclineLeaveMutateAsync).toHaveBeenCalledWith({ id: 'leave-1', data: { decisionNote: 'Short-staffed that week' } })
  })

  it('cancels an already-approved request', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1', status: 'Approved' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockCancelLeaveMutateAsync.mockResolvedValue(makeLeaveRequest({ id: 'leave-1', status: 'Cancelled' }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^cancel request$/i }))

    expect(mockCancelLeaveMutateAsync).toHaveBeenCalledWith('leave-1')
  })

  it('shows a server error and keeps the cancel dialog open when the cancel mutation rejects', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1', status: 'Approved', userFullName: 'Alex Rivera' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockCancelLeaveMutateAsync.mockRejectedValue({ response: { data: { message: 'Only pending requests can be withdrawn.' } } })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^cancel request$/i }))

    expect(await within(dialog).findByText(/only pending requests can be withdrawn\./i)).toBeInTheDocument()
    // The cancel dialog stays open and the row is unchanged — still Approved, with its own
    // Cancel action intact — since the mutation never resolved.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
  })

  it('"Enter on behalf" — Leave requires a staff selection and lands the request Approved via the on-behalf endpoint', async () => {
    const user = userEvent.setup()
    mockCreateLeaveOnBehalfMutateAsync.mockResolvedValue(makeLeaveRequest({ status: 'Approved' }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /enter on behalf/i }))
    await user.click(screen.getByRole('option', { name: 'Leave' }))

    await user.click(screen.getByRole('combobox', { name: /staff member/i }))
    await user.click(screen.getByRole('option', { name: 'Alex Rivera' }))
    await user.type(screen.getByLabelText(/start date/i), '2026-09-14')
    await user.type(screen.getByLabelText(/end date/i), '2026-09-18')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockCreateLeaveOnBehalfMutateAsync).toHaveBeenCalledWith({
      leaveType: 'Annual', startDate: '2026-09-14', endDate: '2026-09-18', reason: null, userId: 'staff-1',
    })
  })
})
