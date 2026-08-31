import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPutRaw } from '../client'
import type { ParticipantAdlAssessmentDto, UpsertParticipantAdlAssessmentDto, AdlType } from '../types'

export function useParticipantAdlAssessments(participantId: string | undefined) {
  return useQuery({
    queryKey: ['participant-adl-assessments', participantId],
    queryFn: () => apiGet<ParticipantAdlAssessmentDto[]>(`/participants/${participantId}/adl-assessments`),
    enabled: !!participantId,
  })
}

export function useUpsertAdlAssessment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, adlType, data }: { participantId: string; adlType: AdlType; data: UpsertParticipantAdlAssessmentDto }) =>
      apiPutRaw<ParticipantAdlAssessmentDto>(`/participants/${participantId}/adl-assessments/${adlType}`, data),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ['participant-adl-assessments', variables.participantId] })
    },
  })
}
