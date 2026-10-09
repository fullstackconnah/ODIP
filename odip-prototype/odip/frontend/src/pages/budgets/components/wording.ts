// The words the budget warning surfaces share, in one JSX-free module so no two of them spell a state differently. Pure data and sentence builders: nothing here reads a clock, formats money or
// decides a status.
//
// Every sentence here is built from fixed words, never Intl, so it cannot change with an ICU build (the rule lib/format.ts follows).

import { plural } from '@/lib/format'

/** A pool with a recorded limit of nothing. Distinct from "no limit recorded", which is `NoBudget`. */
export const configuredZero = 'Recorded as $0.00 for this period. Nothing has been drawn on it, and nothing is available to draw on.'

/** A row the server could not put a number on. `reason` is the server's own words when it sent any. */
export function unavailableFigure(reason?: string): string {
  return reason ? `Not available. ${reason}` : 'Not available.'
}

/** The dash that stands where a figure is not, and the reason beside it, read once by a screen reader and once by a sighted user. */
export const NO_FIGURE = '–'

/** "{n} participants with no budget recorded", behind the count that keeps them off the list. */
export function noBudgetHiddenLabel(count: number): string {
  return `${plural(count, 'participant')} with no budget recorded`
}

/** Why a participant with no row has none: nothing was recorded, or the plan they have has ended. */
export const NO_BUDGET_REASON = 'No budget recorded'

/**
 * The line inside the opened list of participants with no budget recorded. Every plan has a limit; ODIP just does not hold it, so it cannot warn about it. (It used to say the participant is "never
 * warned about: there is no limit to be near", which is the opposite of the truth and read as reassurance.)
 */
export const noBudgetNote = 'ODIP cannot warn about a budget it does not hold. Record the plan to start tracking.'

/**
 * The same note when the tail holds a participant whose plan is recorded for later ("Plan starts 1 Nov 2026"): "Record the plan to start tracking" would sit above a row whose plan is already
 * recorded, so it says that nothing can be warned of until a plan is running, and that the one that starts later can be opened.
 */
export const noBudgetNoteUpcoming = 'Until a plan is running, ODIP cannot warn about its budget. Record the plan, or open one that starts later.'

/** What the Budgets page says when no budget is being tracked for anybody, and what to do about it. */
export const NOTHING_TRACKED = 'No budgets are being tracked yet. Record a participant’s plan to start.'

/** The pill beside a row's status when the NDIA has refused a claim of the pool for want of funds: the label the participant alert has (ALERT_TYPE_LABELS), in the NDIA's own voice. */
export const NDIA_FUNDS_RAN_OUT = 'NDIA says the funds ran out'

// ── A forecast that leaves shifts out ───────────────────────────────────────────────────────────────────────────────────

/** What the mark beside a forecast says: shifts the shift claim cannot price yet are $0 in every figure, so the forecast leaves them out. */
export function unpricedForecastLabel(count: number): string {
  return `Leaves out ${plural(count, 'shift')} that ${count === 1 ? 'is' : 'are'} not priced yet`
}

/** Under the table, once, when any row has the mark: what it is, and where the shifts are named. */
export const UNPRICED_LEGEND = 'A triangle beside a forecast means it leaves out shifts that are not priced yet (a sleepover, a passive night or a group shift). The participant’s Funding tab names them.'

// ── Money rolled over from an earlier period ───────────────────────────────────────────────────────────────────────────

/** What the mark beside Available says: the figure includes money rolled over from earlier periods, which is not confirmed (somebody else may have used it, as the Funding tab says). `amount` is already written. */
export function rolledOverLabel(amount: string): string {
  return `Includes ${amount} rolled over, not confirmed`
}

/** Under the table, once, when any row has the mark: what it is. */
export const ROLLED_OVER_LEGEND = 'A bent arrow beside Available means it includes money rolled over from an earlier period, which is not confirmed: somebody else may have used it.'

// ── The agreement budget bar ────────────────────────────────────────────────────────────────────────────────────────────

/** What the bar says when the participant has no budget recorded (it links to the Funding tab where one is recorded). */
export const AGREEMENT_NO_BUDGET = 'No budget recorded for this participant, so there is nothing to compare the agreement against.'

/**
 * The same words when the participant's recorded plan has ended (the Funding tab shows that plan, so the bar must not read as if none were ever recorded): the spec's sentence, then why there is
 * nothing to compare. `endedOn` is the plan's last day, already written ("30 Jun 2026").
 */
export function agreementNoBudgetEnded(endedOn: string): string {
  return `No budget recorded for this participant: the recorded plan ended on ${endedOn}, so there is nothing to compare the agreement against.`
}

/** The same words when a plan is recorded for later (it is on the Funding tab already): when it starts, then why there is nothing to compare yet. `startsOn` is the plan's first day, already written ("1 Nov 2026"). */
export function agreementPlanNotStarted(startsOn: string): string {
  return `Plan starts ${startsOn}, so there is nothing to compare the agreement against yet.`
}

/** The neutral chips the bar's one-line form shows when there is nothing to compare or the comparison failed (a phone or tablet reads that line and nothing else): silence would read as "fits". */
export const CHIP_NO_BUDGET = 'No budget recorded'
export const CHIP_PLAN_ENDED = 'Plan ended'
export const CHIP_NOT_CHECKED = 'Budget not checked'
/** The chip for a plan recorded for later: `startsOn` is its first day, already written. */
export function chipPlanStarts(startsOn: string): string {
  return `Plan starts ${startsOn}`
}

/** What the bar's one polite status says, once, when the check could not be made. A failed advisory check does not interrupt: it is not an alert. */
export const CHECK_COULD_NOT_BE_MADE = 'The budget could not be checked.'

/** The one line that makes the warning's nature plain: it is a warning, in every mode. */
export const AGREEMENT_WARNING_ONLY = 'This is a warning only: it never stops a save or an approval.'

/** The verdict word of a line that fits. A line that does not says "Over by" and the amount. */
export const WITHIN_WORD = 'Within'
export const OVER_BY_WORD = 'Over by'

export function periodsCountLabel(count: number): string {
  return plural(count, 'period')
}
