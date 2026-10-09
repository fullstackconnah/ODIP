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

/** The line under the no-budget count: a participant with no budget is never warned about, because there is no limit to be near. */
export const noBudgetNote = 'A participant with no budget recorded is never warned about: there is no limit to be near.'

// ── A forecast that leaves shifts out ───────────────────────────────────────────────────────────────────────────────────

/** What the mark beside a forecast says: shifts the shift claim cannot price yet are $0 in every figure, so the forecast leaves them out. */
export function unpricedForecastLabel(count: number): string {
  return `Leaves out ${plural(count, 'shift')} that ${count === 1 ? 'is' : 'are'} not priced yet`
}

/** Under the table, once, when any row has the mark: what it is, and where the shifts are named. */
export const UNPRICED_LEGEND = 'A triangle beside a forecast means it leaves out shifts that are not priced yet (a sleepover, a passive night or a group shift). The participant’s Funding tab names them.'

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

/** The neutral chips the bar's one-line form shows when there is nothing to compare or the comparison failed (a phone or tablet reads that line and nothing else): silence would read as "fits". */
export const CHIP_NO_BUDGET = 'No budget recorded'
export const CHIP_PLAN_ENDED = 'Plan ended'
export const CHIP_NOT_CHECKED = 'Budget not checked'

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
