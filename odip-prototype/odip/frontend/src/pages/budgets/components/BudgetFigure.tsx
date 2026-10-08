import { formatCurrency } from '@/lib/utils'
import { NO_FIGURE } from './wording'
import type { BudgetAmount, BudgetFigureVisibility } from './viewModel'

// The one place a budget figure reaches the screen, so a withheld amount cannot leak through a `title`, an `aria-label` or a `data-`
// attribute somewhere a table cell happens to add one (DataTable puts a cell's full text in `title` when a caller renders a plain string).
//
// Three rules, in one function:
//   1. `visible: false` prints a privacy word and NOTHING else. No amount, no dash standing in for one, no reason that quotes a figure.
//   2. `null` prints the en dash (NO_FIGURE) with the reason's own words, so "the server could not compute it" never reads as "$0".
//   3. `0` is a figure: $0.00, formatted by the app's own helper, never a dash.

/** What stands where a figure is withheld by the privacy contract. */
export const HIDDEN_FIGURE = 'Not shown'

export type BudgetFigureOptions = {
  figures: BudgetFigureVisibility
  /** The figure, in whole dollars, or `null` when the server could not give one. */
  amount: BudgetAmount
  /** The server's own words for why there is no figure. Only used for a `null`, never for a withheld amount. */
  reason?: string
  /** Extra words for the screen reader when the visible figure needs qualifying (e.g. "Recorded as $0.00"). */
  srNote?: string
  /** Rendered as a muted note under the figure, at 12px. */
  className?: string
}

/**
 * One figure. Returns a fragment so it can sit in a table cell, a definition list or a card without a wrapper deciding the layout.
 */
export function BudgetFigure({ figures, amount, reason, srNote, className = '' }: BudgetFigureOptions) {
  if (!figures.visible) {
    return (
      <>
        <span className={`text-[var(--color-muted-foreground)] ${className}`.trim()}>{HIDDEN_FIGURE}</span>
        {/* The reason is the privacy contract's own sentence, never a figure and never a figure's arithmetical shadow. */}
        <span className="sr-only"> {figures.reason}</span>
      </>
    )
  }
  if (amount === null) {
    return (
      <>
        <span aria-hidden="true" className={`text-[var(--color-muted-foreground)] ${className}`.trim()}>{NO_FIGURE}</span>
        <span className="sr-only">Not available. {reason ?? ''}</span>
        {reason && <span className="block text-xs text-[var(--color-muted-foreground)]">{reason}</span>}
      </>
    )
  }
  return (
    <>
      <span className={`tabular-nums ${className}`.trim()}>{formatCurrency(amount)}</span>
      {srNote && <span className="sr-only"> {srNote}</span>}
    </>
  )
}
