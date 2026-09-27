import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiPatchRaw, apiDeleteRaw, apiClient } from '../client'
import { toTruncatableList } from './pagedList'
import type {
  ParticipantListDto,
  ParticipantDetailDto,
  CreateParticipantDto,
  UpdateParticipantDto,
  SaveParticipantIntakeDto,
  PatchParticipantDto,
  SupportProfileDto,
  UpdateSupportProfileDto,
  BookingListDto,
  PagedResult,
  ParticipantRosteringDto,
  ParticipantIntakeSnapshotDto,
} from '../types'

/**
 * ParticipantsController clamps `pageSize` to a ceiling of 200 (`Math.Clamp(pageSize, 1, 200)`).
 * `useParticipants` requests that ceiling explicitly rather than accepting the server's much
 * smaller `pageSize = 50` default — see the UX-audit-round-2 fix for PagedResult call sites that
 * were silently dropping rows past the default page. The resolved array also carries
 * `totalCount`/`isTruncated` (see `pagedList.ts`) so a caller like `ParticipantPicker` can tell the
 * user when even the 200-row ceiling didn't cover every participant.
 */
const PARTICIPANTS_MAX_PAGE_SIZE = 200

export function useParticipants(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['participants', params],
    queryFn: async () => {
      const result = await apiGet<PagedResult<ParticipantListDto>>('/participants', {
        pageSize: String(PARTICIPANTS_MAX_PAGE_SIZE),
        ...params,
      })
      return toTruncatableList(result)
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

/**
 * Connection map item 12 — GET /participants/{id}/rostering, backing the participant hub's
 * Rostering tab (RosteringTab.tsx). Mirrors useParticipantBookings's enabled-on-id gate.
 */
export function useParticipantRostering(id: string | undefined) {
  return useQuery({
    queryKey: ['participant-rostering', id],
    queryFn: () => apiGet<ParticipantRosteringDto>(`/participants/${id}/rostering`),
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

/**
 * PD-6: wraps the existing, previously-unused `PUT /participants/{id}/support-profile` (see
 * ParticipantsController.UpdateSupportProfile) — the sub-resource half of the merged Support
 * Profile tab. Every consumer must gate on `canWriteSupportProfile` (mirrors that endpoint's own
 * `Authorize(Roles = "Admin,Coordinator,SuperAdmin")` gate), not `canWriteParticipantDetails` —
 * they're two different resources with two different (currently identical, but independently
 * named) role gates. Note the endpoint's response body only echoes Id/ParticipantId, not the
 * saved fields, so this hook invalidates the `support-profile` query rather than relying on the
 * mutation's own response to refresh the read side.
 */
export function useUpdateSupportProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSupportProfileDto }) =>
      apiPutRaw<SupportProfileDto>(`/participants/${id}/support-profile`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['support-profile', vars.id] })
    },
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

/** Saves only the approved intake subset for an already-created participant. */
export function useSaveParticipantIntake() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SaveParticipantIntakeDto }) =>
      apiPutRaw<ParticipantDetailDto>(`/participants/${id}/intake`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['participants'] })
      qc.invalidateQueries({ queryKey: ['participant', vars.id] })
    },
  })
}

/** Discovers immutable intake-completion revisions; never infer a revision client-side. */
export function useParticipantIntakeSnapshots(id: string | undefined) {
  return useQuery({
    queryKey: ['participant-intake-snapshots', id],
    queryFn: () => apiGet<ParticipantIntakeSnapshotDto[]>(`/participants/${id}/intake-snapshots`),
    enabled: !!id,
  })
}

/** Downloads one discovered immutable intake PDF through the authenticated API client. */
export function useDownloadParticipantIntakeSnapshotPdf() {
  return useMutation({
    mutationFn: async ({ id, revision }: { id: string; revision: number }) => {
      const response = await apiClient.get<Blob>(`/participants/${id}/intake-snapshots/${revision}/download`, { responseType: 'blob' })
      const disposition = response.headers['content-disposition'] as string | undefined
      const match = disposition ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition) : null
      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = match?.[1] ? decodeURIComponent(match[1]) : `Intake-Completion-r${revision}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    },
  })
}

/**
 * CORE-02: partial save — patches only the semantic field groups present in `data` (see
 * PatchParticipantDto's doc), leaving every absent group untouched server-side. One generic hook
 * for every group combination a caller needs (a wizard step's 1-4 groups, or a detail-tab
 * section's 1-2 groups) rather than a hook per section. Same invalidate-on-success shape as
 * useUpdateParticipant above. Every consumer of this hook must gate on `canWriteParticipantDetails`
 * (never the broader `canWrite`) — see SPEC-00's CORE-02 section.
 */
export function usePatchParticipant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PatchParticipantDto }) =>
      apiPatchRaw<ParticipantDetailDto>(`/participants/${id}`, data),
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

/**
 * PF-10.6: downloads the Client Overview ("Client Support Needs Summary") cheat-sheet PDF and
 * saves it via the browser. Same blob/Content-Disposition pattern as useDownloadIntakeFormPdf
 * above. `tripId` is optional — the Trip-detail roster surface passes it (populates the
 * TRIP/DATE/GROUP header), the Participant-detail surface omits it (blank header, same document).
 */
export function useDownloadClientOverviewPdf() {
  return useMutation({
    mutationFn: async ({ id, tripId, fileName }: { id: string; tripId?: string; fileName: string }) => {
      const response = await apiClient.get<Blob>(`/participants/${id}/documents/client-overview`, {
        responseType: 'blob',
        params: tripId ? { tripId } : undefined,
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
