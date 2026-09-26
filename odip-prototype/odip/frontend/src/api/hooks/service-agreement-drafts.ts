import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, apiGet, apiPost } from '../client'
import type { CreateServiceAgreementDraftDto, ServiceAgreementDraftDto } from '../types'

const path = (participantId: string) => `/participants/${participantId}/service-agreement-drafts`

export function useServiceAgreementDrafts(participantId: string | undefined) {
  return useQuery({
    queryKey: ['service-agreement-drafts', participantId],
    queryFn: () => apiGet<ServiceAgreementDraftDto[]>(path(participantId!)),
    enabled: !!participantId,
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
