import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, apiGet, apiPost } from '../client'
import type { ApproveDraftDto, CreateServiceAgreementDraftDto, DemoJourneySimulationDto, DraftApprovalPreviewDto, ElectronicSigningEvidenceDto, ElectronicSigningSnapshotDto, ServiceAgreementDraftDto, SubmitElectronicSigningEvidenceDto } from '../types'

const path = (participantId: string) => `/participants/${participantId}/service-agreement-drafts`

export function useServiceAgreementDrafts(participantId: string | undefined) {
  return useQuery({
    queryKey: ['service-agreement-drafts', participantId],
    queryFn: () => apiGet<ServiceAgreementDraftDto[]>(path(participantId!)),
    enabled: !!participantId,
  })
}

/** One revision in full: how an older one's blocks, lines and answer are read (the list leaves them out). */
export function useServiceAgreementDraft(participantId: string | undefined, id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['service-agreement-draft', participantId, id],
    queryFn: () => apiGet<ServiceAgreementDraftDto>(`${path(participantId!)}/${id}`),
    enabled: enabled && !!participantId && !!id,
    // A revision is never edited, so what was read once is what it is.
    staleTime: Infinity,
  })
}

export function useCreateServiceAgreementDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, data }: { participantId: string; data: CreateServiceAgreementDraftDto }) =>
      apiPost<ServiceAgreementDraftDto>(path(participantId), data),
    onSuccess: (_, { participantId }) => queryClient.invalidateQueries({ queryKey: ['service-agreement-drafts', participantId] }),
  })
}

const previewKey = (participantId: string | undefined, id: string | undefined) => ['service-agreement-draft-approval-preview', participantId, id] as const

/**
 * What approving a revision for rostering would do, with nothing done (the confirm dialog's counts, the reasons it cannot be approved, the hand-made patterns that overlap). It depends on the roster as it is
 * now, so it is read again every time it is wanted (the dialog opens) and kept for no longer than that.
 */
export function useApprovalPreview(participantId: string | undefined, id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: previewKey(participantId, id),
    queryFn: () => apiGet<DraftApprovalPreviewDto>(`${path(participantId!)}/${id}/approval-preview`),
    enabled: enabled && !!participantId && !!id,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  })
}

/**
 * How long the approval request is waited for. The confirm dialog holds every way out while the request is on its way, and the shared client sets no timeout, so a dropped connection would leave it
 * up until the browser gave up. Approving twice is safe (an approved revision answers with its existing approval), so giving up and asking the person to check the card cannot do harm.
 */
export const APPROVE_TIMEOUT_MS = 30_000

/**
 * Approves the newest revision for rostering: the server records who and when, makes the weekly roster patterns and the unfilled shifts, and ends the patterns of the revision before. It changes what
 * the revisions list, the patterns page, the roster board and the participant's rostering tab show, so each is refreshed. A refusal (a newer revision exists, something the preview did not know) refreshes
 * only the revisions and the preview: nothing on the roster changed.
 */
export function useApproveServiceAgreementDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, draftId, acknowledgeOverlaps }: { participantId: string; draftId: string } & ApproveDraftDto) =>
      apiPost<ServiceAgreementDraftDto>(`${path(participantId)}/${draftId}/approve`, { acknowledgeOverlaps }, { timeout: APPROVE_TIMEOUT_MS }),
    onSuccess: (_, { participantId }) => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['service-agreement-drafts', participantId] }),
      queryClient.invalidateQueries({ queryKey: ['service-agreement-draft', participantId] }),
      queryClient.invalidateQueries({ queryKey: ['roster-board'] }),
      queryClient.invalidateQueries({ queryKey: ['roster-patterns'] }),
      queryClient.invalidateQueries({ queryKey: ['participant-rostering', participantId] }),
    ]),
    onError: (_, { participantId, draftId }) => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['service-agreement-drafts', participantId] }),
      queryClient.invalidateQueries({ queryKey: previewKey(participantId, draftId) }),
    ]),
  })
}

/** Downloads the raw non-binding draft PDF through the authenticated client. */
export function useDownloadServiceAgreementDraftPdf() {
  return useMutation({
    mutationFn: async ({ participantId, id }: { participantId: string; id: string }) => {
      const response = await apiClient.get<Blob>(`${path(participantId)}/${id}/pdf`, { responseType: 'blob' })
      const disposition = response.headers['content-disposition'] as string | undefined
      const match = disposition ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition) : null
      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = match?.[1] ? decodeURIComponent(match[1]) : `service-agreement-draft-v${id}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    },
  })
}

export function useCreateElectronicSigningSnapshot() {
  return useMutation({
    mutationFn: ({ participantId, draftId, draftVersion }: { participantId: string; draftId: string; draftVersion: number }) =>
      apiPost<ElectronicSigningSnapshotDto>(`${path(participantId)}/signing-snapshots`, { draftId, draftVersion }),
  })
}

export function useSubmitElectronicSigningEvidence() {
  return useMutation({
    mutationFn: ({ participantId, snapshotId, data }: { participantId: string; snapshotId: string; data: SubmitElectronicSigningEvidenceDto }) =>
      apiPost<ElectronicSigningEvidenceDto>(`${path(participantId)}/signing-snapshots/${snapshotId}/evidence`, data),
  })
}

export function useDemoJourneySimulation() {
  return useMutation({
    mutationFn: ({ participantId, draftId }: { participantId: string; draftId: string }) =>
      apiPost<DemoJourneySimulationDto>(`${path(participantId)}/${draftId}/demo-journey-simulation`, {}),
  })
}
