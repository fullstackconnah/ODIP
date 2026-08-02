import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type {
  StaffListDto,
  StaffDetailDto,
  CreateStaffDto,
  UpdateStaffDto,
  StaffAssignmentDto,
  CreateStaffAssignmentDto,
  UpdateStaffAssignmentDto,
  StaffAvailabilityDto,
  CreateStaffAvailabilityDto,
  UpdateStaffAvailabilityDto,
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

export function useAvailableStaff(startDate: string | undefined, endDate: string | undefined) {
  return useQuery({
    queryKey: ['staff-available', startDate, endDate],
    queryFn: () => apiGet<StaffListDto[]>('/staff/available', { startDate, endDate }),
    enabled: !!startDate && !!endDate,
  })
}

export function useStaffAvailability(id: string | undefined) {
  return useQuery({
    queryKey: ['staff-availability', id],
    queryFn: () => apiGet<StaffAvailabilityDto[]>(`/staff/${id}/availability`),
    enabled: !!id,
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
    },
  })
}

export function useDeleteStaff() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/staff/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
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

export function useCreateStaffAvailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateStaffAvailabilityDto) =>
      apiPostRaw<StaffAvailabilityDto>('/staff-availability', data),
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
