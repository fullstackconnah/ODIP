// How a server-sent budget figure reads on screen, and the one sentence that names the overrun.
//
// Pure and JSX-free. Three states, never two, because the difference between "nothing is recorded"
// and "nothing is known yet" is the difference between a coordinator recording a plan amount and a
// coordinator waiting for a request that failed (DESIGN.md: "Loading and failure are not zero").

import { formatCurrency } from '@/lib/utils'
import type { BudgetFigure, BudgetPeriodFigures } from './budgetOverrideTypes'

/** The en dash the app prints for a figure that is not known (DESIGN.md, The Quiet Zero Rule). */
export const NO_FIGURE = '–'

/**
 * What a restricted viewer is told in place of a money figure. Deliberately says the same thing
 * for every figure: a viewer who may not see money must not be able to tell a small pool from a
 * large one by which row is hidden.
 */
export const RESTRICTED_FIGURE = 'Hidden'

/**
 * A figure as text. An en dash, never a 0:
 *  - `value`        the server's number, as AUD;
 *  - `notRecorded`  the server said nothing is recorded (still an en dash — a 0 here would read
 *                   as "there is no money", which is a claim about the participant's plan);
 *  - `unknown`      the request has not answered or failed; still an en dash.
 *
 * A recorded $0.00 prints as "$0.00": zero IS an answer ("this pool is fully committed"), and
 * must not be confused with the absence of one.
 */
export function figureText(figure: BudgetFigure, restricted = false): string {
  if (restricted) return RESTRICTED_FIGURE
  return figure.kind === 'value' ? formatCurrency(figure.amount) : NO_FIGURE
}

/** Whether a figure is showing a number at all. A caller uses it to pick muted styling. */
export function figureIsKnown(figure: BudgetFigure, restricted = false): boolean {
  return !restricted && figure.kind === 'value'
}

/**
 * The overrun sentence, in the shape the phase-3 spec names: "Takes {pool} to {forecast} of
 * {available} for {period}". Built only from figures the server sent.
 *
 * A missing forecast, or one the server did not compute, does not produce a sentence with a
 * blank in it and it does not produce "Takes Core to nothing of nothing": it says the figures are
 * not available. A blank in a refusal is worse than no refusal, because it looks like the
 * coordinator is being careless rather than that the server has not answered.
 */
export function overrunSentence(figures: BudgetPeriodFigures): string {
  if (figures.restricted) {
    return `This shift is over the recorded budget for ${figures.pool}. The figures are hidden on this account.`
  }
  const known = (f: BudgetFigure) => f.kind === 'value'
  if (!known(figures.projectedTotal) || !known(figures.available)) {
    return `This shift takes ${figures.pool} past the recorded budget for ${figures.period}, but the forecast is not available.`
  }
  const projected = formatCurrency(figures.projectedTotal.kind === 'value' ? figures.projectedTotal.amount : 0)
  const available = formatCurrency(figures.available.kind === 'value' ? figures.available.amount : 0)
  return `Takes ${figures.pool} to ${projected} of ${available} for ${figures.period}.`
}
