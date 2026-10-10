import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGetWithDefault, apiPostRaw, apiDeleteRaw } from '../client'
import { caregiverGet, caregiverPut, caregiverPost } from '../caregiverClient'
import type {
  CaregiverFormDto, CaregiverDraftDto, CaregiverLinkDto,
  CaregiverSubmissionListItemDto, CaregiverSubmissionDetailDto, CaregiverSubmissionStatus,
} from '../types/caregiver'

// ── Public (token) — no session, no cache sharing with the app ──

export function usePublicCaregiverForm(token: string | undefined) {
  return useQuery({
    queryKey: ['public-caregiver', token],
    queryFn: async () => (await caregiverGet<CaregiverFormDto>(`/public/caregiver/${token}`)).data!,
    enabled: !!token,
    retry: false,          // a 404 is the answer, not a transient
    staleTime: Infinity,   // re-read only on explicit invalidation
  })
}

export function useSaveCaregiverDraft(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CaregiverDraftDto) => caregiverPut(`/public/caregiver/${token}/draft`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['public-caregiver', token] }),
  })
}

export function useSubmitCaregiverForm(token: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CaregiverDraftDto) => caregiverPost(`/public/caregiver/${token}/submit`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['public-caregiver', token] }),
  })
}

// ── Admin (JWT) ──

export function useGenerateCaregiverLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId }: { participantId: string }) =>
      apiPostRaw<CaregiverLinkDto>(`/participants/${participantId}/caregiver-link`, {}),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['participant', vars.participantId] })
      qc.invalidateQueries({ queryKey: ['caregiver-submissions'] })
    },
  })
}

export function useRevokeCaregiverLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId }: { participantId: string }) =>
      apiDeleteRaw(`/participants/${participantId}/caregiver-link`),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['participant', vars.participantId] })
      qc.invalidateQueries({ queryKey: ['caregiver-submissions'] })
    },
  })
}

export function useCaregiverSubmissions(
  status: CaregiverSubmissionStatus = 'Submitted',
  { participantId, enabled = true }: { participantId?: string; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ['caregiver-submissions', status, participantId],
    queryFn: () => apiGetWithDefault<CaregiverSubmissionListItemDto[]>(
      `/caregiver-submissions?status=${status}${participantId ? `&participantId=${participantId}` : ''}`, []),
    enabled,
  })
}

export function useCaregiverSubmission(id: string | undefined) {
  return useQuery({
    queryKey: ['caregiver-submission', id],
    queryFn: () => apiGetWithDefault<CaregiverSubmissionDetailDto | null>(`/caregiver-submissions/${id}`, null),
    enabled: !!id,
  })
}

export function useAcceptCaregiverSubmission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; participantId: string }) => apiPostRaw(`/caregiver-submissions/${id}/accept`, {}),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['caregiver-submissions'] })
      qc.invalidateQueries({ queryKey: ['caregiver-submission', vars.id] })
      qc.invalidateQueries({ queryKey: ['participant', vars.participantId] })
      qc.invalidateQueries({ queryKey: ['participants'] })
    },
  })
}

export function useRejectCaregiverSubmission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => apiPostRaw(`/caregiver-submissions/${id}/reject`, { note }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['caregiver-submissions'] })
      qc.invalidateQueries({ queryKey: ['caregiver-submission', vars.id] })
    },
  })
}
