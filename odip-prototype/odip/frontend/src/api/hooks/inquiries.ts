import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPut } from '../client'
import type { CreateParticipantInquiryDto, OnboardingWorklistRow, ParticipantInquiryDto, ParticipantOnboardingDto, RecordOnboardingAgreementDto } from '../types/inquiries'

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

/** The onboarding checklist of one participant (the route's id is the PARTICIPANT's, despite its name). */
export function useOnboarding(participantId: string | undefined) {
  return useQuery({ queryKey: ['onboarding', participantId], enabled: !!participantId, queryFn: () => apiGet<ParticipantOnboardingDto>(`/inquiries/${participantId}/onboarding`) })
}

/** The Onboarding tab's rows. */
export function useOnboardingWorklist() {
  return useQuery({ queryKey: ['participant-onboarding-worklist'], queryFn: () => apiGet<OnboardingWorklistRow[]>('/inquiries/onboarding-worklist') })
}

/** The checklist's "Signed agreement" item: a signed date or a reason there is no written agreement. The server validates and answers field errors. */
export function useRecordOnboardingAgreement(participantId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: RecordOnboardingAgreementDto) => apiPost<ParticipantOnboardingDto>(`/inquiries/${participantId}/onboarding/agreement-record`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding', participantId] })
      qc.invalidateQueries({ queryKey: ['participant-onboarding-worklist'] })
    },
  })
}
