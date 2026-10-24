import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import PortalLeavePage from './PortalLeavePage'
import { makeLeaveRequest, makeRecurringRule } from '@/pages/rostering/test-fixtures-leave'

const {
  mockUseMyLeave, mockVisibility, mockBalances, mockCreateLeaveMutateAsync, mockCancelLeaveMutateAsync,
  mockCreateUnavailabilityMutateAsync, mockCancelUnavailabilityMutateAsync,
} = vi.hoisted(() => ({
  mockUseMyLeave: vi.fn(),
  mockVisibility: vi.fn(),
  mockBalances: vi.fn(),
  mockCreateLeaveMutateAsync: vi.fn(),
  mockCancelLeaveMutateAsync: vi.fn(),
  mockCreateUnavailabilityMutateAsync: vi.fn(),
  mockCancelUnavailabilityMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useMyLeave: mockUseMyLeave,
  useModuleVisibility: mockVisibility,
  useMyLeaveBalances: mockBalances,
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
  mockVisibility.mockReturnValue({ data: { employmentHeroConnected: false } })
  mockBalances.mockReset()
  mockBalances.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
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
    await user.click(screen.getByRole('tab', { name: 'Regular unavailability' }))
    expect(screen.getByText('Tuesday')).toBeInTheDocument()
  })

  it('submits a new recurring unavailability rule from the Regular unavailability tab', async () => {
    const user = userEvent.setup()
    mockCreateUnavailabilityMutateAsync.mockResolvedValue(makeRecurringRule())
    renderPage()

    await user.click(screen.getByRole('tab', { name: 'Regular unavailability' }))
    await user.click(screen.getByRole('button', { name: /add unavailability/i }))
    await user.type(screen.getByLabelText(/start time/i), '09:00')
    await user.type(screen.getByLabelText(/end time/i), '12:00')
    await user.type(screen.getByLabelText(/effective from/i), '2026-09-14')
    await user.click(screen.getByRole('button', { name: /^submit request$/i }))

    expect(mockCreateUnavailabilityMutateAsync).toHaveBeenCalledWith({
      dayOfWeek: 'Monday', startTime: '09:00:00', endTime: '12:00:00', effectiveFrom: '2026-09-14', effectiveTo: null, notes: null,
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: /^submit request$/i })).not.toBeInTheDocument())
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

    const withdrawButtons = screen.getAllByRole('button', { name: /^withdraw: /i })
    expect(withdrawButtons).toHaveLength(1)
    // Each row has its own, so the name says which request it withdraws.
    expect(withdrawButtons[0]).toHaveAccessibleName('Withdraw: 14 Sep 2026 – 18 Sep 2026')

    await user.click(withdrawButtons[0])
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^withdraw$/i }))

    expect(mockCancelLeaveMutateAsync).toHaveBeenCalledWith('leave-pending')
  })

  it('shows the withdraw-failure banner when cancelling fails', async () => {
    const user = userEvent.setup()
    mockCancelLeaveMutateAsync.mockRejectedValue({
      response: { data: { message: 'Could not withdraw — already being processed.' } },
    })
    mockUseMyLeave.mockReturnValue({
      data: { leave: [makeLeaveRequest({ id: 'leave-pending', status: 'Pending' })], unavailability: [] },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^withdraw: /i }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^withdraw$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not withdraw — already being processed.')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
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

  it('does not warn before navigating away after a successful leave request submission (I-4)', async () => {
    const user = userEvent.setup()
    mockCreateLeaveMutateAsync.mockResolvedValue(makeLeaveRequest())
    const router = createMemoryRouter(
      [
        { path: '/portal/leave', element: <PortalLeavePage /> },
        { path: '/portal', element: <div>Portal home</div> },
      ],
      { initialEntries: ['/portal/leave'] },
    )
    render(<RouterProvider router={router} />)

    await user.click(screen.getByRole('button', { name: /request leave/i }))
    await user.type(screen.getByLabelText(/start date/i), '2026-09-14')
    await user.type(screen.getByLabelText(/end date/i), '2026-09-18')
    await user.click(screen.getByRole('button', { name: /submit request/i }))
    await waitFor(() => expect(mockCreateLeaveMutateAsync).toHaveBeenCalled())

    await act(async () => { await router.navigate('/portal') })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await screen.findByText('Portal home')).toBeInTheDocument()
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

// A failed load is the house error banner (a danger Callout, announced at once, with its retry), not an EmptyState that reads as "nothing here".
describe('PortalLeavePage — a failed load', () => {
  it('shows the error banner with Try again, not an empty state', async () => {
    const refetch = vi.fn()
    mockUseMyLeave.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    renderPage()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/couldn't load your leave/i)
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  // One Back rule across the portal's sub-pages: the BackButton icon beside the title, to My shifts.
  it('offers Back to My shifts beside the title', () => {
    renderPage()
    expect(screen.getByRole('link', { name: 'Back to my shifts' })).toHaveAttribute('href', '/portal')
  })
})

describe('PortalLeavePage — Employment Hero', () => {
  const ready = { data: { status: 'Ready', balances: [{ category: 'Annual Leave', amount: 76, unit: 'Hours' }, { category: 'Time in lieu', amount: -3.75, unit: 'Hours' }] }, isLoading: false, isError: false, refetch: vi.fn() }

  it('shows no balances and reads none when the organisation is not connected', () => {
    renderPage()
    expect(screen.queryByRole('heading', { name: 'Leave balances' })).not.toBeInTheDocument()
    expect(mockBalances).toHaveBeenCalledWith(false)
  })

  it('shows the balances after the list, with one decimal and a real minus', () => {
    mockVisibility.mockReturnValue({ data: { employmentHeroConnected: true } })
    mockBalances.mockReturnValue(ready)
    renderPage()
    expect(mockBalances).toHaveBeenCalledWith(true)
    expect(screen.getByRole('heading', { name: 'Leave balances' })).toBeInTheDocument()
    expect(screen.getByText('76.0 hours')).toBeInTheDocument()
    expect(screen.getByText('\u22123.8 hours')).toBeInTheDocument()
    expect(screen.getByText('From Employment Hero, as at today.')).toBeInTheDocument()
  })

  it('keeps balances off the Regular unavailability tab', async () => {
    const user = userEvent.setup()
    mockVisibility.mockReturnValue({ data: { employmentHeroConnected: true } })
    mockBalances.mockReturnValue(ready)
    renderPage()
    await user.click(screen.getByRole('tab', { name: 'Regular unavailability' }))
    expect(screen.queryByRole('heading', { name: 'Leave balances' })).not.toBeInTheDocument()
  })

  it('marks leave entered in Employment Hero, with no Withdraw', () => {
    mockUseMyLeave.mockReturnValue({
      data: { leave: [makeLeaveRequest({ id: 'eh-1', status: 'Approved', source: 'EmploymentHero' })], unavailability: [] },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('Entered in Employment Hero')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument()
  })
})
