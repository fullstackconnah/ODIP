import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw } from '../client'
import type { SaveServiceLocationDto, ServiceLocationDto } from '../types/service-locations'

const KEY = ['service-locations']

/** The organisation's saved places, hidden ones included (a shift keeps its place's name); callers filter `isActive` for a picker. */
export function useServiceLocations(enabled = true) {
  return useQuery({ queryKey: KEY, enabled, queryFn: () => apiGet<ServiceLocationDto[]>('/service-locations') })
}

export function useCreateServiceLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: SaveServiceLocationDto) => apiPostRaw<ServiceLocationDto>('/service-locations', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useUpdateServiceLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SaveServiceLocationDto }) => apiPutRaw<ServiceLocationDto>(`/service-locations/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

/** There is no delete route: archiving hides a place from new shifts and keeps it on the shifts that have it. */
export function useArchiveServiceLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPostRaw<ServiceLocationDto>(`/service-locations/${id}/archive`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
