import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, apiGet, apiPost } from '../client'
import { refreshBudgetFigures } from './funding-ledger'
import type { AgreementEndingDto, ApproveDraftDto, CreateServiceAgreementDraftDto, DraftApprovalPreviewDto, PatternChangeDto, PatternChangeResultDto, ServiceAgreementDraftDto } from '../types'

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
    onSuccess: (_, { participantId }) => {
      queryClient.invalidateQueries({ queryKey: ['service-agreement-drafts', participantId] })
      queryClient.invalidateQueries({ queryKey: AGREEMENTS_KEY })
      // The onboarding checklist's "Service needs" item and the worklist read the newest draft.
      queryClient.invalidateQueries({ queryKey: ['onboarding', participantId] })
      queryClient.invalidateQueries({ queryKey: ['participant-onboarding-worklist'] })
    },
  })
}

/**
 * A change to a roster pattern an approved agreement made (agreement PR 1). With `preview` the server works out the revision and its price difference and saves nothing. Without it, it saves the
 * revision (a Draft, for approval), and what reads the participant's revisions is refreshed. The pattern and the roster change only when that revision is approved, so they are not.
 */
export function usePatternChange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, draftId, data }: { participantId: string; draftId: string; data: PatternChangeDto }) =>
      apiPost<PatternChangeResultDto>(`${path(participantId)}/${draftId}/pattern-change`, data),
    onSuccess: (result, { participantId }) => {
      if (!result.draftId) return
      queryClient.invalidateQueries({ queryKey: ['service-agreement-drafts', participantId] })
      queryClient.invalidateQueries({ queryKey: AGREEMENTS_KEY })
      // The onboarding checklist's "Service needs" item and the worklist read the newest draft.
      queryClient.invalidateQueries({ queryKey: ['onboarding', participantId] })
      queryClient.invalidateQueries({ queryKey: ['participant-onboarding-worklist'] })
    },
  })
}

/** The Agreements page's list: any change to an agreement revision makes it stale. */
export const AGREEMENTS_KEY = ['service-agreements'] as const
export const AGREEMENTS_ENDING_KEY = ['agreements-ending'] as const

/** The organisation's agreements ending within 60 days or ended (agreement PR 2): the Participants register's Agreements ending view. */
export function useAgreementsEnding(enabled = true) {
  return useQuery({
    queryKey: AGREEMENTS_ENDING_KEY,
    queryFn: () => apiGet<AgreementEndingDto[]>('/service-agreements/ending'),
    enabled,
  })
}

/**
 * Renew agreement (agreement PR 2): the server saves the newest approved revision's blocks as the next revision, from the day after it ends, priced now. A Draft: the roster does not change.
 * It is the newest revision now, and while it waits the agreement no longer counts as ending, so the revisions, the ending list and the alerts are read again.
 */
export function useRenewAgreement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, draftId }: { participantId: string; draftId: string }) =>
      apiPost<ServiceAgreementDraftDto>(`${path(participantId)}/${draftId}/renew`),
    onSuccess: (_, { participantId }) => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['service-agreement-drafts', participantId] }),
      queryClient.invalidateQueries({ queryKey: ['onboarding', participantId] }),
      queryClient.invalidateQueries({ queryKey: ['participant-onboarding-worklist'] }),
      queryClient.invalidateQueries({ queryKey: AGREEMENTS_ENDING_KEY }),
      queryClient.invalidateQueries({ queryKey: AGREEMENTS_KEY }),
      queryClient.invalidateQueries({ queryKey: ['participant-alerts', participantId] }),
      queryClient.invalidateQueries({ queryKey: ['participant-alerts-aggregate'] }),
    ]),
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
      // An approved renewal ends the "ending" flag; the alerts are refreshed with the budget figures below.
      queryClient.invalidateQueries({ queryKey: AGREEMENTS_ENDING_KEY }),
      queryClient.invalidateQueries({ queryKey: AGREEMENTS_KEY }),
      // The unfilled shifts it makes are booked ahead in this participant's budget.
      refreshBudgetFigures(queryClient, [participantId]),
    ]),
    onError: (_, { participantId, draftId }) => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['service-agreement-drafts', participantId] }),
      queryClient.invalidateQueries({ queryKey: previewKey(participantId, draftId) }),
    ]),
  })
}

/**
 * The file name in a Content-Disposition header. The server sends the RFC 5987 `filename*=UTF-8''...` (percent-encoded, so the letters of a name like José Núñez arrive) beside an ASCII
 * `filename="..."` that has an underscore for each letter it cannot hold; the first is preferred, the second is the way back when it cannot be decoded. Null when the header names nothing.
 */
export function fileNameFromDisposition(disposition: string | undefined): string | null {
  if (!disposition) return null
  const star = /filename\*\s*=\s*utf-8'[^']*'([^;]+)/i.exec(disposition)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
    } catch {
      // not valid UTF-8 percent-encoding: use the plain name below
    }
  }
  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))/i.exec(disposition)
  return plain ? (plain[1] ?? plain[2]) : null
}

/** Downloads the raw non-binding draft PDF through the authenticated client. */
export function useDownloadServiceAgreementDraftPdf() {
  return useMutation({
    mutationFn: async ({ participantId, id }: { participantId: string; id: string }) => {
      const response = await apiClient.get<Blob>(`${path(participantId)}/${id}/pdf`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = fileNameFromDisposition(response.headers['content-disposition'] as string | undefined) ?? `service-agreement-draft-v${id}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    },
  })
}
