import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPutRaw, apiPatchRaw, apiDeleteRaw } from '../client'
import type {
  TripClaimListDto,
  TripClaimDetailDto,
  GenerateClaimRequestDto,
  ClaimPreviewRequestDto,
  ClaimPreviewResponseDto,
  UpdateClaimDto,
  UpdateClaimLineItemDto,
  ClaimKind,
  GenerateShiftClaimRequestDto,
  ShiftClaimPreviewResponseDto,
} from '../types'

/** PP-61: `options.enabled` lets a caller (e.g. a tab that only needs this once visited) defer
 * the fetch — additive, so existing callers passing nothing keep fetching as soon as `tripId`
 * is known. */
export function useTripClaims(tripId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['trip-claims', tripId],
    queryFn: () => apiGet<TripClaimListDto[]>(`/trips/${tripId}/claims`),
    enabled: !!tripId && (options?.enabled ?? true),
  })
}

export function useClaim(claimId: string | undefined) {
  return useQuery({
    queryKey: ['claim', claimId],
    queryFn: () => apiGet<TripClaimDetailDto>(`/claims/${claimId}`),
    enabled: !!claimId,
  })
}

export function useGenerateClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data?: GenerateClaimRequestDto }) =>
      apiPost<TripClaimDetailDto>(`/trips/${tripId}/claims`, data ?? {}),
    onSuccess: (_, { tripId }) => {
      qc.invalidateQueries({ queryKey: ['trip-claims', tripId] })
    },
  })
}

export function usePreviewClaim() {
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data: ClaimPreviewRequestDto }) =>
      apiPost<ClaimPreviewResponseDto>(`/trips/${tripId}/claims/preview`, data),
  })
}

export function useUpdateClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ claimId, data }: { claimId: string; data: UpdateClaimDto }) =>
      apiPutRaw<boolean>(`/claims/${claimId}`, data),
    onSuccess: (_, { claimId }) => {
      qc.invalidateQueries({ queryKey: ['claim', claimId] })
      qc.invalidateQueries({ queryKey: ['trip-claims'] })
    },
  })
}

export function useUpdateClaimLineItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ claimId, itemId, data }: { claimId: string; itemId: string; data: UpdateClaimLineItemDto }) =>
      apiPatchRaw<boolean>(`/claims/${claimId}/line-items/${itemId}`, data),
    onSuccess: (_, { claimId }) => {
      qc.invalidateQueries({ queryKey: ['claim', claimId] })
    },
  })
}

export function useDeleteClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (claimId: string) => apiDeleteRaw<boolean>(`/claims/${claimId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-claims'] })
    },
  })
}

// ══════════════════════════════════════════════════════════════
// PARTICIPANT CLAIMS / CLAIM-FROM-SHIFTS (shift-completion design spec §2/§4, PR 3)
// ══════════════════════════════════════════════════════════════

/** GET /participants/{participantId}/claims?kind= — both Trip- and Shift-kind claims for a
 * participant (participant-detail/ClaimsTab.tsx); omit `kind` to fetch both. */
export function useParticipantClaims(participantId: string | undefined, kind?: ClaimKind) {
  return useQuery({
    queryKey: ['participant-claims', participantId, kind],
    queryFn: () => apiGet<TripClaimListDto[]>(`/participants/${participantId}/claims`, kind ? { kind } : undefined),
    enabled: !!participantId,
  })
}

export function usePreviewShiftClaim() {
  return useMutation({
    mutationFn: ({ participantId, data }: { participantId: string; data: GenerateShiftClaimRequestDto }) =>
      apiPost<ShiftClaimPreviewResponseDto>(`/participants/${participantId}/claims/from-shifts/preview`, data),
  })
}

/** Invalidates the participant's own claims list, the generic claims/trip-claims namespaces, and
 * the completions queue (['rostering-completions']) + roster board (['roster-board']) — the
 * caches that back "is this shift still claimable" — so a just-claimed shift stops looking
 * claimable elsewhere in the app without a manual refresh. */
export function useGenerateShiftClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ participantId, data }: { participantId: string; data: GenerateShiftClaimRequestDto }) =>
      apiPost<TripClaimListDto>(`/participants/${participantId}/claims/from-shifts`, data),
    onSuccess: (_, { participantId }) => {
      qc.invalidateQueries({ queryKey: ['participant-claims', participantId] })
      qc.invalidateQueries({ queryKey: ['claims'] })
      qc.invalidateQueries({ queryKey: ['trip-claims'] })
      qc.invalidateQueries({ queryKey: ['rostering-completions'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
    },
  })
}
