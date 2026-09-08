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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-my-leave'] })
      // canRequestLeave is true for Admin/Coordinator/SuperAdmin too, so a coordinator's own
      // request needs the coordinator-side views (sidebar badge, roster board) refreshed as well.
      qc.invalidateQueries({ queryKey: ['leave-requests'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export function useCancelMyLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<LeaveRequestDto>(`/portal/leave/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-my-leave'] })
      qc.invalidateQueries({ queryKey: ['leave-requests'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export function useCreateMyUnavailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateRecurringUnavailabilityDto) => apiPost<RecurringUnavailabilityDto>('/portal/unavailability', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-my-leave'] })
      qc.invalidateQueries({ queryKey: ['recurring-unavailabilities'] })
    },
  })
}

export function useCancelMyUnavailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<RecurringUnavailabilityDto>(`/portal/unavailability/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-my-leave'] })
      qc.invalidateQueries({ queryKey: ['recurring-unavailabilities'] })
    },
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
export function useLeaveRequests(filters: LeaveListFilters = {}, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['leave-requests', filters],
    queryFn: () => apiGetWithDefault<LeaveRequestDto[]>('/leave', [], filters),
    refetchInterval: 60_000,
    enabled: options?.enabled ?? true,
  })
}

export function useRecurringUnavailabilities(filters: LeaveListFilters = {}, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['recurring-unavailabilities', filters],
    queryFn: () => apiGetWithDefault<RecurringUnavailabilityDto[]>('/leave/unavailability', [], filters),
    refetchInterval: 60_000,
    enabled: options?.enabled ?? true,
  })
}

/** Sidebar/nav badge count — shares the ['leave-requests', { status: 'Pending' }] and
 * ['recurring-unavailabilities', { status: 'Pending' }] cache entries with LeaveApprovalsPage's
 * default Pending filter, so the badge matches everything that view lists: pending leave
 * requests AND pending recurring-unavailability rules. `enabled` (default true) lets a caller
 * like AppLayout gate the poll on `canApproveLeave` — LeaveController is Admin/Coordinator/SuperAdmin
 * only server-side, so polling it every 60s for a role that can never get a non-error response
 * (SupportWorker, ReadOnly) is pure wasted/failing traffic. Same query keys either way, so once a
 * gated caller becomes enabled it picks up the already-shared cache entries instead of a fresh
 * fetch. */
export function usePendingLeaveCount(enabled = true): number {
  const { data: leave } = useLeaveRequests({ status: 'Pending' }, { enabled })
  const { data: unavailability } = useRecurringUnavailabilities({ status: 'Pending' }, { enabled })
  return (leave?.length ?? 0) + (unavailability?.length ?? 0)
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-requests'] })
      // A Pending leave request is already on the roster board (StaffUnavailabilityQuery unions
      // Approved and Pending), so declining removes a window from it just like approving/cancelling
      // does — the board is exactly as stale after a decline as after an approve.
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
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
    // No ['roster-board'] invalidation here, deliberately: only Approved recurring rules feed the
    // board, so a Pending-only decline never changes what it renders (unlike useDeclineLeave).
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
