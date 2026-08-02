import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiPatchRaw } from '../client'
import type {
  TripListDto,
  TripDetailDto,
  CreateTripDto,
  UpdateTripDto,
  PatchTripDto,
  PagedResult,
} from '../types'

export function useTrips(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['trips', params],
    queryFn: async () => {
      const result = await apiGet<PagedResult<TripListDto>>('/trips', params)
      return result.items
    },
  })
}

export function useTrip(id: string | undefined) {
  return useQuery({
    queryKey: ['trip', id],
    queryFn: () => apiGet<TripDetailDto>(`/trips/${id}`),
    enabled: !!id,
  })
}

export function useCreateTrip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateTripDto) => apiPostRaw<TripDetailDto>('/trips', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trips'] }),
  })
}

export function useUpdateTrip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTripDto }) =>
      apiPutRaw<TripDetailDto>(`/trips/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['trips'] })
      qc.invalidateQueries({ queryKey: ['trip', vars.id] })
    },
  })
}

export function usePatchTrip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PatchTripDto }) =>
      apiPatchRaw<TripDetailDto>(`/trips/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['trips'] })
      qc.invalidateQueries({ queryKey: ['trip', vars.id] })
    },
  })
}

export function useGenerateSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tripId: string) => apiPostRaw<void>(`/trips/${tripId}/schedule/generate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip-schedule'] }),
  })
}
