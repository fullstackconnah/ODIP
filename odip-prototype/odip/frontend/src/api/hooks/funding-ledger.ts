import { useQuery, type QueryClient } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { ParticipantLedgerDto } from '../types'
import { AGREEMENT_CHECK_KEY, BUDGET_LIST_KEY } from './funding-warnings'

// The budget ledger (budget feature, phase 2a). The server works every figure out on each read; this only asks for it, under the same ['participant-funding', participantId] prefix the plan
// record uses, so a plan write refreshes the figures with the record they belong to. Money is on this endpoint and nowhere else, so pass `enabled: false` for any role that must not see it.

const LEDGER_KEY = 'ledger' as const
export const ledgerKey = (participantId: string | undefined) => ['participant-funding', participantId, LEDGER_KEY] as const

// ══════════════════════════════════════════════════════════════
// REFRESHING THE LEDGER AFTER A WRITE
// ══════════════════════════════════════════════════════════════

// The server works the ledger out on every read from the claims, shifts and trip bookings, so any write that moves a participant's money has to mark what this client holds as stale: a
// claim, a shift (made, changed, cancelled, a completion approved), a trip booking (confirmed, cancelled), a trip's status or dates, and the "approaching" percentage (it changes every
// status). The claim pages carry the ledger's answer too (the budget block of GET claims/{id}), so they are refreshed with it.

/** The participants whose ledger this client currently holds: a walk of the cache, so no key is invented. */
export function cachedLedgerParticipants(queryClient: QueryClient): string[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: ['participant-funding'] })
    .filter((query) => query.queryKey[0] === 'participant-funding' && query.queryKey[2] === LEDGER_KEY)
    .map((query) => query.queryKey[1])
    .filter((id): id is string => typeof id === 'string')
}

/**
 * Refresh participants' ledgers, and their "show more" row pages, which hang off the same key. Given the participants a write names it is narrowed to them; given none (a write that does not
 * say whose money it moves, or one that moves everybody's) it falls back to whichever ledgers this client actually holds, so the refresh reaches the open ledgers and nothing else. It is
 * narrower than the whole ['participant-funding'] namespace on purpose: that prefix also holds the plan record and the Billing hint, which none of these writes touch.
 */
export function refreshLedgers(queryClient: QueryClient, participantIds: readonly string[] = []) {
  const ids = participantIds.length > 0 ? [...new Set(participantIds)] : cachedLedgerParticipants(queryClient)
  for (const participantId of ids) void queryClient.invalidateQueries({ queryKey: ledgerKey(participantId) })
}

/** The claim pages hold the budget block of a claim as of their last read, so they are read again whenever the ledger they were worked out from may have moved. */
export function refreshClaimBudgets(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ['claim'] })
}

/**
 * What is worked out from the same figures and warns about them (budget phase 2b): the participant alerts the dashboard's Budgets at risk tile and the participant banners read, the Budgets list,
 * and any agreement check on screen. A write that moves a participant's money (a claim, a shift, a trip booking, a plan record, the "approaching" percentage) leaves all of them stale, so they are
 * read again. They are not narrowed to the participants a write names: the aggregate and the list hold everybody, and the keys are few.
 */
export function refreshBudgetWarnings(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ['participant-alerts-aggregate'] })
  void queryClient.invalidateQueries({ queryKey: ['participant-alerts'] })
  void queryClient.invalidateQueries({ queryKey: BUDGET_LIST_KEY })
  void queryClient.invalidateQueries({ queryKey: [AGREEMENT_CHECK_KEY] })
}

/**
 * Everything that shows the ledger's figures, or a warning worked out from them: the ledgers (the participants named, else the ones held), the claim pages, and the alerts, the Budgets list and the
 * agreement checks. A write that calls this refreshes the warnings with the figures. A write that moves money with no ledger to name, like a plan record (its key prefix already covers its ledger),
 * or a claim (which narrows the claim pages to its own), calls the pieces it needs.
 */
export function refreshBudgetFigures(queryClient: QueryClient, participantIds: readonly string[] = []) {
  refreshLedgers(queryClient, participantIds)
  refreshClaimBudgets(queryClient)
  refreshBudgetWarnings(queryClient)
}

/**
 * The participant's current plan's ledger: per pool and funding period its limit, what is carried in, what is available, claimed, pending, booked ahead, the forecast and the status, the
 * plan's total, and the first page of each period's rows. A participant with no plan that has started answers with `planIsCurrent: false` and no pools: that is "no figure", never a zero.
 */
export function useFundingLedger(participantId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ledgerKey(participantId),
    queryFn: () => apiGet<ParticipantLedgerDto>(`/participants/${participantId}/funding/ledger`),
    enabled: !!participantId && enabled,
  })
}
