import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockApiGet, mockApiGetWithDefault, mockApiPost, mockApiPut } = vi.hoisted(() => ({
  mockApiGet: vi.fn(async () => ({ leave: [], unavailability: [] })),
  mockApiGetWithDefault: vi.fn(async (): Promise<unknown[]> => []),
  mockApiPost: vi.fn(async () => ({})),
  mockApiPut: vi.fn(async () => ({})),
}))

vi.mock('../client', () => ({
  apiGet: mockApiGet,
  apiGetWithDefault: mockApiGetWithDefault,
  apiPost: mockApiPost,
  apiPut: mockApiPut,
}))

import {
  useMyLeave, useCreateLeaveRequest, useCancelMyLeave, useCreateMyUnavailability, useCancelMyUnavailability,
  useLeaveRequests, useRecurringUnavailabilities, usePendingLeaveCount, usePendingLeaveQueue,
  useCreateLeaveOnBehalf, useApproveLeave, useDeclineLeave, useCancelLeave, useUpdateLeave,
  useCreateUnavailabilityOnBehalf, useApproveUnavailability, useDeclineUnavailability, useCancelUnavailability,
  useUpdateUnavailability,
} from './leave'

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  mockApiGet.mockClear()
  mockApiGetWithDefault.mockClear().mockResolvedValue([])
  mockApiPost.mockClear().mockResolvedValue({})
  mockApiPut.mockClear().mockResolvedValue({})
})

