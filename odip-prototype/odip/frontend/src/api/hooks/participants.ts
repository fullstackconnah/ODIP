import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw, apiClient } from '../client'
import type {
  ParticipantListDto,
  ParticipantDetailDto,
  CreateParticipantDto,
  UpdateParticipantDto,
  SupportProfileDto,
  BookingListDto,
  PagedResult,
} from '../types'

export function useParticipants(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['participants', params],
    queryFn: async () => {
      const result = await apiGet<PagedResult<ParticipantListDto>>('/participants', params)
      return result.items
    },
  })
}

export function useParticipant(id: string | undefined) {
  return useQuery({
    queryKey: ['participant', id],
    queryFn: () => apiGet<ParticipantDetailDto>(`/participants/${id}`),
    enabled: !!id,
  })
}

export function useParticipantBookings(id: string | undefined) {
  return useQuery({
    queryKey: ['participant-bookings', id],
    queryFn: () => apiGet<BookingListDto[]>(`/participants/${id}/bookings`),
    enabled: !!id,
  })
}

export function useSupportProfile(id: string | undefined) {
  return useQuery({
    queryKey: ['support-profile', id],
    queryFn: () => apiGet<SupportProfileDto>(`/participants/${id}/support-profile`),
    enabled: !!id,
  })
}

export function useCreateParticipant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateParticipantDto) => apiPostRaw<ParticipantDetailDto>('/participants', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['participants'] }),
  })
}

export function useUpdateParticipant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateParticipantDto }) =>
      apiPutRaw<ParticipantDetailDto>(`/participants/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['participants'] })
      qc.invalidateQueries({ queryKey: ['participant', vars.id] })
    },
  })
}

export function useDeleteParticipant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/participants/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['participants'] }),
  })
}

/**
 * DOC-01: downloads the participant's intake form as a PDF and saves it via the browser. Bypasses
 * the apiGet/ApiResponse JSON envelope entirely (the endpoint returns a raw application/pdf file,
 * not JSON) — fetches as a blob directly through apiClient, and uses the filename from the
 * response's Content-Disposition header when present, falling back to the caller-supplied fileName.
 * Same pattern as useDownloadProdaFile in billing.ts.
 */
export function useDownloadIntakeFormPdf() {
  return useMutation({
    mutationFn: async ({ id, fileName }: { id: string; fileName: string }) => {
      const response = await apiClient.get<Blob>(`/participants/${id}/documents/intake`, {
        responseType: 'blob',
      })

      const disposition = response.headers['content-disposition'] as string | undefined
      const match = disposition ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition) : null
      const downloadName = match?.[1] ? decodeURIComponent(match[1]) : fileName

      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = downloadName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    },
  })
}

/**
 * DOC-01: downloads the participant's profile as a PDF and saves it via the browser. Same pattern
 * as useDownloadIntakeFormPdf above.
 */
export function useDownloadParticipantProfilePdf() {
  return useMutation({
    mutationFn: async ({ id, fileName }: { id: string; fileName: string }) => {
      const response = await apiClient.get<Blob>(`/participants/${id}/documents/profile`, {
        responseType: 'blob',
      })

      const disposition = response.headers['content-disposition'] as string | undefined
      const match = disposition ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition) : null
      const downloadName = match?.[1] ? decodeURIComponent(match[1]) : fileName

      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = downloadName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    },
  })
}
