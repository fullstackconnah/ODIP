import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import { fetchPagedList } from './pagedList'
import { toUpdateIncidentDto } from '../types'
import type {
  IncidentListDto,
  IncidentDetailDto,
  CreateIncidentDto,
  UpdateIncidentDto,
} from '../types'

/**
 * IncidentsController.GetAll now returns PagedResult<IncidentListDto> (real server-side paging —
 * see PAGINATION-PLAN-V2 §4/Wave 1). `fetchPagedList` flattens that to a `TruncatableList` whose
 * `totalCount` drives `DataTable`'s `pagination` prop in `IncidentsPage`; callers drive `page`/
 * `pageSize` themselves via `params` rather than this hook requesting a fixed ceiling (contrast
 * `useParticipants`/`useTrips`, which fetch one large unpaginated page).
 */
export function useIncidents(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['incidents', params],
    queryFn: () => fetchPagedList<IncidentListDto>('/incidents', params),
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
      // Connection map seam follow-up: filing an incident can be the "File incident" hand-off
      // from a flagged shift note (IncidentsPage's queue) or from a MAR/administration-history
      // row (MarTab/participant-detail MedicationsTab) — invalidate all three so "Incident
      // filed" / the flagged-notes queue reflect the new link without a manual refresh. Query
      // keys mirrored from rostering.ts's useFlaggedShiftNotes and medications.ts's
      // invalidateMedicationCaches.
      qc.invalidateQueries({ queryKey: ['flagged-shift-notes'] })
      qc.invalidateQueries({ queryKey: ['mar'] })
      qc.invalidateQueries({ queryKey: ['participant-administrations'] })
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

/**
 * Restores an archived incident. UpdateIncident replaces the whole record and a list row lacks most of it (the description is required), so the stored incident is
 * read and put back with `data` applied on top (the status change).
 */
export function useRestoreIncident() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<UpdateIncidentDto> }) => {
      const stored = await apiGet<IncidentDetailDto>(`/incidents/${id}`)
      return apiPutRaw<IncidentDetailDto>(`/incidents/${id}`, toUpdateIncidentDto(stored, data))
    },
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
