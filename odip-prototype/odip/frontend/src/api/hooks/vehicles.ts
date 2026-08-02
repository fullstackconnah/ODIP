import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type {
  VehicleListDto,
  VehicleDetailDto,
  CreateVehicleDto,
  UpdateVehicleDto,
  VehicleAssignmentDto,
  CreateVehicleAssignmentDto,
} from '../types'

export function useVehicles(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['vehicles', params],
    queryFn: () => apiGet<VehicleListDto[]>('/vehicles', params),
  })
}

export function useVehicleDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['vehicle-detail', id],
    queryFn: () => apiGet<VehicleDetailDto>(`/vehicles/${id}`),
    enabled: !!id,
  })
}

export function useTripVehicles(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip-vehicles', tripId],
    queryFn: () => apiGet<VehicleAssignmentDto[]>(`/trips/${tripId}/vehicles`),
    enabled: !!tripId,
  })
}

export function useCreateVehicle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateVehicleDto) => apiPostRaw<VehicleDetailDto>('/vehicles', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicles'] }),
  })
}

export function useUpdateVehicle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateVehicleDto }) =>
      apiPutRaw<VehicleDetailDto>(`/vehicles/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['vehicles'] })
      qc.invalidateQueries({ queryKey: ['vehicle-detail', vars.id] })
    },
  })
}

export function useDeleteVehicle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/vehicles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicles'] }),
  })
}

export function useCreateVehicleAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateVehicleAssignmentDto) =>
      apiPostRaw<VehicleAssignmentDto>('/vehicle-assignments', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-vehicles'] })
      qc.invalidateQueries({ queryKey: ['trip-itinerary'] })
    },
  })
}
