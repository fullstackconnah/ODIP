import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type {
  RestrictivePracticeDto, UpdateRestrictivePracticeDto,
  BulkCreateRestrictivePracticeDto,
} from '../types'

export function useRestrictivePractices(participantId: string | undefined, includeInactive?: boolean) {
  return useQuery({
    queryKey: ['restrictive-practices', participantId, includeInactive ?? false],
    queryFn: () =>
      apiGet<RestrictivePracticeDto[]>(`/participants/${participantId}/restrictive-practices`, {
        includeInactive: includeInactive ?? undefined,
      }),
    enabled: !!participantId,
  })
}

/** RP-01: bulk-create N register entries in one request (the editable-table add flow's save). */
export function useBulkCreateRestrictivePractices() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, data }: { participantId: string; data: BulkCreateRestrictivePracticeDto }) =>
      apiPostRaw<RestrictivePracticeDto[]>(`/participants/${participantId}/restrictive-practices/bulk`, data),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ['restrictive-practices', variables.participantId] })
      qc.invalidateQueries({ queryKey: ['participant', variables.participantId] })
      qc.invalidateQueries({ queryKey: ['participants'] })
      qc.invalidateQueries({ queryKey: ['medications'] })
      qc.invalidateQueries({ queryKey: ['medication'] })
    },
  })
}

export function useUpdateRestrictivePractice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateRestrictivePracticeDto }) =>
      apiPutRaw<RestrictivePracticeDto>(`/participants/restrictive-practices/${id}`, data),
    onSuccess: (res) => {
      if (res.data?.participantId) {
        // Write the saved row first, so a reopen before the refetch lands sends its new version, not the old one.
        const saved = res.data
        qc.setQueriesData<RestrictivePracticeDto[]>({ queryKey: ['restrictive-practices', saved.participantId] }, (rows) => rows?.map((r) => (r.id === saved.id ? saved : r)))
        qc.invalidateQueries({ queryKey: ['restrictive-practices', res.data.participantId] })
        qc.invalidateQueries({ queryKey: ['participant', res.data.participantId] })
        qc.invalidateQueries({ queryKey: ['participants'] })
      qc.invalidateQueries({ queryKey: ['medications'] })
      qc.invalidateQueries({ queryKey: ['medication'] })
      }
    },
  })
}

export function useDeleteRestrictivePractice() {
  const qc = useQueryClient()
  return useMutation({
    // The version the user saw: the server refuses the delete (409) if someone changed the entry since.
    mutationFn: ({ id, expectedUpdatedAt }: { id: string; participantId: string; expectedUpdatedAt?: string }) =>
      apiDeleteRaw<boolean>(`/participants/restrictive-practices/${id}${expectedUpdatedAt ? `?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}` : ''}`),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ['restrictive-practices', variables.participantId] })
      qc.invalidateQueries({ queryKey: ['participant', variables.participantId] })
      qc.invalidateQueries({ queryKey: ['participants'] })
      qc.invalidateQueries({ queryKey: ['medications'] })
      qc.invalidateQueries({ queryKey: ['medication'] })
    },
  })
}
