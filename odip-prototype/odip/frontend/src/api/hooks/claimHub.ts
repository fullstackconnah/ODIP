import { isAxiosError } from 'axios'
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiClient, apiGet, apiPost } from '../client'
import { readText, serverSentence } from './data-export'
import { fetchPagedList } from './pagedList'
import { awaitsData } from '@/lib/queryPhase'
import { refreshBudgetWarnings, refreshLedgers } from './funding-ledger'
import type { BatchDetailDto, BatchDto, BatchLineDto, BuildBatchRequestDto, BuildProblemDto, CancellationCandidatesDto, HubLinesDto, ManualClaimPreviewDto, ManualClaimRequestDto, ManagedClaimDto, MarkPaidRequestDto, PipelineDto, ResultsImportDto, ShiftClaimGeneratedDto, ShiftClaimPreviewResponseDto, ShiftClaimWaitingDto } from '../types'

// The NDIA claims hub: the claimable lines, the bulk payment request files built from them, and what comes back.

export function useHubLines() {
  return useQuery({ queryKey: ['claim-hub', 'lines'], queryFn: () => apiGet<HubLinesDto>('/claim-hub/lines') })
}

/** GET /claim-hub/managed: one server-paged slice of the plan- and self-managed claims, newest first. The previous page stays on screen while the next one loads. Under the claim-hub key, so every hub write refreshes it. */
export function useManagedClaims(params: Record<string, string>) {
  return useQuery({
    queryKey: ['claim-hub', 'managed', params],
    queryFn: () => fetchPagedList<ManagedClaimDto>('/claim-hub/managed', params),
    placeholderData: keepPreviousData,
  })
}

export const CLAIM_PIPELINE_KEY = ['claim-hub', 'pipeline'] as const
/** Dollars sent and paid by week (under the claim-hub key, so every hub write refreshes it). */
export function useClaimPipeline() {
  return useQuery({ queryKey: CLAIM_PIPELINE_KEY, queryFn: () => apiGet<PipelineDto>('/claim-hub/pipeline') })
}

export const UNCLAIMED_SHIFTS_KEY = ['claim-hub', 'unclaimed-shifts'] as const
/**
 * The dashboard cue: completed shifts the claim run would look at that no live claim has taken. `loading` is a request in flight or paused (`awaitsData`) and `error` a failed one, so a caller can tell
 * "nothing is waiting" from "we do not know yet" (the count is 0 in both). Under the claim-hub key, so the claim run refreshes it; the writes that release or add shifts do the same by this key.
 */
export function useUnclaimedShifts(enabled: boolean): { count: number; participants: number; older: number; overdue: number; oldestDate: string | null; loading: boolean; error: boolean } {
  const q = useQuery({ queryKey: UNCLAIMED_SHIFTS_KEY, queryFn: () => apiGet<ShiftClaimWaitingDto>('/claims/from-shifts/waiting'), enabled })
  return {
    count: q.data?.shiftCount ?? 0, participants: q.data?.participantCount ?? 0,
    older: q.data?.olderShiftCount ?? 0, overdue: q.data?.overdueShiftCount ?? 0, oldestDate: q.data?.oldestDate ?? null,
    loading: enabled && awaitsData(q), error: q.isError,
  }
}

export const CANCELLATION_CANDIDATES_KEY = ['claim-hub', 'cancellations'] as const
/** The cancelled shifts that can be claimed as a short-notice cancellation, and the recent ones that cannot with why. Under the claim-hub key, so a claim made (or a shift reopened) refreshes it. */
export function useCancellationCandidates(enabled: boolean) {
  return useQuery({ queryKey: CANCELLATION_CANDIDATES_KEY, queryFn: () => apiGet<CancellationCandidatesDto>('/claims/cancellations'), enabled })
}

export function usePreviewCancellationClaim() {
  return useMutation({ mutationFn: (shiftId: string) => apiPost<ShiftClaimPreviewResponseDto>('/claims/cancellations/preview', { shiftId }) })
}

/** Makes the claim for one cancelled shift. Refreshes what the shift claim run refreshes: the claim lists, the shift queues, the participant's ledger and the budget warnings. */
export function useMakeCancellationClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ shiftId, cancellationReason }: { shiftId: string; cancellationReason: string }) => apiPost<ShiftClaimGeneratedDto>('/claims/cancellations', { shiftId, cancellationReason }),
    onSettled: (created) => {
      for (const key of ['claims', 'trip-claims', 'participant-claims', 'rostering-completions', 'roster-board', 'claim-hub', 'claim-batches']) qc.invalidateQueries({ queryKey: [key] })
      refreshLedgers(qc, created?.participantId ? [created.participantId] : [])
      refreshBudgetWarnings(qc)
    },
  })
}

export function usePreviewManualClaim() {
  return useMutation({ mutationFn: (request: ManualClaimRequestDto) => apiPost<ManualClaimPreviewDto>('/claims/manual/preview', request) })
}

