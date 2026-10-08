import type { BudgetListNoBudget, BudgetListRow, BudgetStatus } from '@/api/types'
import { writtenDay } from '@/lib/fundingPlan'
import type { BudgetFigureVisibility, BudgetRiskRow, BudgetRiskStatus, NoBudgetEntry } from './components/viewModel'
import { NO_BUDGET_REASON } from './components/wording'

// The adapter from the Budgets list's server DTO (GET api/v1/funding/budgets) to the table's view-model, as the components' README intends. It maps; it does not decide. Every figure is the
// server's, a status is the server's word for it, and the order is the order the server sent (risk, then name): nothing is summed, ranked or compared here.

/** Where a participant's budget is recorded and read in full: their Funding tab. */
export const fundingTabPath = (participantId: string) => `/participants/${participantId}?tab=funding`

/** The server's status vocabulary in the view-model's. `None` is only ever the absence of a plan: a row with no plan is not a row, but the mapping stays total so a new word fails to compile. */
const STATUS: Record<BudgetStatus, BudgetRiskStatus> = {
  None: 'NoBudget',
  OnTrack: 'OnTrack',
  Approaching: 'Approaching',
  ForecastOver: 'ForecastOver',
  Over: 'Over',
}

/** One pool of one participant's current plan, for the period running now. Whole dollars, as the server sent them. */
export function budgetRiskRow(row: BudgetListRow, figures: BudgetFigureVisibility): BudgetRiskRow {
  return {
    id: `${row.participantId}:${row.poolId}:${row.periodStart}`,
    participantLabel: row.participantName,
    poolLabel: row.poolName,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    status: STATUS[row.status],
    figures,
    available: row.available,
    used: row.used,
    bookedAhead: row.bookedAhead,
    forecast: row.forecast,
    action: { label: 'Open funding', to: fundingTabPath(row.participantId) },
  }
}

/** An NDIS-funded participant with no budget in force: why, and the way to record one. No figure and no warning. */
export function noBudgetEntry(entry: BudgetListNoBudget): NoBudgetEntry {
  return {
    id: entry.participantId,
    participantLabel: entry.participantName,
    reason: entry.reason === 'PlanEnded' ? (entry.planEnd ? `Plan ended ${writtenDay(entry.planEnd)}` : 'Plan ended') : NO_BUDGET_REASON,
    action: { label: 'Record budget', to: fundingTabPath(entry.participantId) },
  }
}
