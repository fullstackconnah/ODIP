import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw } from '../client'
import { fetchPagedList } from './pagedList'
import type {
  MedicationListDto,
  MedicationDetailDto,
  CreateMedicationDto,
  UpdateMedicationDto,
  AdministrationDto,
  CreateAdministrationDto,
  UpdateAdministrationDto,
  MarDayDto,
  PagedResult,
} from '../types'

// Invalidates every cache that a medication/administration mutation can affect —
// the register list, participant medication lists, medication detail, MAR days,
// and participant administration history all key off overlapping data.
function invalidateMedicationCaches(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['medications'] })
  qc.invalidateQueries({ queryKey: ['medication'] })
  qc.invalidateQueries({ queryKey: ['mar'] })
  qc.invalidateQueries({ queryKey: ['participant-administrations'] })
}

export function useParticipantMedications(participantId: string | undefined, includeInactive?: boolean) {
  return useQuery({
    queryKey: ['medications', 'participant', participantId, includeInactive ?? false],
    queryFn: () =>
      apiGet<MedicationListDto[]>(`/participants/${participantId}/medications`, {
        includeInactive: includeInactive ?? undefined,
      }),
    enabled: !!participantId,
  })
}

export function useMedication(id: string | undefined) {
  return useQuery({
    queryKey: ['medication', id],
    queryFn: () => apiGet<MedicationDetailDto>(`/medications/${id}`),
    enabled: !!id,
  })
}

/**
 * MedicationsController.GetRegister now returns PagedResult<MedicationListDto> (real server-side
 * paging — see PAGINATION-PLAN-V2 §wave 2). `fetchPagedList` flattens that to a `TruncatableList`
 * whose `totalCount` drives `DataTable`'s `pagination` prop in `RegisterTab`; callers drive
 * `page`/`pageSize` themselves via `params`, same pattern as `useIncidents`.
 */
export function useMedicationRegister(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['medications', 'register', params],
    queryFn: () => fetchPagedList<MedicationListDto>('/medications/register', params),
  })
}

export function useMar(date: string, participantId?: string) {
  return useQuery({
    queryKey: ['mar', date, participantId],
    queryFn: () => apiGet<MarDayDto>('/medications/mar', { date, participantId }),
    enabled: !!date,
  })
}

export function useParticipantAdministrations(participantId: string | undefined, from?: string, to?: string) {
  return useQuery({
    queryKey: ['participant-administrations', participantId, from, to],
    queryFn: () => apiGet<AdministrationDto[]>(`/participants/${participantId}/administrations`, { from, to }),
    enabled: !!participantId,
  })
}

/** Cross-participant medication administration report, ordered by administration time desc. */
export function useAdministrationsReport(params: { participantId?: string; from?: string; to?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['administrations-report', params],
    queryFn: () => apiGet<PagedResult<AdministrationDto>>('/medications/administrations/report', params),
  })
}

export function useCreateMedication() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, data }: { participantId: string; data: CreateMedicationDto }) =>
      apiPostRaw<MedicationDetailDto>(`/participants/${participantId}/medications`, data),
    onSuccess: () => invalidateMedicationCaches(qc),
  })
}

export function useUpdateMedication() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateMedicationDto }) =>
      apiPutRaw<MedicationDetailDto>(`/medications/${id}`, data),
    onSuccess: () => invalidateMedicationCaches(qc),
  })
}

export function useRecordAdministration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ medicationId, data }: { medicationId: string; data: CreateAdministrationDto }) =>
      apiPostRaw<AdministrationDto>(`/medications/${medicationId}/administrations`, data),
    onSuccess: () => invalidateMedicationCaches(qc),
  })
}

export function useAmendAdministration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAdministrationDto }) =>
      apiPutRaw<AdministrationDto>(`/medications/administrations/${id}`, data),
    onSuccess: () => invalidateMedicationCaches(qc),
  })
}

export function useRecordPrnOutcome() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, prnOutcome }: { id: string; prnOutcome: string }) =>
      apiPostRaw<AdministrationDto>(`/medications/administrations/${id}/outcome`, { prnOutcome }),
    onSuccess: () => invalidateMedicationCaches(qc),
  })
}
