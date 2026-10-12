import type { AgreementCheck } from '@/api/types'
import { fundingTabPath } from '../budgets/budgetRows'
import type { AgreementBudgetBreakdownView, AgreementBudgetPool } from '../budgets/components/viewModel'

// The adapter from the agreement check's server DTO (POST participants/{id}/funding/agreement-check) to the budget bar's view-model, as the components' README intends. It maps; it does not decide.
// The agreement's cost is the pricing engine's, "left" is the ledger's available minus used, "over by" is the server's: nothing is summed, ranked or compared here, and `withinLimit` is only the
// server's own `overBy` read as a yes or a no (the server sends 0 when the agreement fits).
//
// WARNING ONLY: nothing in the view can refuse a save or an approval, and nothing here is derived from a block, so a check that has not come back, or never will, leaves the plan as it was.

/** What the plan builder knows about the check when it draws the bar. */
export interface AgreementCheckState {
  /** The plan can be compared with a budget at all: there is a complete block, over dates it can be priced over. False is "nothing to compare yet": no view, so the bar draws no column. */
  wanted: boolean
  /** The server's answer for the plan as it was last asked about (the previous answer while a newer one is on its way). */
  data: AgreementCheck | undefined
  /** The question was asked and could not be answered. Only said while there is no answer to show. */
  failed: boolean
  /** A newer answer is on its way, or will be asked for as soon as the running budget's own quotes have finished. */
  pending: boolean
  /** Asks again after a failure. */
  onRetry: () => void
}

const SHOWN = { visible: true } as const

/** The bar's comparison for a participant, or null when there is nothing to compare yet. */
export function agreementBudgetView(participantId: string, state: AgreementCheckState): AgreementBudgetBreakdownView | null {
  if (!state.wanted) return null
  const empty = { figures: SHOWN, pools: [], notInARecordedPool: null, outsideThePlan: null }
  const { data } = state
  if (!data) return state.failed ? { ...empty, status: 'failed', onRetry: state.onRetry } : { ...empty, status: 'loading' }

  // No plan is running: nothing to compare against, never a warning. The Funding tab is where a budget is recorded. An ended plan is told apart from none recorded (the Funding tab shows that plan), and
  // its way on is to record a new one; a plan recorded for later says when it starts; an answer from an older server that gives no reason reads as nothing recorded.
  if (!data.hasBudget) {
    const ended = data.noBudgetReason === 'PlanEnded'
    // A plan recorded for later is on the Funding tab already: the bar says when it starts and points there, and there is nothing to record.
    const notStarted = data.noBudgetReason === 'NotStarted'
    return {
      ...empty, status: 'none', refreshing: state.pending, noBudgetReason: notStarted ? 'NotStarted' : ended ? 'PlanEnded' : 'NotRecorded',
      ...(ended && data.planEnd ? { planEnd: data.planEnd } : {}), ...(notStarted && data.planStart ? { planStart: data.planStart } : {}),
      noBudgetAction: { label: ended ? 'Record a new plan' : 'Open the Funding tab', to: fundingTabPath(participantId) },
    }
  }

  const pools: AgreementBudgetPool[] = data.pools.map(pool => ({
    poolLabel: pool.poolName,
    cost: pool.agreementCost,
    overBy: pool.overBy > 0 ? pool.overBy : null,
    alreadyOverBy: pool.alreadyOverBy > 0 ? pool.alreadyOverBy : null,
    lines: pool.periods.map(period => ({
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      cost: period.agreementCost,
      remaining: period.remaining,
      withinLimit: !(period.overBy > 0),
      overBy: period.overBy > 0 ? period.overBy : null,
    })),
  }))
  return { status: 'ready', figures: SHOWN, refreshing: state.pending, pools, notInARecordedPool: data.notInARecordedPool, outsideThePlan: data.outsideThePlan }
}