describe('leave hooks — portal (self-service)', () => {
  it('useMyLeave reads GET /portal/leave', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useMyLeave(), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/portal/leave')
  })

  it('useCreateLeaveRequest posts to /portal/leave and invalidates portal-my-leave + leave-requests + roster-board', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreateLeaveRequest(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ leaveType: 'Annual', startDate: '2026-09-14', endDate: '2026-09-18' })
    expect(mockApiPost).toHaveBeenCalledWith('/portal/leave', { leaveType: 'Annual', startDate: '2026-09-14', endDate: '2026-09-18' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['portal-my-leave'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['leave-requests'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['roster-board'] })
  })

  it('useCancelMyLeave posts to /portal/leave/{id}/cancel and invalidates portal-my-leave + leave-requests + roster-board', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCancelMyLeave(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync('leave-1')
    expect(mockApiPost).toHaveBeenCalledWith('/portal/leave/leave-1/cancel')
    expect(spy).toHaveBeenCalledWith({ queryKey: ['portal-my-leave'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['leave-requests'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['roster-board'] })
  })

  it('useCreateMyUnavailability posts to /portal/unavailability and invalidates portal-my-leave + recurring-unavailabilities', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreateMyUnavailability(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ dayOfWeek: 'Monday', startTime: '09:00', endTime: '12:00', effectiveFrom: '2026-09-07' })
    expect(mockApiPost).toHaveBeenCalledWith('/portal/unavailability', { dayOfWeek: 'Monday', startTime: '09:00', endTime: '12:00', effectiveFrom: '2026-09-07' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['portal-my-leave'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['recurring-unavailabilities'] })
  })

  it('useCancelMyUnavailability posts to /portal/unavailability/{id}/cancel and invalidates portal-my-leave + recurring-unavailabilities', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCancelMyUnavailability(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync('rule-1')
    expect(mockApiPost).toHaveBeenCalledWith('/portal/unavailability/rule-1/cancel')
    expect(spy).toHaveBeenCalledWith({ queryKey: ['portal-my-leave'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['recurring-unavailabilities'] })
  })
})

describe('leave hooks — coordinator', () => {
  it('useLeaveRequests reads GET /leave with filters', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useLeaveRequests({ status: 'Pending' }), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGetWithDefault).toHaveBeenCalledWith('/leave', [], { status: 'Pending' })
  })

  it('useRecurringUnavailabilities reads GET /leave/unavailability with filters', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useRecurringUnavailabilities({ userId: 'staff-1' }), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGetWithDefault).toHaveBeenCalledWith('/leave/unavailability', [], { userId: 'staff-1' })
  })

  it('usePendingLeaveCount sums pending leave requests and pending recurring-unavailability rules', async () => {
    mockApiGetWithDefault
      .mockResolvedValueOnce([{ id: '1' }, { id: '2' }])
      .mockResolvedValueOnce([{ id: 'rule-1' }])
    const qc = new QueryClient()
    const { result } = renderHook(() => usePendingLeaveCount(), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.current).toBe(3))
    expect(mockApiGetWithDefault).toHaveBeenCalledWith('/leave', [], { status: 'Pending' })
    expect(mockApiGetWithDefault).toHaveBeenCalledWith('/leave/unavailability', [], { status: 'Pending' })
  })

  describe('usePendingLeaveQueue: the count and whether it can be trusted', () => {
    afterEach(() => {
      onlineManager.setOnline(true)
    })

    it('is loading, with a count of 0, until both requests answer, then reports the sum and settles', async () => {
      mockApiGetWithDefault
        .mockResolvedValueOnce([{ id: '1' }, { id: '2' }])
        .mockResolvedValueOnce([{ id: 'rule-1' }])
      const qc = new QueryClient()
      const { result } = renderHook(() => usePendingLeaveQueue(), { wrapper: wrapper(qc) })

      expect(result.current).toEqual({ count: 0, loading: true, error: false })
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current).toEqual({ count: 3, loading: false, error: false })
    })

    it('reports an error, not a settled zero, when a request fails', async () => {
      mockApiGetWithDefault.mockRejectedValue(new Error('boom'))
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const { result } = renderHook(() => usePendingLeaveQueue(), { wrapper: wrapper(qc) })

      await waitFor(() => expect(result.current.error).toBe(true))
      expect(result.current).toEqual({ count: 0, loading: false, error: true })
    })

    // TanStack Query PAUSES a request while the browser reports offline: the query is pending with a fetchStatus of "paused", and isLoading is false, so a
    // flag built on isLoading read the queue as an empty one (and the dashboard could say nothing needs anybody over data it never asked for).
    it('is loading, not a settled zero, while the requests are paused offline, and settles once the browser is back online', async () => {
      mockApiGetWithDefault
        .mockResolvedValueOnce([{ id: '1' }])
        .mockResolvedValueOnce([])
      onlineManager.setOnline(false)
      const qc = new QueryClient()
      const { result } = renderHook(() => usePendingLeaveQueue(), { wrapper: wrapper(qc) })

      expect(result.current).toEqual({ count: 0, loading: true, error: false })
      expect(mockApiGetWithDefault).not.toHaveBeenCalled()

      act(() => {
        onlineManager.setOnline(true)
      })
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current).toEqual({ count: 1, loading: false, error: false })
    })

    it('asks for nothing and says nothing is loading when the caller is not enabled', () => {
      const qc = new QueryClient()
      const { result } = renderHook(() => usePendingLeaveQueue(false), { wrapper: wrapper(qc) })

      expect(result.current).toEqual({ count: 0, loading: false, error: false })
      expect(mockApiGetWithDefault).not.toHaveBeenCalled()
    })
  })

  it('useCreateLeaveOnBehalf posts to /leave and invalidates leave-requests + roster-board', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreateLeaveOnBehalf(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ leaveType: 'Annual', startDate: '2026-09-14', endDate: '2026-09-18', userId: 'staff-1' })
    expect(mockApiPost).toHaveBeenCalledWith('/leave', { leaveType: 'Annual', startDate: '2026-09-14', endDate: '2026-09-18', userId: 'staff-1' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['leave-requests'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['roster-board'] })
  })

  it('useApproveLeave posts to /leave/{id}/approve and invalidates leave-requests + roster-board', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useApproveLeave(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync('leave-1')
    expect(mockApiPost).toHaveBeenCalledWith('/leave/leave-1/approve')
    expect(spy).toHaveBeenCalledWith({ queryKey: ['leave-requests'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['roster-board'] })
  })

  it('useDeclineLeave posts the decision note to /leave/{id}/decline and invalidates leave-requests + roster-board', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useDeclineLeave(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ id: 'leave-1', data: { decisionNote: 'Not enough notice' } })
    expect(mockApiPost).toHaveBeenCalledWith('/leave/leave-1/decline', { decisionNote: 'Not enough notice' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['leave-requests'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['roster-board'] })
  })

  it('useCancelLeave posts to /leave/{id}/cancel', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useCancelLeave(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync('leave-1')
    expect(mockApiPost).toHaveBeenCalledWith('/leave/leave-1/cancel')
  })

  it('useUpdateLeave PUTs to /leave/{id} and invalidates leave, unavailability, staff-availability, schedule and roster-board caches', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateLeave(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ id: 'leave-1', data: { leaveType: 'Sick', startDate: '2026-09-14', endDate: '2026-09-18', reason: 'Flu.' } })
    expect(mockApiPut).toHaveBeenCalledWith('/leave/leave-1', { leaveType: 'Sick', startDate: '2026-09-14', endDate: '2026-09-18', reason: 'Flu.' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['leave-requests'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['recurring-unavailabilities'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['staff-availability'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule-overview'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['roster-board'] })
  })

  it('useCreateUnavailabilityOnBehalf posts to /leave/unavailability', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useCreateUnavailabilityOnBehalf(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ dayOfWeek: 'Monday', startTime: '09:00', endTime: '12:00', effectiveFrom: '2026-09-07', userId: 'staff-1' })
    expect(mockApiPost).toHaveBeenCalledWith('/leave/unavailability', { dayOfWeek: 'Monday', startTime: '09:00', endTime: '12:00', effectiveFrom: '2026-09-07', userId: 'staff-1' })
  })

  it('useApproveUnavailability posts to /leave/unavailability/{id}/approve', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useApproveUnavailability(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync('rule-1')
    expect(mockApiPost).toHaveBeenCalledWith('/leave/unavailability/rule-1/approve')
  })

  it('useDeclineUnavailability posts the decision note to /leave/unavailability/{id}/decline', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useDeclineUnavailability(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ id: 'rule-1', data: { decisionNote: 'Roster gap' } })
    expect(mockApiPost).toHaveBeenCalledWith('/leave/unavailability/rule-1/decline', { decisionNote: 'Roster gap' })
  })

  it('useCancelUnavailability posts to /leave/unavailability/{id}/cancel', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useCancelUnavailability(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync('rule-1')
    expect(mockApiPost).toHaveBeenCalledWith('/leave/unavailability/rule-1/cancel')
  })

  it('useUpdateUnavailability PUTs to /leave/unavailability/{id} and invalidates leave, unavailability, staff-availability, schedule and roster-board caches', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateUnavailability(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ id: 'rule-1', data: { dayOfWeek: 'Tuesday', startTime: '10:00:00', endTime: '13:00:00', effectiveFrom: '2026-09-07', effectiveTo: null, notes: null } })
    expect(mockApiPut).toHaveBeenCalledWith('/leave/unavailability/rule-1', { dayOfWeek: 'Tuesday', startTime: '10:00:00', endTime: '13:00:00', effectiveFrom: '2026-09-07', effectiveTo: null, notes: null })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['recurring-unavailabilities'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['leave-requests'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['staff-availability'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule-overview'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['roster-board'] })
  })
})
