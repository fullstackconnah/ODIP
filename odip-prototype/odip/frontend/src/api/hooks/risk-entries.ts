import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type { ParticipantRiskEntryDto, CreateParticipantRiskEntryDto, UpdateParticipantRiskEntryDto } from '../types'

export function useParticipantRiskEntries(participantId: string | undefined, includeInactive?: boolean) {
  return useQuery({
    queryKey: ['participant-risk-entries', participantId, includeInactive ?? false],
    queryFn: () =>
      apiGet<ParticipantRiskEntryDto[]>(`/participants/${participantId}/risk-entries`, {
        includeInactive: includeInactive ?? undefined,
      }),
    enabled: !!participantId,
  })
}

export function useCreateRiskEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, data }: { participantId: string; data: CreateParticipantRiskEntryDto }) =>
      apiPostRaw<ParticipantRiskEntryDto>(`/participants/${participantId}/risk-entries`, data),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ['participant-risk-entries', variables.participantId] })
    },
  })
}

export function useUpdateRiskEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateParticipantRiskEntryDto }) =>
      apiPutRaw<ParticipantRiskEntryDto>(`/participants/risk-entries/${id}`, data),
    onSuccess: (res) => {
      if (res.data?.participantId) {
        qc.invalidateQueries({ queryKey: ['participant-risk-entries', res.data.participantId] })
      }
    },
  })
}

export function useDeleteRiskEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; participantId: string }) =>
      apiDeleteRaw<boolean>(`/participants/risk-entries/${id}`),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ['participant-risk-entries', variables.participantId] })
    },
  })
}
