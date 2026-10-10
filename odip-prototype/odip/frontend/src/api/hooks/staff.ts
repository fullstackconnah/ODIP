import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiGetWithDefault, apiPost, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type {
  StaffListDto,
  StaffDetailDto,
  CreateStaffDto,
  UpdateStaffDto,
  StaffAssignmentDto,
  CreateStaffAssignmentDto,
  UpdateStaffAssignmentDto,
  CheckStaffAssignmentDto,
  StaffAvailabilityDto,
  CreateStaffAvailabilityDto,
  UpdateStaffAvailabilityDto,
  RosterFindingDto,
  StaffOverviewDto,
  SignInAccountDto,
} from '../types'

export function useStaff(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['staff', params],
    queryFn: () => apiGet<StaffListDto[]>('/staff', params),
  })
}

export function useStaffDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['staff-detail', id],
    queryFn: () => apiGet<StaffDetailDto>(`/staff/${id}`),
    enabled: !!id,
  })
}

/**
 * Connection map item 12 — GET /staff/{id}/overview, the single data source for StaffDetailPage's
 * hub tabs (Availability/Credentials/Upcoming/Incidents/Completions). Mirrors useStaffDetail's
 * enabled-on-id gate.
 */
export function useStaffOverview(id: string | undefined) {
  return useQuery({
    queryKey: ['staff-overview', id],
    queryFn: () => apiGet<StaffOverviewDto>(`/staff/${id}/overview`),
    enabled: !!id,
  })
}

export function useAvailableStaff(startDate: string | undefined, endDate: string | undefined) {
  return useQuery({
    queryKey: ['staff-available', startDate, endDate],
    queryFn: () => apiGet<StaffListDto[]>('/staff/available', { startDate, endDate }),
    enabled: !!startDate && !!endDate,
  })
}

export function useTripStaff(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip-staff', tripId],
    queryFn: () => apiGet<StaffAssignmentDto[]>(`/trips/${tripId}/staff`),
    enabled: !!tripId,
  })
}

export function useCreateStaff() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateStaffDto) => apiPostRaw<StaffDetailDto>('/staff', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
  })
}

export function useUpdateStaff() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateStaffDto }) =>
      apiPutRaw<StaffDetailDto>(`/staff/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['staff'] })
      qc.invalidateQueries({ queryKey: ['staff-detail', vars.id] })
      qc.invalidateQueries({ queryKey: ['staff-overview', vars.id] })
    },
  })
}

export function useDeleteStaff() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/staff/${id}`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['staff'] })
      qc.invalidateQueries({ queryKey: ['staff-overview', id] })
    },
  })
}

/**
 * POST /staff/{id}/sign-in-account: makes sure the staff member has a Firebase sign-in account (staff added through the staff form have a
 * user row and nothing else) and says whether it made one. Run before asking Firebase to email them a set-password link (lib/signInEmail.ts).
 */
export function useEnsureStaffSignInAccount() {
  return useMutation({
    mutationFn: (id: string) => apiPost<SignInAccountDto>(`/staff/${id}/sign-in-account`),
  })
}

/**
 * Dry-run findings for a candidate trip assignment — a POST that writes nothing. Mirrors
 * useCheckShift (rostering.ts). Used by StaffAssignModal to preview findings for the fixed
 * staff/trip pairing the modal opened with.
 */
export function useCheckStaffAssignment() {
  return useMutation({
    mutationFn: (data: CheckStaffAssignmentDto) => apiPost<RosterFindingDto[]>('/staff-assignments/check', data),
  })
}

export function useCreateStaffAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateStaffAssignmentDto) =>
      apiPostRaw<StaffAssignmentDto>('/staff-assignments', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-staff'] })
      qc.invalidateQueries({ queryKey: ['trip'] })
      qc.invalidateQueries({ queryKey: ['trip-itinerary'] })
    },
  })
}

export function useUpdateStaffAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateStaffAssignmentDto }) =>
      apiPutRaw<StaffAssignmentDto>(`/staff-assignments/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-staff'] })
      qc.invalidateQueries({ queryKey: ['trip'] })
      qc.invalidateQueries({ queryKey: ['trip-itinerary'] })
    },
  })
}

export function useDeleteStaffAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/staff-assignments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-staff'] })
      qc.invalidateQueries({ queryKey: ['trip'] })
      qc.invalidateQueries({ queryKey: ['trip-itinerary'] })
    },
  })
}

export type StaffAvailabilityListFilters = { userId?: string; from?: string; to?: string }

/** GET /staff-availability?userId=&from=&to= — legacy StaffAvailability rows (LeaveApprovalsPage's
 * 'legacy' row kind), newest first. Shares the ['staff-availability', ...] query-key prefix with
 * the create/update/delete mutations below, so any of those invalidating ['staff-availability']
 * also refreshes this list. */
export function useStaffAvailabilityRecords(filters: StaffAvailabilityListFilters = {}, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['staff-availability', filters],
    queryFn: () => apiGetWithDefault<StaffAvailabilityDto[]>('/staff-availability', [], filters),
    enabled: options?.enabled ?? true,
  })
}

export function useCreateStaffAvailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateStaffAvailabilityDto) => apiPostRaw<StaffAvailabilityDto>('/staff-availability', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule-overview'] })
      qc.invalidateQueries({ queryKey: ['staff-availability'] })
    },
  })
}

export function useUpdateStaffAvailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateStaffAvailabilityDto }) =>
      apiPutRaw<StaffAvailabilityDto>(`/staff-availability/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule-overview'] })
      qc.invalidateQueries({ queryKey: ['staff-availability'] })
    },
  })
}

export function useDeleteStaffAvailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/staff-availability/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule-overview'] })
      qc.invalidateQueries({ queryKey: ['staff-availability'] })
    },
  })
}
