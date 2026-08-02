import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type {
  IncidentListDto,
  IncidentDetailDto,
  CreateIncidentDto,
  UpdateIncidentDto,
} from '../types'

export function useIncidents(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['incidents', params],
    queryFn: () => apiGet<IncidentListDto[]>('/incidents', params),
  })
}

export function useIncident(id: string | undefined) {
  return useQuery({
    queryKey: ['incident', id],
    queryFn: () => apiGet<IncidentDetailDto>(`/incidents/${id}`),
    enabled: !!id,
  })
}

export function useTripIncidents(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip-incidents', tripId],
    queryFn: () => apiGet<IncidentListDto[]>(`/incidents/trip/${tripId}`),
    enabled: !!tripId,
  })
}

export function useOverdueQscIncidents() {
  return useQuery({
    queryKey: ['incidents-overdue-qsc'],
    queryFn: () => apiGet<IncidentListDto[]>('/incidents/overdue-qsc'),
  })
}

export function useCreateIncident() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateIncidentDto) => apiPostRaw<IncidentDetailDto>('/incidents', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incidents'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUpdateIncident() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateIncidentDto }) =>
      apiPutRaw<IncidentDetailDto>(`/incidents/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['incidents'] })
      qc.invalidateQueries({ queryKey: ['incident', vars.id] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useDeleteIncident() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/incidents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incidents'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
