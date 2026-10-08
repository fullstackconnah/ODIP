import { AlertTriangle } from 'lucide-react'
import { NO_FIGURE, RESTRICTED_FIGURE, figureIsKnown, figureText, overrunSentence } from './budgetFigures'
import type { BudgetFigure, BudgetPeriodFigures } from './budgetOverrideTypes'

export type BudgetFindingDetailsProps = {
  /**
   * The figures the SERVER computed for this pool and funding period, with the shift being saved
   * already added in. This component reads them and prints them; it adds nothing up. There is
   * deliberately no prop for "the shift's hours" or any input it could price with: one component
   * that computes a budget figure is how two screens end up disagreeing about the same period.
   */
  figures: BudgetPeriodFigures
  /**
   * Whether to print the overrun sentence above the figures. On by default. Where the same sentence is already on screen (the shift panel's findings list prints the server's own words), turning it
   * off keeps one sentence for one fact instead of two that could drift apart.
   */
  sentence?: boolean
  className?: string
}

const LABEL = 'text-[13px] text-[var(--color-muted-foreground)]'
const VALUE = 'text-sm tabular-nums text-[var(--color-foreground)]'
const MUTED = 'text-[var(--color-muted-foreground)]'

/**
 * A plain text row (the pool, the period). A privacy-restricted viewer still sees these: they name
 * the plan, they are not money, and a reader who cannot see the figures needs to know which pool
 * and which period the warning is about.
 */
function TextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className={LABEL}>{label}</dt>
      <dd className={VALUE}>{value}</dd>
    </div>
  )
}

/**
 * One money figure and its label. An unknown figure is muted, so the eye can tell "we don't know
 * this" from "this is nothing" without reading the glyph.
 */
function MoneyRow({ label, figure, restricted }: { label: string; figure: BudgetFigure; restricted: boolean }) {
  const known = figureIsKnown(figure, restricted)
  return (
    <div className="contents">
      <dt className={LABEL}>{label}</dt>
      <dd className={`${VALUE} ${known ? '' : MUTED}`}>
        {figureText(figure, restricted)}
        {/* The en dash alone tells a sighted reader very little about WHY there is no number, and
            nothing at all to a screen reader. Say it, quietly, once per figure. */}
        {!known && (
          <span className="sr-only">
            {restricted
              ? ' — hidden on this account'
              : figure.kind === 'notRecorded'
                ? ' — not recorded'
                : ' — not available'}
          </span>
        )}
      </dd>
    </div>
  )
}

/**
 * The authoritative figures behind a budget warning, readable in one place: the pool, the funding
 * period, what is left, what this shift costs, and how far the period would then be over.
 *
 * Rules this holds to, each of which is a way a real coordinator would be misled otherwise:
 *  - **no arithmetic.** Nothing here sums, subtracts or compares. Every number arrived from the
 *    server. A "Left in this period" row is the server's remaining, not Available minus Used,
 *    because the server knows about roll-forward and this component does not.
 *  - **a missing figure is an en dash, never a 0.** A forecast the server did not compute is not a
 *    forecast of nothing, and a period with no money recorded is not a period with no money.
 *  - **a recorded $0.00 prints as $0.00.** Zero is an answer.
 *  - **the warning is not a prohibition.** The copy never says a shift cannot be saved or that
 *    support cannot be claimed, because delivered work is never blocked by this feature (owner
 *    decision, shape round 1). It says what the figures are, and leaves the decision to the path
 *    the caller offers.
 *  - **a restricted viewer gets no money at all**, and the same word in every cell, so nothing can
 *    be inferred from which figure happens to be blank.
 */
export function BudgetFindingDetails({ figures, sentence = true, className }: BudgetFindingDetailsProps) {
  const restricted = !!figures.restricted
  const hasOverrun = figureIsKnown(figures.projectedOverrun, restricted)

  return (
    <section
      aria-label="Budget figures for this shift"
      className={`flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-3 ${className ?? ''}`}
    >
      {sentence && (
        <p className="flex items-start gap-2 text-sm text-[var(--color-foreground)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-on-warning-container)]" aria-hidden="true" />
          <span>{overrunSentence(figures)}</span>
        </p>
      )}

      <dl className="grid grid-cols-[10rem_1fr] gap-x-4">
        <TextRow label="Pool" value={figures.pool} />
        <TextRow label="Funding period" value={figures.period} />
        <MoneyRow label="Available this period" figure={figures.available} restricted={restricted} />
        <MoneyRow label="Left in this period" figure={figures.remaining} restricted={restricted} />
        <MoneyRow label="This shift" figure={figures.shiftCost} restricted={restricted} />
        <MoneyRow label="With this shift" figure={figures.projectedTotal} restricted={restricted} />
        <MoneyRow label="Over by" figure={figures.projectedOverrun} restricted={restricted} />
      </dl>

      <p className="text-xs text-[var(--color-muted-foreground)]">
        {restricted
          ? `These figures are hidden on this account. ${RESTRICTED_FIGURE} means an amount was not shown, never that there was none.`
          : hasOverrun
            ? 'These are the figures the server worked out for this participant’s funding period. A shift that was actually delivered is never blocked by a budget warning.'
            : 'A figure that is not shown was not worked out by the server. It has not been recorded as nothing.'}
      </p>
    </section>
  )
}

/** An en dash for a figure nobody can show, exported for a caller's own empty cells. */
export const NO_BUDGET_FIGURE = NO_FIGURE