/** Makes a one-off claim. Refreshes what the cancellation claim refreshes: the claim lists, the hub, the participant's ledger and the budget warnings. */
export function useMakeManualClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (request: ManualClaimRequestDto) => apiPost<ShiftClaimGeneratedDto>('/claims/manual', request),
    onSettled: (created) => {
      for (const key of ['claims', 'trip-claims', 'participant-claims', 'claim-hub', 'claim-batches']) qc.invalidateQueries({ queryKey: [key] })
      refreshLedgers(qc, created?.participantId ? [created.participantId] : [])
      refreshBudgetWarnings(qc)
    },
  })
}

export function useClaimBatches() {
  return useQuery({ queryKey: ['claim-batches'], queryFn: () => apiGet<BatchDto[]>('/claim-batches') })
}

export function useClaimBatch(batchId: string | undefined) {
  return useQuery({ queryKey: ['claim-batches', batchId], queryFn: () => apiGet<BatchDetailDto>(`/claim-batches/${batchId}`), enabled: !!batchId })
}

/** Every write here moves lines between the hub's lists and changes a file's counts, a claim's own page shows the lines' status, and marking a file uploaded issues invoices. */
export function refreshClaimHub(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['claim-hub'] })
  qc.invalidateQueries({ queryKey: ['claim-batches'] })
  qc.invalidateQueries({ queryKey: ['claim'] })
  qc.invalidateQueries({ queryKey: ['claim-invoices'] })
  qc.invalidateQueries({ queryKey: ['claims'] })
  qc.invalidateQueries({ queryKey: ['invoice-register'] })
}

function useBatchWrite<TVars, TOut>(write: (vars: TVars) => Promise<TOut>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: write, onSettled: () => refreshClaimHub(qc) })
}

export const useMarkBatchUploaded = () => useBatchWrite((batchId: string) => apiPost<BatchDto>(`/claim-batches/${batchId}/uploaded`))
export const useDiscardBatch = () => useBatchWrite((batchId: string) => apiPost<BatchDto>(`/claim-batches/${batchId}/discard`))
export const useDismissBatchLine = () => useBatchWrite((batchLineId: string) => apiPost<BatchLineDto>(`/claim-batch-lines/${batchLineId}/dismiss`))
export const useMarkBatchPaid = () => useBatchWrite(({ batchId, ...body }: MarkPaidRequestDto & { batchId: string }) => apiPost<BatchDto>(`/claim-batches/${batchId}/paid`, body))

export const useImportResults = () => useBatchWrite(({ batchId, file }: { batchId: string; file: File }) => {
  const form = new FormData()
  form.append('file', file)
  return apiPost<ResultsImportDto>(`/claim-batches/${batchId}/results`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
})

/** A refused file request: the server's sentence, its status, and for a refused build the lines that failed a check. */
export class ClaimFileError extends Error {
  readonly status: number | undefined
  readonly problems: BuildProblemDto[]
  constructor(message: string, status: number | undefined, problems: BuildProblemDto[]) {
    super(message)
    this.status = status
    this.problems = problems
  }
}

async function problemsOf(body: unknown): Promise<BuildProblemDto[]> {
  try {
    const data = body instanceof Blob ? JSON.parse(await readText(body)) : body
    return data?.data?.problems ?? []
  } catch {
    return []
  }
}

/**
 * Builds (POST `claim-batches`) or fetches (a file's re-download, a claim's own file) a bulk payment request CSV and saves it under the
 * server's file name. Returns the file's batch id so the caller can open it.
 */
export async function fetchClaimFile(method: 'get' | 'post', url: string, body: BuildBatchRequestDto | undefined, fallbackName: string, fallback = "Couldn't download the file. Try again."): Promise<{ batchId?: string; fileName: string }> {
  let res
  try {
    res = await apiClient.request<Blob>({ method, url, data: body, responseType: 'blob' })
  } catch (err) {
    const data = isAxiosError(err) ? err.response?.data : undefined
    throw new ClaimFileError(await serverSentence(data, fallback), isAxiosError(err) ? err.response?.status : undefined, await problemsOf(data))
  }
  const fileName = /filename="?([^";]+)"?/i.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ?? fallbackName
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }))
  link.download = fileName
  link.click()
  URL.revokeObjectURL(link.href)
  const batchId = res.headers['x-claim-batch-id']
  return { batchId: batchId ? String(batchId) : undefined, fileName }
}

/** fetchClaimFile for a request that builds a file: win or refuse (a 400 or 409 still moved lines), the hub's lists are stale afterwards. */
export function useBuildClaimFile() {
  const qc = useQueryClient()
  return (...args: Parameters<typeof fetchClaimFile>) => fetchClaimFile(...args).finally(() => refreshClaimHub(qc))
}
