import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiPatchRaw } from '../client'
import { toTruncatableList } from './pagedList'
import type {
  TripListDto,
  TripDetailDto,
  CreateTripDto,
  UpdateTripDto,
  PatchTripDto,
  PagedResult,
} from '../types'

/**
 * TripsController clamps `pageSize` to a ceiling of 200 (`Math.Clamp(pageSize, 1, 200)`).
 * `useTrips` requests that ceiling explicitly rather than accepting the server's much smaller
 * `pageSize = 50` default — see the UX-audit-round-2 fix for PagedResult call sites that were
 * silently dropping rows past the default page. The resolved array also carries
 * `totalCount`/`isTruncated` (see `pagedList.ts`) for any caller that needs to know.
 */
const TRIPS_MAX_PAGE_SIZE = 200

export function useTrips(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['trips', params],
    queryFn: async () => {
      const result = await apiGet<PagedResult<TripListDto>>('/trips', {
        pageSize: String(TRIPS_MAX_PAGE_SIZE),
        ...params,
      })
      return toTruncatableList(result)
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
