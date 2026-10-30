import { isAxiosError } from 'axios'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiClient, apiGet, apiPost } from '../client'
import { readText, serverSentence } from './data-export'
import type { BatchDetailDto, BatchDto, BatchLineDto, BuildBatchRequestDto, BuildProblemDto, HubLinesDto, MarkPaidRequestDto, ResultsImportDto } from '../types'

// The NDIA claims hub: the claimable lines, the bulk payment request files built from them, and what comes back.

export function useHubLines() {
  return useQuery({ queryKey: ['claim-hub', 'lines'], queryFn: () => apiGet<HubLinesDto>('/claim-hub/lines') })
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
