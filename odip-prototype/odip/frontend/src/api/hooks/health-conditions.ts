import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPutRaw } from '../client'
import type { ParticipantHealthConditionDto, UpsertParticipantHealthConditionDto, HealthConditionType } from '../types'

export function useParticipantHealthConditions(participantId: string | undefined) {
  return useQuery({
    queryKey: ['participant-health-conditions', participantId],
    queryFn: () => apiGet<ParticipantHealthConditionDto[]>(`/participants/${participantId}/health-conditions`),
    enabled: !!participantId,
  })
}

export function useUpsertHealthCondition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, conditionType, data }: { participantId: string; conditionType: HealthConditionType; data: UpsertParticipantHealthConditionDto }) =>
      apiPutRaw<ParticipantHealthConditionDto>(`/participants/${participantId}/health-conditions/${conditionType}`, data),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ['participant-health-conditions', variables.participantId] })
    },
  })
}
