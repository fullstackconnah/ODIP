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
