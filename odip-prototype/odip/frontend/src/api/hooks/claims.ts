import { useMemo } from 'react'
import { keepPreviousData, useQueries, useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPutRaw, apiPatchRaw, apiDeleteRaw } from '../client'
import { fetchPagedList } from './pagedList'
import { refreshBudgetWarnings, refreshLedgers } from './funding-ledger'
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
  ShiftClaimGeneratedDto,
  ClaimInvoicesDto,
  SubmitPreviewDto,
  InvoiceSummaryDto,
  InvoiceRegisterRowDto,
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

// The ledger refresh itself (narrowed to the participants a write names, else the ledgers this client holds) is funding-ledger.ts's `refreshLedgers`, shared with the shift, booking, trip and settings writes.

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
      refreshBudgetWarnings(qc)
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
      // Submitting issues the claim's invoices.
      qc.invalidateQueries({ queryKey: ['claim-invoices', claimId] })
      qc.invalidateQueries({ queryKey: ['invoice-register'] })
      refreshLedgers(qc, participants)
      // Marking a claim Rejected (with the NDIA's code, which starts the "funds ran out" signal), Paid or back to Draft moves what the alerts, the dashboard's tile and the Budgets list say.
      refreshBudgetWarnings(qc)
    },
    // A refusal means the page was stale (somebody else moved the claim): reload it, so the buttons that no longer apply go.
    onError: (_, { claimId }) => {
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
    onSuccess: (_, { claimId, itemId }) => {
      // One line item's hours, price, status or paid amount moves only that item's participant's
      // ledger, so narrow to them; fall back to the whole claim only when the item names nobody.
      const claim = cachedClaim(qc, claimId)
      const item = (claim?.lineItems ?? []).find((line) => line.id === itemId)
      const participants = item?.participantId ? [item.participantId] : claimParticipantIds(claim)
      qc.invalidateQueries({ queryKey: ['claim', claimId] })
      refreshLedgers(qc, participants)
      refreshBudgetWarnings(qc)
    },
    onError: (_, { claimId }) => qc.invalidateQueries({ queryKey: ['claim', claimId] }),
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
      qc.invalidateQueries({ queryKey: ['claim-invoices', claimId] })
      qc.invalidateQueries({ queryKey: ['invoice-register'] })
      refreshLedgers(qc, participants)
      refreshBudgetWarnings(qc)
    },
  })
}

// ══════════════════════════════════════════════════════════════
// INVOICES (Xero PR1)
// ══════════════════════════════════════════════════════════════

/** GET /claims/{id}/invoices: the claim's Invoices section, its state and rows as the server says them. */
export function useClaimInvoices(claimId: string | undefined) {
  return useQuery({
    queryKey: ['claim-invoices', claimId],
    queryFn: () => apiGet<ClaimInvoicesDto>(`/claims/${claimId}/invoices`),
    enabled: !!claimId,
  })
}

/** POST /claims/submit-preview: what marking these claims as submitted would issue now. A read (POST for the id list); gcTime 0 so each open of
 * a confirm asks again rather than showing predicted numbers from an earlier open. */
export function useSubmitPreview(claimIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: ['submit-preview', ...claimIds],
    queryFn: () => apiPost<SubmitPreviewDto>('/claims/submit-preview', { claimIds }),
    enabled: enabled && claimIds.length > 0,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  })
}

const PREVIEW_CHUNK = 100 // the server refuses more claims than this in one submit-preview

/** submit-preview for any number of claims: one request per 100, invoice counts summed. refetch retries only the chunks that failed. */
export function useSubmitPreviewChunks(claimIds: string[], enabled: boolean) {
  const chunks = useMemo(() => Array.from({ length: Math.ceil(claimIds.length / PREVIEW_CHUNK) }, (_, i) => claimIds.slice(i * PREVIEW_CHUNK, (i + 1) * PREVIEW_CHUNK)), [claimIds])
  const results = useQueries({
    queries: chunks.map(chunk => ({
      queryKey: ['submit-preview', ...chunk],
      queryFn: () => apiPost<SubmitPreviewDto>('/claims/submit-preview', { claimIds: chunk }),
      enabled, gcTime: 0, staleTime: 0, retry: false,
    })),
  })
  return {
    invoiceCount: results.reduce((n, r) => n + (r.data?.invoiceCount ?? 0), 0),
    isLoading: results.some(r => r.isLoading),
    isError: results.some(r => r.isError),
    refetch: () => results.forEach(r => { if (r.isError) void r.refetch() }),
  }
}

type InvoiceCorrection = { invoiceId: string; claimId: string; reason: string }

function useInvoiceCorrection(action: 'void' | 'credit-note') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ invoiceId, reason }: InvoiceCorrection) => apiPost<InvoiceSummaryDto>(`/invoices/${invoiceId}/${action}`, { reason }),
    // A refusal can mean the row moved under us (voided or credited elsewhere): read it again either way.
    onSettled: (_, __, { claimId }) => {
      qc.invalidateQueries({ queryKey: ['claim-invoices', claimId] })
      qc.invalidateQueries({ queryKey: ['invoice-register'] })
    },
  })
}

/** POST /invoices/{id}/void with { reason }: Admin, or SuperAdmin viewing an organisation. Answers the voided invoice. */
export const useVoidInvoice = () => useInvoiceCorrection('void')

/** POST /invoices/{id}/credit-note with { reason }: answers the new credit note. */
export const useIssueCreditNote = () => useInvoiceCorrection('credit-note')

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
      apiPost<ShiftClaimGeneratedDto>(`/participants/${participantId}/claims/from-shifts`, data),
    onSuccess: (_, { participantId }) => {
      qc.invalidateQueries({ queryKey: ['participant-claims', participantId] })
      qc.invalidateQueries({ queryKey: ['claims'] })
      qc.invalidateQueries({ queryKey: ['trip-claims'] })
      qc.invalidateQueries({ queryKey: ['rostering-completions'] })
      qc.invalidateQueries({ queryKey: ['roster-board'] })
      refreshLedgers(qc, [participantId])
      refreshBudgetWarnings(qc)
    },
  })
}

/** GET /invoices: the invoice register, one server-paged slice. The previous page stays on screen while the next one loads. */
export function useInvoiceRegister(params: Record<string, string>) {
  return useQuery({
    queryKey: ['invoice-register', params],
    queryFn: () => fetchPagedList<InvoiceRegisterRowDto>('/invoices', params),
    placeholderData: keepPreviousData,
  })
}
