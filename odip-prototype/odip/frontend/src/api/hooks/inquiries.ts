import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiDeleteRaw, apiGet, apiPost, apiPut } from '../client'
import type { CancelIntakeBookingResultDto, CloseInquiryDto, CloseInquiryResultDto, CreateParticipantInquiryDto, IntakeVisitDto, OnboardingWorklistRow, ParticipantInquiryDetailDto, ParticipantInquiryDto, ParticipantOnboardingDto, RecordOnboardingAgreementDto, SetIntakeBookingDto, UpdateParticipantInquiryDto } from '../types/inquiries'

/** The Enquiries tab's rows: the open view (today's key and URL, so every existing caller is unchanged) or the closed one. */
export function useParticipantInquiries(view: 'open' | 'closed' = 'open') {
  return useQuery({
    queryKey: view === 'open' ? ['participant-inquiries'] : ['participant-inquiries', 'closed'],
    queryFn: () => (view === 'open' ? apiGet<ParticipantInquiryDto[]>('/inquiries') : apiGet<ParticipantInquiryDto[]>('/inquiries', { view: 'closed' })),
  })
}

/**
 * One enquiry with its pending contacts, for the enquiry form. Under ['participant-inquiries'], so every save's invalidation refreshes it. Always
 * fetched fresh on mount: a PUT replaces the contacts, so a form built from a cached copy could delete ones added since (plan check S2).
 */
export function useParticipantInquiry(id: string | undefined) {
  return useQuery({
    queryKey: ['participant-inquiries', id], enabled: !!id, staleTime: 0, refetchOnMount: 'always',
    queryFn: () => apiGet<ParticipantInquiryDetailDto>(`/inquiries/${id}`),
  })
}

export function useCreateParticipantInquiry() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (data: CreateParticipantInquiryDto) => apiPost<ParticipantInquiryDto>('/inquiries', data), onSuccess: () => qc.invalidateQueries({ queryKey: ['participant-inquiries'] }) })
}

export function useUpdateParticipantInquiry() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, data }: { id: string; data: UpdateParticipantInquiryDto }) => apiPut<ParticipantInquiryDto>(`/inquiries/${id}`, data), onSuccess: () => qc.invalidateQueries({ queryKey: ['participant-inquiries'] }) })
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

/** A booking write's target: the enquiry id, or the id with the version the caller holds (the enquiry form's; ODIP-REVIEW-268). */
type VersionedId = string | { id: string; expectedUpdatedAt?: string }
const idOf = (v: VersionedId) => (typeof v === 'string' ? v : v.id)
const versionOf = (v: VersionedId) => (typeof v === 'string' ? undefined : v.expectedUpdatedAt)

export function useCancelIntakeBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (target: VersionedId) => {
      const version = versionOf(target)
      const query = version ? `?expectedUpdatedAt=${encodeURIComponent(version)}` : ''
      return (await apiDeleteRaw<CancelIntakeBookingResultDto>(`/inquiries/${idOf(target)}/intake-booking${query}`)).data as CancelIntakeBookingResultDto
    },
    onSuccess: (_result, target) => {
      const id = idOf(target)
      // The row shows Book intake at once, so the page can focus it now rather than the old line 1 the refetch would then remove.
      qc.setQueryData<ParticipantInquiryDto[]>(['participant-inquiries'], rows => rows?.map(r => r.id !== id ? r : {
        ...r, intakeStartsAt: null, intakeDurationMinutes: null, intakeLocation: null, intakeStaffUserId: null, intakeStaffFirstName: null,
        intakeStaffName: null, intakeNotes: null, intakeInviteSentAt: null, intakeInviteError: null, intakeConfirmedAt: null,
      }))
      refreshIntake(qc)
    },
  })
}

/** Close (spec addendum E1-E2): cancels an upcoming visit and deletes the pending contacts on the server. */
export function useCloseInquiry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: CloseInquiryDto }) => apiPost<CloseInquiryResultDto>(`/inquiries/${id}/close`, data),
    onSuccess: () => refreshIntake(qc),
  })
}

export function useReopenInquiry() {
  const qc = useQueryClient()
  return useMutation({
    // The version the screen loaded goes with it, as on a close: a save since then makes the reopen a 409.
    mutationFn: ({ id, expectedUpdatedAt }: { id: string; expectedUpdatedAt?: string }) => apiPost<ParticipantInquiryDto>(`/inquiries/${id}/reopen`, { expectedUpdatedAt }),
    onSuccess: () => refreshIntake(qc),
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
  return useMutation({
    mutationFn: (target: VersionedId) => {
      const version = versionOf(target)
      return apiPost<ParticipantInquiryDto>(`/inquiries/${idOf(target)}/intake-booking/send`, ...(version ? [{ expectedUpdatedAt: version }] : []))
    },
    onSuccess: () => refreshIntake(qc),
  })
}

/** Intake visits by provider-local date range. `staffUserId` filters to one person; the server lets only lifecycle roles leave it out. */
export function useIntakeVisits(params: { from?: string; to?: string; staffUserId?: string }, enabled = true) {
  return useQuery({ queryKey: ['intake-visits', params], enabled, queryFn: () => apiGet<IntakeVisitDto[]>('/intake-visits', params) })
}
