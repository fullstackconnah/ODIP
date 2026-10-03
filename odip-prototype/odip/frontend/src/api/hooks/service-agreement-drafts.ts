import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, apiGet, apiPost } from '../client'
import type { CreateServiceAgreementDraftDto, DemoJourneySimulationDto, ElectronicSigningEvidenceDto, ElectronicSigningSnapshotDto, ServiceAgreementDraftDto, SubmitElectronicSigningEvidenceDto } from '../types'

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
