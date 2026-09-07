import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiGetWithDefault, apiPost } from '../client'
import type {
  MyLeaveResponseDto,
  LeaveRequestDto,
  CreateLeaveRequestDto,
  LeaveDecisionDto,
  ApproveLeaveResultDto,
  RecurringUnavailabilityDto,
  CreateRecurringUnavailabilityDto,
  ApproveRecurringUnavailabilityResultDto,
  LeaveStatus,
} from '../types'

// ══════════════════════════════════════════════════════════════
// PORTAL (self-service) — mirrors PortalController's leave/unavailability actions
// ══════════════════════════════════════════════════════════════

export function useMyLeave() {
  return useQuery({
    queryKey: ['portal-my-leave'],
    queryFn: () => apiGet<MyLeaveResponseDto>('/portal/leave'),
  })
}

export function useCreateLeaveRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateLeaveRequestDto) => apiPost<LeaveRequestDto>('/portal/leave', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-my-leave'] }),
  })
}

export function useCancelMyLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<LeaveRequestDto>(`/portal/leave/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-my-leave'] }),
  })
}

export function useCreateMyUnavailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateRecurringUnavailabilityDto) => apiPost<RecurringUnavailabilityDto>('/portal/unavailability', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-my-leave'] }),
  })
}

export function useCancelMyUnavailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<RecurringUnavailabilityDto>(`/portal/unavailability/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-my-leave'] }),
  })
}

// ══════════════════════════════════════════════════════════════
// COORDINATOR — mirrors LeaveController (api/v1/leave)
// ══════════════════════════════════════════════════════════════

export type LeaveListFilters = { status?: LeaveStatus; userId?: string; from?: string; to?: string }

/**
 * Polled every 60s (like usePendingWitnessRequests) so the sidebar badge and this page's default
 * Pending filter both stay fresh without a page revisit. A caller passing the identical filters
 * object shares this cache entry — usePendingLeaveCount and LeaveApprovalsPage's default view
 * read the same request when both resolve to { status: 'Pending' }.
 */
export function useLeaveRequests(filters: LeaveListFilters = {}) {
  return useQuery({
    queryKey: ['leave-requests', filters],
    queryFn: () => apiGetWithDefault<LeaveRequestDto[]>('/leave', [], filters),
    refetchInterval: 60_000,
  })
}

export function useRecurringUnavailabilities(filters: LeaveListFilters = {}) {
  return useQuery({
    queryKey: ['recurring-unavailabilities', filters],
    queryFn: () => apiGetWithDefault<RecurringUnavailabilityDto[]>('/leave/unavailability', [], filters),
    refetchInterval: 60_000,
  })
}

/** Sidebar/nav badge count — shares the ['leave-requests', { status: 'Pending' }] cache entry
 * with LeaveApprovalsPage's default filter. */
export function usePendingLeaveCount(): number {
  const { data } = useLeaveRequests({ status: 'Pending' })
  return data?.length ?? 0
}

export function useCreateLeaveOnBehalf() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateLeaveRequestDto) => apiPost<LeaveRequestDto>('/leave', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export function useApproveLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<ApproveLeaveResultDto>(`/leave/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export function useDeclineLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: LeaveDecisionDto }) => apiPost<LeaveRequestDto>(`/leave/${id}/decline`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leave-requests'] }),
  })
}

export function useCancelLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<LeaveRequestDto>(`/leave/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export function useCreateUnavailabilityOnBehalf() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateRecurringUnavailabilityDto) => apiPost<RecurringUnavailabilityDto>('/leave/unavailability', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-unavailabilities'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export function useApproveUnavailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<ApproveRecurringUnavailabilityResultDto>(`/leave/unavailability/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-unavailabilities'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export function useDeclineUnavailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: LeaveDecisionDto }) => apiPost<RecurringUnavailabilityDto>(`/leave/unavailability/${id}/decline`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-unavailabilities'] }),
  })
}

export function useCancelUnavailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<RecurringUnavailabilityDto>(`/leave/unavailability/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-unavailabilities'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}
