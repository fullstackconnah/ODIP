import type { ParticipantAlertsDto } from '@/api/types'

// Budgets at risk (budget phase 2b): how many participants the dashboard's tile counts, worked out from the participant alerts the page already reads. The alerts are the server's word on each
// pool (ParticipantAlertsService, one status for each pool, the worst), so nothing here compares a figure or decides a status.

/** The alert types the server raises for a pool whose period is over, and whose booked shifts would take it over. */
export const BUDGET_OVER_ALERT = 'budget-over'
export const BUDGET_FORECAST_OVER_ALERT = 'budget-forecast-over'
/** The NDIA's own word that a pool's funds ran out: a claim refused for want of funds (V17, V18, V27, V28). */
export const BUDGET_NDIA_ALERT = 'budget-ndia-exhausted'

export interface BudgetsAtRisk {
  /** Participants with at least one pool already over. */
  over: number
  /** Participants with a pool forecast to go over and none already over. */
  forecastOver: number
  /** Active participants with a budget in force (a plan running now), whether or not anything is at risk: how many budgets there are to say anything about. */
  tracked: number
  /** Active participants the NDIA has refused a claim of for want of funds, on a pool of their running plan. */
  ndiaRefused: number
}

/**
 * How many active participants have a budget at risk, each counted ONCE, in their worst state: a participant with one pool over and another forecast over is "over", not both. A participant
 * with no budget alert at all (no budget recorded, on track, or only approaching) is not counted: approaching is a heads-up on the participant's page, not something the tile asks anybody to act
 * on. Archived participants are left out even if a caller passes them (the server leaves them out of the aggregate already).
 *
 * Also how many have a budget in force and how many the NDIA has refused a claim of for want of funds. A participant on track has no alert, so without the first nobody could tell "no budget is at
 * risk" from "no budget is recorded", and the band would say all clear about budgets nobody has recorded; the second is a budget fact the tile does not count but an all clear must not contradict.
 */
export function budgetsAtRisk(aggregate: readonly ParticipantAlertsDto[]): BudgetsAtRisk {
  let over = 0
  let forecastOver = 0
  let tracked = 0
  let ndiaRefused = 0
  for (const participant of aggregate) {
    if (!participant.isActive) continue
    if (participant.budgetInForce) tracked += 1
    if (participant.alerts.some(alert => alert.type === BUDGET_NDIA_ALERT)) ndiaRefused += 1
    if (participant.alerts.some(alert => alert.type === BUDGET_OVER_ALERT)) over += 1
    else if (participant.alerts.some(alert => alert.type === BUDGET_FORECAST_OVER_ALERT)) forecastOver += 1
  }
  return { over, forecastOver, tracked, ndiaRefused }
}
