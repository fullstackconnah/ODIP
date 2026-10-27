import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../client'
import { refreshBudgetFigures } from './funding-ledger'
import { AGREEMENTS_ENDING_KEY, AGREEMENTS_KEY } from './service-agreement-drafts'
import { CHUNK, runInChunks, type ChunkRun } from '../../lib/runInChunks'
import type { AgreementApproveResult, AgreementDraftRef, AgreementList } from '../types'

/** One row per participant with an agreement revision (Agreements page). Filtering is the page's. */
export function useAgreements() {
  return useQuery({ queryKey: AGREEMENTS_KEY, queryFn: () => apiGet<AgreementList>('/service-agreements') })
}

/** A chunk approves up to 25 revisions in series, so it can run close to the proxies' minute. */
const BATCH_TIMEOUT_MS = 60_000

/**
 * Approves the given drafts, CHUNK at a time, one request after another (the server runs each through the same approval as the single button).
 * Answers every item it sent; a failed request stops the run and says how many were not sent. Whatever was approved changes the roster, the budget and the lists, so those are read again.
 */
export function useApproveAgreements(onProgress?: (done: number) => void) {
  const queryClient = useQueryClient()
  return useMutation<ChunkRun<AgreementApproveResult>, never, AgreementDraftRef[]>({
    mutationFn: items => runInChunks(items, CHUNK,
      chunk => apiPost<AgreementApproveResult[]>('/service-agreements/approve-batch', { items: chunk }, { timeout: BATCH_TIMEOUT_MS }), onProgress),
    onSettled: (run, _e, items) => Promise.all([
      queryClient.invalidateQueries({ queryKey: AGREEMENTS_KEY }),
      queryClient.invalidateQueries({ queryKey: AGREEMENTS_ENDING_KEY }),
      queryClient.invalidateQueries({ queryKey: ['service-agreement-drafts'] }),
      queryClient.invalidateQueries({ queryKey: ['service-agreement-draft'] }),
      queryClient.invalidateQueries({ queryKey: ['roster-board'] }),
      queryClient.invalidateQueries({ queryKey: ['roster-patterns'] }),
      refreshBudgetFigures(queryClient, [...new Set((run?.results ?? items).map(r => r.participantId))]),
    ]),
  })
}
