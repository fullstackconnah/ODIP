import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import PortalLeavePage from './PortalLeavePage'
import { makeLeaveRequest, makeRecurringRule } from '@/pages/rostering/test-fixtures-leave'

const {
  mockUseMyLeave, mockCreateLeaveMutateAsync, mockCancelLeaveMutateAsync,
  mockCreateUnavailabilityMutateAsync, mockCancelUnavailabilityMutateAsync,
} = vi.hoisted(() => ({
  mockUseMyLeave: vi.fn(),
  mockCreateLeaveMutateAsync: vi.fn(),
  mockCancelLeaveMutateAsync: vi.fn(),
  mockCreateUnavailabilityMutateAsync: vi.fn(),
  mockCancelUnavailabilityMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useMyLeave: mockUseMyLeave,
  useCreateLeaveRequest: () => ({ mutateAsync: mockCreateLeaveMutateAsync, isPending: false }),
  useCancelMyLeave: () => ({ mutateAsync: mockCancelLeaveMutateAsync, isPending: false }),
  useCreateMyUnavailability: () => ({ mutateAsync: mockCreateUnavailabilityMutateAsync, isPending: false }),
  useCancelMyUnavailability: () => ({ mutateAsync: mockCancelUnavailabilityMutateAsync, isPending: false }),
}))

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

// PortalLeavePage renders LeaveRequestFormModal/UnavailabilityFormModal, which call
// useUnsavedChangesWarning — a data router is required (see Task 7's Interfaces section; mirrors
// VehicleCreatePage.test.tsx:3,13-20).
function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/portal/leave', element: <PortalLeavePage /> }],
    { initialEntries: ['/portal/leave'] },
  )
  render(<RouterProvider router={router} />)
}

beforeEach(() => {
  localStorage.clear()
  setUserRole('SupportWorker')
  mockUseMyLeave.mockReturnValue({ data: { leave: [], unavailability: [] }, isLoading: false, isError: false, refetch: vi.fn() })
  mockCreateLeaveMutateAsync.mockReset()
  mockCancelLeaveMutateAsync.mockReset()
  mockCreateUnavailabilityMutateAsync.mockReset()
  mockCancelUnavailabilityMutateAsync.mockReset()
})

describe('PortalLeavePage', () => {
  it('renders an empty state on the Leave tab with no requests', () => {
    renderPage()
    expect(screen.getByText(/no leave requests yet/i)).toBeInTheDocument()
  })

  it('lists the caller\'s own leave requests with status', () => {
    mockUseMyLeave.mockReturnValue({
      data: { leave: [makeLeaveRequest({ id: 'leave-1', leaveType: 'Sick', status: 'Approved' })], unavailability: [] },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('Sick')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
  })

  it('shows the decision note on a declined leave row', () => {
    mockUseMyLeave.mockReturnValue({
      data: { leave: [makeLeaveRequest({ status: 'Declined', decisionNote: 'Insufficient notice' })], unavailability: [] },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('Insufficient notice')).toBeInTheDocument()
  })

  it('switches to the Regular unavailability tab and lists rules', async () => {
    const user = userEvent.setup()
    mockUseMyLeave.mockReturnValue({
      data: { leave: [], unavailability: [makeRecurringRule({ dayOfWeek: 'Tuesday', status: 'Pending' })] },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Regular unavailability' }))
    expect(screen.getByText('Tuesday')).toBeInTheDocument()
  })

  it('opens the leave request form and submits a new request', async () => {
    const user = userEvent.setup()
    mockCreateLeaveMutateAsync.mockResolvedValue(makeLeaveRequest())
    renderPage()

    await user.click(screen.getByRole('button', { name: /request leave/i }))
    await user.type(screen.getByLabelText(/start date/i), '2026-09-14')
    await user.type(screen.getByLabelText(/end date/i), '2026-09-18')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    expect(mockCreateLeaveMutateAsync).toHaveBeenCalledWith({
      leaveType: 'Annual', startDate: '2026-09-14', endDate: '2026-09-18', reason: null,
    })
  })

  it('shows a Withdraw action only on Pending rows, and confirms before cancelling', async () => {
    const user = userEvent.setup()
    mockCancelLeaveMutateAsync.mockResolvedValue(makeLeaveRequest({ status: 'Cancelled' }))
    mockUseMyLeave.mockReturnValue({
      data: { leave: [
        makeLeaveRequest({ id: 'leave-pending', status: 'Pending' }),
        makeLeaveRequest({ id: 'leave-approved', status: 'Approved' }),
      ], unavailability: [] },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()

    const withdrawButtons = screen.getAllByRole('button', { name: /withdraw/i })
    expect(withdrawButtons).toHaveLength(1)

    await user.click(withdrawButtons[0])
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^withdraw$/i }))

    expect(mockCancelLeaveMutateAsync).toHaveBeenCalledWith('leave-pending')
  })

  it('surfaces the server error message when submitting fails', async () => {
    const user = userEvent.setup()
    mockCreateLeaveMutateAsync.mockRejectedValue({
      response: { data: { errors: ['An identical request already exists.'] } },
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /request leave/i }))
    await user.type(screen.getByLabelText(/start date/i), '2026-09-14')
    await user.type(screen.getByLabelText(/end date/i), '2026-09-18')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    expect(await screen.findByText('An identical request already exists.')).toBeInTheDocument()
  })

  it('hides the Request leave button and Withdraw actions for a ReadOnly viewer', () => {
    setUserRole('ReadOnly')
    mockUseMyLeave.mockReturnValue({
      data: { leave: [makeLeaveRequest({ status: 'Pending' })], unavailability: [] },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    expect(screen.queryByRole('button', { name: /request leave/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument()
  })
})
