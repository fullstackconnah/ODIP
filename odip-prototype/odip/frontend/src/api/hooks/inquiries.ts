import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiDeleteRaw, apiGet, apiPost, apiPut } from '../client'
import type { CancelIntakeBookingResultDto, CreateParticipantInquiryDto, IntakeVisitDto, OnboardingWorklistRow, ParticipantInquiryDto, ParticipantOnboardingDto, RecordOnboardingAgreementDto, SetIntakeBookingDto } from '../types/inquiries'

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

/** A booking change shows on the enquiry row and on both schedule views. */
function refreshIntake(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['participant-inquiries'] })
  qc.invalidateQueries({ queryKey: ['intake-visits'] })
}

export function useSetIntakeBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SetIntakeBookingDto }) => apiPut<ParticipantInquiryDto>(`/inquiries/${id}/intake-booking`, data),
    onSuccess: () => refreshIntake(qc),
  })
}

export function useCancelIntakeBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await apiDeleteRaw<CancelIntakeBookingResultDto>(`/inquiries/${id}/intake-booking`)).data as CancelIntakeBookingResultDto,
    onSuccess: (_result, id) => {
      // The row shows Book intake at once, so the page can focus it now rather than the old line 1 the refetch would then remove.
      qc.setQueryData<ParticipantInquiryDto[]>(['participant-inquiries'], rows => rows?.map(r => r.id !== id ? r : {
        ...r, intakeStartsAt: null, intakeDurationMinutes: null, intakeLocation: null, intakeStaffUserId: null, intakeStaffFirstName: null,
        intakeStaffName: null, intakeNotes: null, intakeInviteSentAt: null, intakeInviteError: null, intakeConfirmedAt: null,
      }))
      refreshIntake(qc)
    },
  })
}

export function useConfirmIntakeBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, confirmed }: { id: string; confirmed: boolean }) => apiPost<ParticipantInquiryDto>(`/inquiries/${id}/intake-booking/confirm`, { confirmed }),
    onSuccess: () => refreshIntake(qc),
  })
}

/** Send again: the same invite (UID and SEQUENCE), its outcome stored on the row. */
export function useResendIntakeInvite() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: string) => apiPost<ParticipantInquiryDto>(`/inquiries/${id}/intake-booking/send`), onSuccess: () => refreshIntake(qc) })
}

/** Intake visits by provider-local date range. `staffUserId` filters to one person; the server lets only lifecycle roles leave it out. */
export function useIntakeVisits(params: { from?: string; to?: string; staffUserId?: string }, enabled = true) {
  return useQuery({ queryKey: ['intake-visits', params], enabled, queryFn: () => apiGet<IntakeVisitDto[]>('/intake-visits', params) })
}
