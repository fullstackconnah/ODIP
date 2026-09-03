import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPutRaw } from '../client'
import type { ParticipantCommunityAccessRiskItemDto, UpsertParticipantCommunityAccessRiskItemDto, CommunityAccessRiskItemType } from '../types'

/**
 * PF-10.2/PF-10.4 (SPEC-05). The 22-row Community Access Risk Assessment matrix has its own
 * nested-CRUD endpoint (ParticipantCommunityAccessRiskItemsController), unaffected by core02's
 * PATCH groups — mirrors useUpsertAdlAssessment's shape exactly. The matrix itself is read as part
 * of `useParticipant(id)` (ParticipantDetailDto.communityAccessRiskItems, always all 22 rows) —
 * there is no separate list-query hook here, only the per-item upsert mutation.
 */
export function useUpsertCommunityAccessRiskItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, itemType, data }: { participantId: string; itemType: CommunityAccessRiskItemType; data: UpsertParticipantCommunityAccessRiskItemDto }) =>
      apiPutRaw<ParticipantCommunityAccessRiskItemDto>(`/participants/${participantId}/community-access-risk-items/${itemType}`, data),
    onSuccess: (_res, variables) => {
      qc.invalidateQueries({ queryKey: ['participant', variables.participantId] })
    },
  })
}
