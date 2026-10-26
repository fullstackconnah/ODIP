import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiPatchRaw, apiDeleteRaw, apiClient } from '../client'
import { toTruncatableList } from './pagedList'
import { isNotFoundError } from '@/lib/httpStatus'
import { isSectionChanged } from '@/lib/sectionConflict'
import { SCALAR_GROUP_KEYS, type ScalarGroupKey } from '../types/participant-patch'
import type {
  ParticipantListDto,
  ParticipantDetailDto,
  CreateParticipantDto,
  ParticipantStatusResultDto,
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

/** The seven fields the whole-record PUT carries; `restrictivePracticeDetails` is deliberately not one (the register owns it). */
function pickUpdateFields(sp: SupportProfileDto | undefined): UpdateSupportProfileDto {
  return {
    communicationNotes: sp?.communicationNotes ?? undefined,
    behaviourSupportNotes: sp?.behaviourSupportNotes ?? undefined,
    manualHandlingNotes: sp?.manualHandlingNotes ?? undefined,
    medicationHealthSummary: sp?.medicationHealthSummary ?? undefined,
    emergencyConsiderations: sp?.emergencyConsiderations ?? undefined,
    travelSpecificNotes: sp?.travelSpecificNotes ?? undefined,
    reviewDate: sp?.reviewDate?.split('T')[0] ?? undefined,
  }
}

/**
 * PUT replaces the whole support profile (a field left out is nulled), so a topic card passes only its own `fields` and this builds the body
 * when the save RUNS: the cached record plus those fields. `scope` runs saves one after another, so a second card saved while the first PUT
 * is in flight still reads the first one's text. The PUT answers only Id/ParticipantId, so the full body is written to the cache before
 * the refetch; otherwise the next card would build on a stale (or, for a first save, a 404) cache. Every consumer must gate on
 * `canWriteSupportProfile` (the endpoint's own `Admin,Coordinator,SuperAdmin` gate), not `canWriteParticipantDetails`.
 */
export function useUpdateSupportProfile() {
  const qc = useQueryClient()
  return useMutation({
    scope: { id: 'support-profile' },
    mutationFn: async ({ id, fields }: { id: string; fields: Partial<UpdateSupportProfileDto> }) => {
      const key = ['support-profile', id]
      const state = qc.getQueryState(key)
      const cached = qc.getQueryData<SupportProfileDto>(key) // kept even when a background refetch failed
      const noProfileYet = state?.status === 'error' && isNotFoundError(state.error) // the PUT creates it
      if (!cached && !noProfileYet) throw new Error('Support profile has not loaded')
      const body: UpdateSupportProfileDto = { ...pickUpdateFields(cached), ...fields }
      const r = await apiPutRaw<SupportProfileDto>(`/participants/${id}/support-profile`, body)
      return { ...cached, ...body, id: r.data!.id, participantId: id } as SupportProfileDto
    },
    onSuccess: (saved, { id }) => {
      qc.setQueryData<SupportProfileDto>(['support-profile', id], saved)
      return qc.invalidateQueries({ queryKey: ['support-profile', id] })
    },
  })
}

export function useCreateParticipant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateParticipantDto) => apiPostRaw<ParticipantDetailDto>('/participants', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['participants'] })
      // Completing intake on create puts the participant on the onboarding worklist.
      qc.invalidateQueries({ queryKey: ['participant-onboarding-worklist'] })
      // A draft saved with its intake open is a direct-intake row in the enquiries feed.
      qc.invalidateQueries({ queryKey: ['participant-inquiries'] })
    },
  })
}

/**
 * Saves or completes an intake the Intake wizard is RESUMING (PUT /participants/{id}/intake). The server writes only the intake
 * scope, so nothing else on the participant can be wiped, and it creates the contacts and risk entries in the payload that the
 * participant does not already have. Never send the whole participant to PUT /participants/{id} for this: that is a full replace.
 */
export function useSaveParticipantIntake() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SaveParticipantIntakeDto }) =>
      apiPutRaw<ParticipantDetailDto>(`/participants/${id}/intake`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['participants'] })
      qc.invalidateQueries({ queryKey: ['participant', vars.id] })
      // Completing intake puts the participant on the onboarding worklist, new contacts and risks now exist, and the enquiry the
      // participant came from keeps its name and contact details in step.
      qc.invalidateQueries({ queryKey: ['participant-onboarding-worklist'] })
      qc.invalidateQueries({ queryKey: ['participant-contact-roles', vars.id] })
      qc.invalidateQueries({ queryKey: ['participant-risk-entries', vars.id] })
      qc.invalidateQueries({ queryKey: ['participant-inquiries'] })
    },
  })
}

/**
 * The onboarding checklist's two lifecycle actions (owner decision 2026-10-13), each an empty-body POST:
 * - `begin-services`: the participant can receive services (the roster board, shifts, the portal, medications) while staying on the
 *   Onboarding tab;
 * - `make-active`: finalises them onto the Active tab, open checklist items or not (Enforce keeps its activation rule and refuses with a reason).
 */
function useLifecycleAction(action: 'begin-services' | 'make-active') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string }) => apiPostRaw<ParticipantDetailDto>(`/participants/${id}/${action}`, {}),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['participants'] })
      qc.invalidateQueries({ queryKey: ['participant', vars.id] })
      qc.invalidateQueries({ queryKey: ['onboarding', vars.id] })
      qc.invalidateQueries({ queryKey: ['participant-onboarding-worklist'] })
      qc.invalidateQueries({ queryKey: ['participant-inquiries'] })
      // The board lists who can receive services and tags a services-started row.
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}

