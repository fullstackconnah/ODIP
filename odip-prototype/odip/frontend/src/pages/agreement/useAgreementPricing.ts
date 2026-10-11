import { useMemo } from 'react'
import type { AgreementState, PlanIssue, PlanPriceZone } from '@/api/types'
import { useAgreementCheck, usePlanBudget, usePlanPricingSettings, type PlanBudget } from '@/api/hooks'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { groupShifts, type Shift } from '@/lib/agreementShifts'
import { blockProblems, stampLocation } from '@/lib/planBlocks'
import { periodProblem, refusals } from '@/lib/planQuote'
import { agreementBudgetView } from './agreementBudgetView'

type Args = {
  participantId: string
  shifts: readonly Shift[]
  state: AgreementState
  zone: PlanPriceZone
  from: string
  to: string
  /** False for a person who only reads: nothing is quoted and the stored answer (if any) is what the screen shows. */
  canQuote: boolean
  /** What a saved revision was priced with: shown instead of a live quote while the agreement cannot be changed. */
  stored?: PlanBudget
}

/**
 * The agreement's prices as the schedule stands: the shifts become the engine's blocks, the blocks are priced when the coordinator pauses (the running total and the budget check, the two
 * quotes one after the other so they never pass the organisation's limit of two in flight), and the answer is read back in shifts. A shift with something missing is left out of the quote and
 * counted. Nothing here decides whether anything can be saved: that is the engine's refusals, listed in `refused`.
 */
export function useAgreementPricing({ participantId, shifts, state, zone, from, to, canQuote, stored }: Args) {
  const settings = usePlanPricingSettings(canQuote).data
  const groups = useMemo(() => groupShifts(shifts), [shifts])
  const { quoted, leftOut } = useMemo(() => {
    const complete = groups.filter(group => blockProblems(group.entry.block).length === 0)
    return {
      quoted: complete.map(group => stampLocation(group.entry.block, state, zone)),
      leftOut: groups.filter(group => !complete.includes(group)).reduce((sum, group) => sum + group.shiftIds.length, 0),
    }
  }, [groups, state, zone])
  const settled = useDebouncedValue(quoted)
  const settling = JSON.stringify(settled) !== JSON.stringify(quoted)
  const budget = usePlanBudget(settled, from, to, canQuote && settled.length > 0)
  // The agreement against the participant's real pools (phase 2b), asked of the same debounced blocks and only once the budget's own quotes have finished.
  const check = useAgreementCheck(participantId, settled, from, to, canQuote && !budget.isFetching && !budget.isError)
  // Dates that cannot be priced over are asked of nobody, and with the query off nothing on screen may be the answer for the dates there were before.
  const dates = periodProblem(from, to)
  const live = dates === null && quoted.length > 0 ? budget.data : undefined
  const answer = !canQuote && stored ? stored : live
  const status: 'idle' | 'loading' | 'error' | 'ready' = !canQuote && stored ? 'ready'
    : !canQuote || quoted.length === 0 || dates !== null ? 'idle' : answer ? 'ready' : budget.isError ? 'error' : 'loading'
  const budgetView = agreementBudgetView(participantId, {
    wanted: canQuote && quoted.length > 0 && dates === null,
    data: check.data,
    failed: check.isError,
    pending: settling || budget.isFetching || check.isFetching || check.isPlaceholderData,
    onRetry: () => { void check.refetch() },
  })
  const issues: PlanIssue[] = answer?.period.issues ?? []
  return {
    settings, groups, answer, status, budgetView, issues, refused: refusals(issues), dates, leftOut,
    refreshing: settling || (budget.isFetching && !!answer),
    error: budget.error,
    retry: () => { void budget.refetch() },
  }
}
