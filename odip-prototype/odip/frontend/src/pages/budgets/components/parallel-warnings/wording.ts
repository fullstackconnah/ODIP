// The words the three budget-warning surfaces share, in one JSX-free module so no two of them spell a state differently. Pure data and
// sentence builders: nothing here reads a clock, formats money or decides a status.
//
// Every sentence here is built from fixed words, never Intl, so it cannot change with an ICU build (the rule lib/format.ts follows).

import { plural } from '@/lib/format'
import type { BudgetRiskLevel } from './viewModel'

/** The noun a count of each risk level is written with, so the band, the table and any alert say the same thing. */
export const BUDGET_RISK_LABELS: Record<BudgetRiskLevel, string> = {
  Over: 'over budget',
  ForecastOver: 'forecast to go over',
  Approaching: 'approaching the limit',
}

/** The no-risk sentence's tail: it names what was checked, because an all-clear is only worth reading when you know what it covers. */
export const noRiskLine = 'Checked: every participant with a recorded budget is within it for this funding period.'

/** The note under a band that holds at least one participant who is already over. */
export const overNote = 'Someone is already over this period’s available funds. Claims are never blocked, but the participant’s plan manager may need telling.'

/** A pool with a recorded limit of nothing. Distinct from "no limit recorded", which is `NoBudget`. */
export const configuredZero = 'Recorded as $0.00 for this period. Nothing has been drawn on it, and nothing is available to draw on.'

/** A row the server could not put a number on. `reason` is the server's own words when it sent any. */
export function unavailableFigure(reason?: string): string {
  return reason ? `Not available. ${reason}` : 'Not available.'
}

/** The dash that stands where a figure is not, and the reason beside it, read once by a screen reader and once by a sighted user. */
export const NO_FIGURE = '–'

/** "{n} participant budgets have no budget recorded", behind the count that keeps them off the list. */
export function noBudgetHiddenLabel(count: number): string {
  return `${plural(count, 'budget')} with no budget recorded`
}

/** The agreement line's own sentence: what the forecast is against what is available, with the period named. */
export function agreementLineSentence(options: { within: boolean; overBy: string; periodLabel: string }): string {
  return options.within
    ? `Within the limit for ${options.periodLabel}.`
    : `Over by ${options.overBy} for ${options.periodLabel}.`
}
