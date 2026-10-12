import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPut } from '../client'
import type { CreateParticipantInquiryDto, ParticipantInquiryDto } from '../types/inquiries'

export function useParticipantInquiries() {
  return useQuery({ queryKey: ['participant-inquiries'], queryFn: () => apiGet<ParticipantInquiryDto[]>('/inquiries') })
}

export function useCreateParticipantInquiry() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (data: CreateParticipantInquiryDto) => apiPost<ParticipantInquiryDto>('/inquiries', data), onSuccess: () => qc.invalidateQueries({ queryKey: ['participant-inquiries'] }) })
}

export function useUpdateParticipantInquiry() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, data }: { id: string; data: CreateParticipantInquiryDto }) => apiPut<ParticipantInquiryDto>(`/inquiries/${id}`, data), onSuccess: () => qc.invalidateQueries({ queryKey: ['participant-inquiries'] }) })
}

export function useConvertParticipantInquiry() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, participantId }: { id: string; participantId?: string }) => apiPost<ParticipantInquiryDto>(`/inquiries/${id}/convert`, participantId ? { participantId } : {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['participant-inquiries'] }) })
}

/** Onboarding's "Confirm service needs": the server checks the newest saved agreement is valid and priced, and stamps the step. The onboarding record is read again. */
export function useConfirmServiceNeeds(participantId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost(`/inquiries/${participantId}/onboarding/service-needs-confirmation`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding', participantId] }),
  })
}
