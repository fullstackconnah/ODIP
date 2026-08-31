import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPutRaw } from '../client'
import type { ParticipantConsentDto, UpsertParticipantConsentDto, ConsentType } from '../types'

export function useParticipantConsents(participantId: string | undefined) {
  return useQuery({
    queryKey: ['participant-consents', participantId],
    queryFn: () => apiGet<ParticipantConsentDto[]>(`/participants/${participantId}/consents`),
    enabled: !!participantId,
  })
}

export function useUpsertConsent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, consentType, data }: { participantId: string; consentType: ConsentType; data: UpsertParticipantConsentDto }) =>
      apiPutRaw<ParticipantConsentDto>(`/participants/${participantId}/consents/${consentType}`, data),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ['participant-consents', variables.participantId] })
    },
  })
}
