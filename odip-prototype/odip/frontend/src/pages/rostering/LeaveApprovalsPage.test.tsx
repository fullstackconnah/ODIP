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

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

beforeEach(() => {
  localStorage.clear()
  // canApproveLeave gates the actions column and "Enter on behalf" (I-5) — default to a role
  // that can, so the rest of this suite's write-path tests keep working unchanged; the ReadOnly
  // case gets its own test below.
  setUserRole('Coordinator')
  mockUseLeaveRequests.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
  mockUseRecurringUnavailabilities.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
  mockApproveLeaveMutateAsync.mockReset()
  mockDeclineLeaveMutateAsync.mockReset()
  mockCancelLeaveMutateAsync.mockReset()
  mockApproveUnavailabilityMutateAsync.mockReset()
  mockDeclineUnavailabilityMutateAsync.mockReset()
  mockCancelUnavailabilityMutateAsync.mockReset()
  mockCreateLeaveOnBehalfMutateAsync.mockReset()
  mockCreateUnavailabilityOnBehalfMutateAsync.mockReset()
})

describe('LeaveApprovalsPage', () => {
  it('defaults the status filter to Pending', () => {
    renderPage()
    expect(mockUseLeaveRequests).toHaveBeenCalledWith(expect.objectContaining({ status: 'Pending' }))
    expect(mockUseRecurringUnavailabilities).toHaveBeenCalledWith(expect.objectContaining({ status: 'Pending' }))
  })

  it('gives the From/To date filters a visible, associated label', () => {
    renderPage()
    // getByLabelText requires an actual <label for>/aria-label association, not just nearby text.
    expect(screen.getByLabelText('From')).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText('To')).toHaveAttribute('type', 'date')
    expect(screen.getByText('From')).toBeVisible()
    expect(screen.getByText('To')).toBeVisible()
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
    const confirmDialog = screen.getByRole('alertdialog')
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
    const confirmDialog = screen.getByRole('alertdialog')
    await user.click(within(confirmDialog).getByRole('button', { name: /^approve$/i }))

    expect(await screen.findByText(/no rostered shifts or trips overlap this window/i)).toBeInTheDocument()
  })

  it('shows a server error and keeps the approve dialog open when the approve mutation rejects', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1', userFullName: 'Alex Rivera' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockApproveLeaveMutateAsync.mockRejectedValue({ response: { data: { message: 'This request has already been decided.' } } })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^approve$/i }))
    const confirmDialog = screen.getByRole('alertdialog')
    await user.click(within(confirmDialog).getByRole('button', { name: /^approve$/i }))

    expect(await within(confirmDialog).findByText(/this request has already been decided\./i)).toBeInTheDocument()
    // The approve dialog stays open (not the overlaps notice) and the row is unchanged — still
    // Pending, with its Approve/Decline actions intact — since the mutation never resolved.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument()
  })

  // Product ruling (2026-09-09): a decline reason is optional, not required — levelled down to
  // match cancel, which has never demanded one. Replaces the old "requires a decline reason
  // before submitting" test, which encoded the now-reversed rule.
  it('declines with a blank reason', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockDeclineLeaveMutateAsync.mockResolvedValue(makeLeaveRequest({ id: 'leave-1', status: 'Declined' }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /^decline$/i }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^decline$/i }))

    expect(mockDeclineLeaveMutateAsync).toHaveBeenCalledWith({ id: 'leave-1', data: { decisionNote: '' } })
  })

  it('declines with a note', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockDeclineLeaveMutateAsync.mockResolvedValue(makeLeaveRequest({ id: 'leave-1', status: 'Declined' }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /^decline$/i }))
    const dialog = screen.getByRole('alertdialog')
    await user.type(within(dialog).getByRole('textbox'), 'Short-staffed that week')
    await user.click(within(dialog).getByRole('button', { name: /^decline$/i }))

    expect(mockDeclineLeaveMutateAsync).toHaveBeenCalledWith({ id: 'leave-1', data: { decisionNote: 'Short-staffed that week' } })
  })

  it('cancels an already-approved request', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1', status: 'Approved' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockCancelLeaveMutateAsync.mockResolvedValue(makeLeaveRequest({ id: 'leave-1', status: 'Cancelled' }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /^cancel leave$/i }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^yes, cancel it$/i }))

    expect(mockCancelLeaveMutateAsync).toHaveBeenCalledWith('leave-1')
  })

  it('shows a server error and keeps the cancel dialog open when the cancel mutation rejects', async () => {
    const user = userEvent.setup()
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1', status: 'Approved', userFullName: 'Alex Rivera' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockCancelLeaveMutateAsync.mockRejectedValue({ response: { data: { message: 'Only pending requests can be withdrawn.' } } })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^cancel leave$/i }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^yes, cancel it$/i }))

    expect(await within(dialog).findByText(/only pending requests can be withdrawn\./i)).toBeInTheDocument()
    // The cancel dialog stays open and the row is unchanged — still Approved, with its own
    // Cancel action intact — since the mutation never resolved.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
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

  it('"Enter on behalf" — Regular unavailability requires a staff selection and posts to the unavailability-on-behalf endpoint', async () => {
    const user = userEvent.setup()
    mockCreateUnavailabilityOnBehalfMutateAsync.mockResolvedValue(makeRecurringRule({ status: 'Approved' }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /enter on behalf/i }))
    await user.click(screen.getByRole('option', { name: 'Regular unavailability' }))

    await user.click(screen.getByRole('combobox', { name: /staff member/i }))
    await user.click(screen.getByRole('option', { name: 'Alex Rivera' }))
    await user.type(screen.getByLabelText(/start time/i), '09:00')
    await user.type(screen.getByLabelText(/end time/i), '12:00')
    await user.type(screen.getByLabelText(/effective from/i), '2026-09-14')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockCreateUnavailabilityOnBehalfMutateAsync).toHaveBeenCalledWith({
      dayOfWeek: 'Monday', startTime: '09:00:00', endTime: '12:00:00', effectiveFrom: '2026-09-14', effectiveTo: null, notes: null, userId: 'staff-1',
    })
  })

  it('approves a recurring unavailability request via the unavailability approve endpoint (M-5)', async () => {
    const user = userEvent.setup()
    mockUseRecurringUnavailabilities.mockReturnValue({ data: [makeRecurringRule({ id: 'rule-1', userFullName: 'Jordan Smith' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockApproveUnavailabilityMutateAsync.mockResolvedValue({ unavailability: makeRecurringRule({ id: 'rule-1', status: 'Approved' }), overlaps: [] })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^approve$/i }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^approve$/i }))

    expect(mockApproveUnavailabilityMutateAsync).toHaveBeenCalledWith('rule-1')
    expect(await screen.findByText(/no rostered shifts or trips overlap this window/i)).toBeInTheDocument()
  })

  it('declines a recurring unavailability request with a note (M-5)', async () => {
    const user = userEvent.setup()
    mockUseRecurringUnavailabilities.mockReturnValue({ data: [makeRecurringRule({ id: 'rule-1' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockDeclineUnavailabilityMutateAsync.mockResolvedValue(makeRecurringRule({ id: 'rule-1', status: 'Declined' }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /^decline$/i }))
    const dialog = screen.getByRole('alertdialog')
    await user.type(within(dialog).getByRole('textbox'), 'Roster gap')
    await user.click(within(dialog).getByRole('button', { name: /^decline$/i }))

    expect(mockDeclineUnavailabilityMutateAsync).toHaveBeenCalledWith({ id: 'rule-1', data: { decisionNote: 'Roster gap' } })
  })

  it('cancels an already-approved recurring unavailability request (M-5)', async () => {
    const user = userEvent.setup()
    mockUseRecurringUnavailabilities.mockReturnValue({ data: [makeRecurringRule({ id: 'rule-1', status: 'Approved' })], isLoading: false, isError: false, refetch: vi.fn() })
    mockCancelUnavailabilityMutateAsync.mockResolvedValue(makeRecurringRule({ id: 'rule-1', status: 'Cancelled' }))
    renderPage()

    await user.click(screen.getByRole('button', { name: /^cancel rule$/i }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^yes, cancel it$/i }))

    expect(mockCancelUnavailabilityMutateAsync).toHaveBeenCalledWith('rule-1')
  })

  it('narrowing the date range drops an out-of-range recurring unavailability row while the list hook is still called with status/userId only (I-1)', async () => {
    const user = userEvent.setup()
    mockUseRecurringUnavailabilities.mockReturnValue({
      data: [
        makeRecurringRule({ id: 'rule-old', userFullName: 'Old Rule', effectiveFrom: '2026-08-01', effectiveTo: '2026-08-31' }),
        makeRecurringRule({ id: 'rule-ongoing', userFullName: 'Ongoing Rule', effectiveFrom: '2026-09-01', effectiveTo: null }),
      ],
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()

    expect(screen.getByText('Old Rule')).toBeInTheDocument()
    expect(screen.getByText('Ongoing Rule')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/^from$/i), '2026-09-01')

    expect(screen.queryByText('Old Rule')).not.toBeInTheDocument()
    expect(screen.getByText('Ongoing Rule')).toBeInTheDocument()

    // GET /leave/unavailability only binds status/userId server-side — from/to must never be sent.
    const lastCall = mockUseRecurringUnavailabilities.mock.calls.at(-1)?.[0]
    expect(lastCall).not.toHaveProperty('from')
    expect(lastCall).not.toHaveProperty('to')
  })

  it('hides approve/decline/cancel actions and "Enter on behalf", showing a read-only notice instead, for a ReadOnly viewer (I-5)', () => {
    setUserRole('ReadOnly')
    mockUseLeaveRequests.mockReturnValue({ data: [makeLeaveRequest({ id: 'leave-1', status: 'Pending' })], isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.queryByRole('button', { name: /enter on behalf/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^decline$/i })).not.toBeInTheDocument()
    expect(screen.getByText(/read-only access/i)).toBeInTheDocument()
  })
})
