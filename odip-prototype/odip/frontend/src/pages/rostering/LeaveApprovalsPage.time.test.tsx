import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import LeaveApprovalsPage from './LeaveApprovalsPage'
import { makeLeaveRequest } from './test-fixtures-leave'
import type { StaffListDto } from '@/api/types'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUseLeaveRequests, mutation, empty } = vi.hoisted(() => ({
  mockUseLeaveRequests: vi.fn(),
  mutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  empty: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}))

vi.mock('@/api/hooks', () => ({
  useLeaveRequests: mockUseLeaveRequests,
  useRecurringUnavailabilities: empty,
  useStaff: () => ({ data: [{ id: 'staff-1', fullName: 'Alex Rivera' }] as StaffListDto[] }),
  useStaffAvailabilityRecords: empty,
  useApproveLeave: mutation, useDeclineLeave: mutation, useCancelLeave: mutation,
  useApproveUnavailability: mutation, useDeclineUnavailability: mutation, useCancelUnavailability: mutation,
  useCreateLeaveOnBehalf: mutation, useCreateUnavailabilityOnBehalf: mutation, useUpdateLeave: mutation, useUpdateUnavailability: mutation,
  useCreateStaffAvailability: mutation, useUpdateStaffAvailability: mutation, useDeleteStaffAvailability: mutation, useAssignShift: mutation,
}))

beforeEach(() => localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' })))
afterEach(() => {
  restoreZone()
  localStorage.clear()
  vi.clearAllMocks()
})

// "Requested by" shows the DAY a request was made. requestedAt is an INSTANT, so the day is the viewer's local date; the first ten characters
// of the string are the UTC date, which is yesterday for a request made before 10:00 (11:00 in daylight time) in Sydney.
describe('LeaveApprovalsPage "Requested by" date', () => {
  it.each([
    ['Australia/Sydney', 'Self · 2026-10-01'],   // 22:00Z on 30 Sep is 08:00 on 1 Oct
    ['UTC', 'Self · 2026-09-30'],
    ['America/New_York', 'Self · 2026-09-30'],   // 18:00 on 30 Sep
  ])('in %s reads %s', (zone, expected) => {
    if (!setZone(zone)) return
    mockUseLeaveRequests.mockReturnValue({
      data: [makeLeaveRequest({ requestedAt: '2026-09-30T22:00:00.1234567Z', requestedByUserId: 'staff-1', userId: 'staff-1' })],
      isLoading: false, isError: false, refetch: vi.fn(),
    })

    render(<RouterProvider router={createMemoryRouter([{ path: '/rostering/leave', element: <LeaveApprovalsPage /> }], { initialEntries: ['/rostering/leave'] })} />)

    expect(screen.getByText(expected)).toBeInTheDocument()
  })
})