export const useBeginServices = () => useLifecycleAction('begin-services')
export const useMakeParticipantActive = () => useLifecycleAction('make-active')

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
 * This tab's own section saves, `${id}/${group}/${from}` -> from + 1: a card opened before another card's save landed
 * still saves on top of it. Another person's move never lands here, so it is still refused. Per QueryClient so tests stay apart.
 */
const ledgers = new WeakMap<QueryClient, Map<string, number>>()
const ledgerOf = (qc: QueryClient) => ledgers.get(qc) ?? ledgers.set(qc, new Map()).get(qc)!

/**
 * CORE-02: partial save — patches only the semantic field groups present in `data` (see
 * PatchParticipantDto's doc), leaving every absent group untouched server-side. One generic hook
 * for every group combination a caller needs (a wizard step's 1-4 groups, or a detail-tab
 * section's 1-2 groups) rather than a hook per section. Same invalidate-on-success shape as
 * the other participant writes. Every consumer of this hook must gate on `canWriteParticipantDetails`
 * (never the broader `canWrite`) — see SPEC-00's CORE-02 section.
 */
export function usePatchParticipant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: PatchParticipantDto }) => {
      if (!data.expectedRevisions) return apiPatchRaw<ParticipantDetailDto>(`/participants/${id}`, data)
      const ledger = ledgerOf(qc)
      const sent: Partial<Record<ScalarGroupKey, number>> = {}
      for (const k of SCALAR_GROUP_KEYS) {
        let n = data.expectedRevisions[k]
        if (data[k] === undefined || n === undefined) continue
        while (ledger.has(`${id}/${k}/${n}`)) n = ledger.get(`${id}/${k}/${n}`)!
        sent[k] = n
      }
      const before = qc.getQueryData<ParticipantDetailDto>(['participant', id]) as Record<string, unknown> | undefined
      const res = await apiPatchRaw<ParticipantDetailDto>(`/participants/${id}`, { ...data, expectedRevisions: sent })
      // The save is only done once the cache holds it: the next card rebuilds its group from the cache.
      await qc.invalidateQueries({ queryKey: ['participant', id] })
      const cached = qc.getQueryData<ParticipantDetailDto>(['participant', id])?.groupRevisions
      for (const [k, n] of Object.entries(sent) as [ScalarGroupKey, number][]) {
        // Exactly n + 1 AND a field of this group changed: the server bumps a group just for a changed column, so a group this request carried unchanged (its n + 1 is someone else's save landing mid-request), or a jump by more than one, is not ours.
        const changed = !before || Object.entries(data[k]!).some(([f, v]) => JSON.stringify(v ?? null) !== JSON.stringify(before[f] ?? null))
        if (changed && res.data?.groupRevisions?.[k] === n + 1 && (cached?.[k] ?? 0) >= n + 1) ledger.set(`${id}/${k}/${n}`, n + 1)
      }
      return res
    },
    onError: (err, vars) => {
      if (isSectionChanged(err)) qc.invalidateQueries({ queryKey: ['participant', vars.id] })
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['participants'] })
      // A save with expected revisions already awaited this refetch.
      if (!vars.data.expectedRevisions) qc.invalidateQueries({ queryKey: ['participant', vars.id] })
      // The checklist's "Profile details" item and the worklist are derived from these fields.
      qc.invalidateQueries({ queryKey: ['participant-onboarding-worklist'] })
      qc.invalidateQueries({ queryKey: ['onboarding', vars.id] })
    },
  })
}

export function useDeleteParticipant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/participants/${id}`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['participants'] })
      qc.invalidateQueries({ queryKey: ['participant', id] })
    },
  })
}

/**
 * Archives or reactivates a participant through the dedicated status endpoint (POST /participants/{id}/status). The server owns
 * the rules (a draft cannot be activated; archiving warns about upcoming shifts instead of cancelling them), so a screen shows
 * its `errors[0]` on a 400 and the result's `warnings` after a success. `reason` (max 500) is sent only when it is not blank.
 * Never send the whole participant for this: PUT /participants/{id} is a full replace.
 */
export function useUpdateParticipantStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, isActive, reason }: { id: string; isActive: boolean; reason?: string | null }) =>
      apiPostRaw<ParticipantStatusResultDto>(`/participants/${id}/status`, { isActive, ...(reason ? { reason } : {}) }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['participants'] })
      qc.invalidateQueries({ queryKey: ['participant', vars.id] })
      // Archiving or reactivating changes who the onboarding worklist lists.
      qc.invalidateQueries({ queryKey: ['participant-onboarding-worklist'] })
    },
  })
}

/**
 * Restores an archived participant (POST /participants/{id}/restore, empty body). It reactivates and changes no other field, so
 * a list row can never be sent back and wipe the profile, which is what restoring through the full-record PUT did.
 */
export function useRestoreParticipant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string }) => apiPostRaw<ParticipantStatusResultDto>(`/participants/${id}/restore`, {}),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['participants'] })
      qc.invalidateQueries({ queryKey: ['participant', vars.id] })
      qc.invalidateQueries({ queryKey: ['participant-onboarding-worklist'] })
    },
  })
}

/**
 * DOC-01: downloads the participant's intake form as a PDF and saves it via the browser. Bypasses
 * the apiGet/ApiResponse JSON envelope entirely (the endpoint returns a raw application/pdf file,
 * not JSON) — fetches as a blob directly through apiClient, and uses the filename from the
 * response's Content-Disposition header when present, falling back to the caller-supplied fileName.
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
