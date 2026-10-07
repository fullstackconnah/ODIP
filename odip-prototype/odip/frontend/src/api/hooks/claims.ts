import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPutRaw, apiPatchRaw, apiDeleteRaw } from '../client'
import { ledgerKey } from './funding-ledger'
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
 * the fetch — additive, so existing callers passing nothing keep fetching as soon as `tripId` is
 * known. */
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

// ══════════════════════════════════════════════════════════════
// LEDGER INVALIDATION (budget phase 2a / PR193)
// ══════════════════════════════════════════════════════════════

// The budget ledger is cached under ['participant-funding', participantId, 'ledger'] (funding-ledger.ts). A claim write changes what the server works out on the next read of that ledger -- claimed, pending, used, booked ahead, the forecast, the status, the row list -- so the figures have to be read again. Without this an open ledger keeps showing what a claim just spent as still available.

/** The participants a claim moves money for, read off the claim itself: its own `participantId` (a Shift-kind claim carries it, since it has no trip) plus every participant on its line items (a Trip-kind claim carries one per booking, and only the detail response spells those out). Line-item participants are nullable, so they are filtered rather than assumed. An empty result is not a guess at an id -- it means "fall back to whoever's ledger is actually open". */
function claimParticipantIds(claim: TripClaimDetailDto | TripClaimListDto | undefined): string[] {
  if (!claim) return []
  const lineItemIds = 'lineItems' in claim ? claim.lineItems.map((item) => item.participantId) : []
  const ids = [claim.participantId, ...lineItemIds]
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

/** The participants whose ledger key this client currently holds, used only as the fallback when a mutation names none -- so the refresh reaches the open ledgers and nothing else. */
function cachedLedgerParticipants(queryClient: QueryClient): string[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: ['participant-funding'] })
    .filter((query) => query.queryKey[0] === 'participant-funding' && query.queryKey[2] === 'ledger')
    .map((query) => query.queryKey[1])
    .filter((id): id is string => typeof id === 'string')
}

/** Refresh one participant's ledger -- and its "show more" row pages, which hang off the same key -- after a claim write that moves their money. Narrowed to the participants the claim names rather than the whole funding namespace: a claim write moves no plan record and no billing hint, and both sit under that same prefix, so invalidating the prefix would refetch figures the write never touched. */
function refreshLedgers(queryClient: QueryClient, participantIds: string[]) {
  const ids = participantIds.length > 0 ? [...new Set(participantIds)] : cachedLedgerParticipants(queryClient)
  for (const participantId of ids) void queryClient.invalidateQueries({ queryKey: ledgerKey(participantId) })
}

/** The claim detail this client already holds. Read before the claim key is invalidated, since that is the claim as the last read it -- the participants it covers live there and nowhere else in the response (the update and delete writes answer `true`/`void`). */
function cachedClaim(queryClient: QueryClient, claimId: string): TripClaimDetailDto | undefined {
  return queryClient.getQueryData<TripClaimDetailDto>(['claim', claimId])
}

export function useGenerateClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data?: GenerateClaimRequestDto }) =>
      // POST /trips/{id}/claims answers ApiResponse<TripClaimListDto> -- a summary row, not the
      // claim detail (ClaimsController.GenerateClaim maps only Id/Kind/TripInstanceId/TripName/
      // Status/ClaimReference/TotalAmount/CreatedAt/SubmittedDate).
      apiPost<TripClaimListDto>(`/trips/${tripId}/claims`, data ?? {}),
    onSuccess: (created, { tripId }) => {
      qc.invalidateQueries({ queryKey: ['trip-claims', tripId] })
      // Generating a claim spends the participants it books, but that summary names none of them
      // for a Trip-kind claim (no participantId, no line items), so this lands on the fallback:
      // refresh the ledger keys this client actually holds open.
      refreshLedgers(qc, claimParticipantIds(created))
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
      // Authorising, approving or paying a claim moves every participant it covers, and the claim
      // detail we already hold is where their ids come from. Read it before the invalidation below.
      const participants = claimParticipantIds(cachedClaim(qc, claimId))
      qc.invalidateQueries({ queryKey: ['claim', claimId] })
      qc.invalidateQueries({ queryKey: ['trip-claims'] })
      refreshLedgers(qc, participants)
    },
  })
}

export function useUpdateClaimLineItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ claimId, itemId, data }: { claimId: string; itemId: string; data: UpdateClaimLineItemDto }) =>
      apiPatchRaw<boolean>(`/claims/${claimId}/line-items/${itemId}`, data),
    onSuccess: (_, { claimId, itemId }) => {
      // One line item's hours, price, status or paid amount moves only that item's participant's
      // ledger, so narrow to them; fall back to the whole claim only when the item names nobody.
      const claim = cachedClaim(qc, claimId)
      const item = (claim?.lineItems ?? []).find((line) => line.id === itemId)
      const participants = item?.participantId ? [item.participantId] : claimParticipantIds(claim)
      qc.invalidateQueries({ queryKey: ['claim', claimId] })
      refreshLedgers(qc, participants)
    },
  })
}

export function useDeleteClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (claimId: string) => apiDeleteRaw<boolean>(`/claims/${claimId}`),
    onSuccess: (_, claimId) => {
      // A deleted claim takes its rows and amounts back out of every participant's ledger it
      // covered, so the same pre-invalidation read supplies who they were.
      const participants = claimParticipantIds(cachedClaim(qc, claimId))
      qc.invalidateQueries({ queryKey: ['trip-claims'] })
      refreshLedgers(qc, participants)
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
 * claimable elsewhere in the app without a manual refresh. The participant's budget ledger is
 * refreshed too: claiming those shifts turns their booked-ahead hours into claimed money. */
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
      refreshLedgers(qc, [participantId])
    },
  })
}
