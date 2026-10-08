import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query'
import { apiClient, apiGet } from '../client'
import type { AgreementCheck, AgreementCheckRequest, ApiResponse, BudgetListDto, PlanBlock } from '../types'
import { periodProblem } from '@/lib/planQuote'
import { busyDelay, retryWhenBusy } from './plan-pricing'

// The places budget warnings show (budget feature, phase 2b): the Budgets list and the agreement budget bar. The participant alerts themselves are in alerts.ts. The server works every figure out
// (the ledger's, and the pricing engine's for an agreement); these only ask for it. Money is on these endpoints and nowhere else (SuperAdmin, Admin and Coordinator): pass `enabled: false` for any role
// that must not see it.

export const BUDGET_LIST_KEY = ['budget-list'] as const
const AGREEMENT_CHECK_KEY = 'agreement-check' as const
export const agreementCheckKey = (participantId: string | undefined) => [AGREEMENT_CHECK_KEY, participantId] as const

/** Every active participant's pools for the funding period running now, sorted by risk, with the NDIS-funded participants who have no budget in force kept apart at the end. */
export function useBudgetList(enabled = true) {
  return useQuery({
    queryKey: BUDGET_LIST_KEY,
    queryFn: () => apiGet<BudgetListDto>('/funding/budgets'),
    enabled,
  })
}

/** One check. A stale one is cancelled by the query's own signal, and the server stops working when the client does. */
export async function postAgreementCheck(participantId: string, request: AgreementCheckRequest, signal?: AbortSignal): Promise<AgreementCheck> {
  const response = await apiClient.post<ApiResponse<AgreementCheck>>(`/participants/${participantId}/funding/agreement-check`, request, { signal })
  return response.data.data as AgreementCheck
}

/**
 * What the agreement being built would cost against what the participant's real pools have left (POST participants/{id}/funding/agreement-check): for each pool and funding period it touches, the
 * agreement's cost, what is left, and by how much it would be over. It is a warning and never a block, so a failure of it leaves the plan as it was.
 *
 * It is the pricing engine's heaviest kind of request (the agreement is priced in process), so it keeps the quote's manners: the caller passes the DEBOUNCED blocks the running budget is priced from
 * (one request when somebody pauses, never one per keystroke), a busy service (429) is asked again after a pause, and `enabled` is how the plan builder holds it back until the running budget's own
 * quotes have finished, so the two never add up to more than the two the organisation is allowed at once. The previous answer stays on screen while a newer one is on its way.
 */
export function useAgreementCheck(participantId: string | undefined, blocks: readonly PlanBlock[], from: string, to: string, enabled = true) {
  const ready = !!participantId && enabled && blocks.length > 0 && periodProblem(from, to) === null
  return useQuery({
    queryKey: [AGREEMENT_CHECK_KEY, participantId, JSON.stringify({ blocks, from, to })],
    enabled: ready,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: retryWhenBusy,
    retryDelay: busyDelay,
    queryFn: ({ signal }) => postAgreementCheck(participantId as string, { blocks: [...blocks], periodFrom: from, periodTo: to }, signal),
  })
}

/**
 * Whatever shows a budget warning is stale once something that moves a participant's money is written: a claim (claimed or pending goes up, a rejection with an NDIA code starts or ends a signal), a
 * shift (booked ahead, or pending once its completion is approved), a plan record (the limits themselves), the organisation's "approaching" percentage (every status). So the alerts the dashboard's
 * tile and the participant banners read, the Budgets list and any agreement check on screen are all read again. The ledger's own refresh is separate (funding-ledger.ts).
 */
export function refreshBudgetWarnings(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ['participant-alerts-aggregate'] })
  void queryClient.invalidateQueries({ queryKey: ['participant-alerts'] })
  void queryClient.invalidateQueries({ queryKey: BUDGET_LIST_KEY })
  void queryClient.invalidateQueries({ queryKey: [AGREEMENT_CHECK_KEY] })
}
