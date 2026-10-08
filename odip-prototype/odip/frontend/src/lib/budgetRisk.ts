import type { ParticipantAlertsDto } from '@/api/types'

// Budgets at risk (budget phase 2b): how many participants the dashboard's tile counts, worked out from the participant alerts the page already reads. The alerts are the server's word on each
// pool (ParticipantAlertsService, one status for each pool, the worst), so nothing here compares a figure or decides a status.

/** The alert types the server raises for a pool whose period is over, and whose booked shifts would take it over. */
export const BUDGET_OVER_ALERT = 'budget-over'
export const BUDGET_FORECAST_OVER_ALERT = 'budget-forecast-over'

export interface BudgetsAtRisk {
  /** Participants with at least one pool already over. */
  over: number
  /** Participants with a pool forecast to go over and none already over. */
  forecastOver: number
}

/**
 * How many active participants have a budget at risk, each counted ONCE, in their worst state: a participant with one pool over and another forecast over is "over", not both. A participant
 * with no budget alert at all (no budget recorded, on track, or only approaching) is not counted: approaching is a heads-up on the participant's page, not something the tile asks anybody to act
 * on. Archived participants are left out even if a caller passes them (the server leaves them out of the aggregate already).
 */
export function budgetsAtRisk(aggregate: readonly ParticipantAlertsDto[]): BudgetsAtRisk {
  let over = 0
  let forecastOver = 0
  for (const participant of aggregate) {
    if (!participant.isActive) continue
    if (participant.alerts.some(alert => alert.type === BUDGET_OVER_ALERT)) over += 1
    else if (participant.alerts.some(alert => alert.type === BUDGET_FORECAST_OVER_ALERT)) forecastOver += 1
  }
  return { over, forecastOver }
}
