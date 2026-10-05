import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { LedgerRowsPage, ParticipantLedgerDto } from '../types'

// The budget ledger (budget feature, phase 2a). The server works every figure out on each read; this only asks for it, under the same ['participant-funding', participantId] prefix the plan
// record uses, so a plan write refreshes the figures with the record they belong to. Money is on this endpoint and nowhere else, so pass `enabled: false` for any role that must not see it.

const LEDGER_KEY = 'ledger' as const
export const ledgerKey = (participantId: string | undefined) => ['participant-funding', participantId, LEDGER_KEY] as const

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
