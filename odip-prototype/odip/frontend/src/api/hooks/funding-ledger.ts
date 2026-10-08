import { useQuery, type QueryClient } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { LedgerRowsPage, ParticipantLedgerDto } from '../types'

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

/** Everything that shows the ledger's figures: the ledgers (the participants named, else the ones held) and the claim pages. */
export function refreshBudgetFigures(queryClient: QueryClient, participantIds: readonly string[] = []) {
  refreshLedgers(queryClient, participantIds)
  refreshClaimBudgets(queryClient)
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

/** One more page of one period's rows, for "show more". `skip` is how many rows are already on screen. */
export function useFundingLedgerRows(participantId: string | undefined, poolId: string | undefined, periodId: string | undefined, skip: number) {
  return useQuery({
    queryKey: [...ledgerKey(participantId), 'rows', poolId, periodId, skip],
    queryFn: () => apiGet<LedgerRowsPage>(
      `/participants/${participantId}/funding/ledger/rows?poolId=${poolId}&periodId=${periodId}&skip=${skip}&take=200`,
    ),
    enabled: !!participantId && !!poolId && !!periodId && skip > 0,
  })
}
