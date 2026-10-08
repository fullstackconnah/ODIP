import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { TONE } from '@/lib/tone'
import { writtenSpan } from '@/lib/fundingPlan'
import { plural } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import type { AgreementBudgetBreakdownView, AgreementBudgetLine, AgreementBudgetPool, BudgetAttentionAction, BudgetFigureVisibility } from './viewModel'
import { BudgetFigure } from './BudgetFigure'
import { AGREEMENT_NO_BUDGET, AGREEMENT_WARNING_ONLY, OVER_BY_WORD, WITHIN_WORD } from './wording'

// The agreement budget bar's comparison: for each pool the agreement touches, and each funding period of it, what the agreement costs against what that period has left. The server
// (POST participants/{id}/funding/agreement-check) computes every figure - the cost is the pricing engine's, "left" is the ledger's available minus used, "over by" is the server's - and this
// component only draws them, the way the Budgets list draws the ledger's.
//
// WARNING ONLY, in every mode: an owner decision. Nothing here blocks a save or an approval, and this component cannot express a block: it holds no callback that could refuse anything. The
// one callback it takes is the retry after a failed check, and the one link it can show points to the Funding tab where a budget is recorded.

const LABEL = 'text-xs text-[var(--color-muted-foreground)]'
const NOTE = 'text-[13px] text-[var(--color-muted-foreground)]'

/** The action the "no budget recorded" state offers: a link to where a budget is recorded. Navigation is the caller's. */
function ActionButton({ action }: { action: BudgetAttentionAction }) {
  if ('to' in action) return <Button size="sm" variant="secondary" to={action.to}>{action.label}</Button>
  return <Button size="sm" variant="secondary" onClick={action.onSelect}>{action.label}</Button>
}

/** One funding period of one pool. Every figure goes through `BudgetFigure`, so a withheld amount cannot leak into a title or an aria. */
function Line({ line, poolLabel, figures }: { line: AgreementBudgetLine; poolLabel: string; figures: BudgetFigureVisibility }) {
  const period = writtenSpan(line.periodStart, line.periodEnd)
  return (
    <li className={`flex flex-col gap-0.5 rounded-[var(--radius-sm)] px-2 py-1 ${line.withinLimit ? '' : TONE.warning.solid}`}>
      <p className="text-[13px] tabular-nums">
        <span className="sr-only">{poolLabel}, </span>
        Agreement <span className="font-semibold"><BudgetFigure figures={figures} amount={line.cost} /></span> against{' '}
        <span className="font-semibold"><BudgetFigure figures={figures} amount={line.remaining} /></span> left in {period}
      </p>
      <p className={`flex items-start gap-1 text-[13px] ${line.withinLimit ? 'text-[var(--color-muted-foreground)]' : 'font-medium'}`}>
        {!line.withinLimit && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {line.withinLimit ? (
          <span>{WITHIN_WORD}</span>
        ) : (
          <span>
            {OVER_BY_WORD}{' '}
            {figures.visible && line.overBy !== null ? <span className="tabular-nums">{formatCurrency(line.overBy)}</span> : 'an amount not shown here'}
          </span>
        )}
      </p>
    </li>
  )
}

/** How many periods of one pool are drawn before the rest go behind a disclosure: the bar is docked, and a plan with monthly funding periods would otherwise fill the screen. */
export const MAX_LINES_SHOWN = 3

/** One pool the agreement touches: its first periods, and any more behind a native disclosure that says how many there are and how many of them are over (a count of the server's own verdicts). */
function Pool({ pool, figures }: { pool: AgreementBudgetPool; figures: BudgetFigureVisibility }) {
  const shown = pool.lines.slice(0, MAX_LINES_SHOWN)
  const rest = pool.lines.slice(MAX_LINES_SHOWN)
  const restOver = rest.filter(line => !line.withinLimit).length
  const lineOf = (line: AgreementBudgetLine) => <Line key={`${line.periodStart}-${line.periodEnd}`} line={line} poolLabel={pool.poolLabel} figures={figures} />
  return (
    <div className="flex flex-col gap-0.5">
      <p className={`${LABEL} font-medium`}>{pool.poolLabel}</p>
      <ul className="flex flex-col gap-1">{shown.map(lineOf)}</ul>
      {rest.length > 0 && (
        <details className="mt-1">
          <summary className="flex min-h-[var(--control-h)] cursor-pointer select-none items-center text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
            {plural(rest.length, 'more period')}, {restOver > 0 ? `${restOver} over` : 'all within'}
          </summary>
          <ul className="mt-1 flex flex-col gap-1">{rest.map(lineOf)}</ul>
        </details>
      )}
    </div>
  )
}

export function AgreementBudgetBreakdown({ view }: { view: AgreementBudgetBreakdownView }) {
  const { figures } = view

  if (view.status === 'loading') {
    // Not a live region: the bar has one polite status and nothing else in it is live (a status inserted holding its text is not reliably spoken, and this one would speak on every first check).
    // The bar is aria-busy while it is up.
    return (
      <p className={NOTE}>
        Checking the agreement against the participant&rsquo;s budget…
      </p>
    )
  }

  if (view.status === 'failed') {
    return (
      <div className="flex flex-col items-start gap-2">
        <Callout tone="warning" className="max-w-prose">
          {view.failureMessage ?? 'The agreement could not be checked against the budget, so no comparison is shown. The plan can still be saved.'}
        </Callout>
        {view.onRetry && <Button size="sm" variant="secondary" onClick={view.onRetry}>Try again</Button>}
      </div>
    )
  }

  if (view.status === 'none') {
    // "No budget recorded" is the commonest state and must link to where a budget is recorded, never warn (SHAPE-BRIEF §5).
    return (
      <div className={`flex flex-wrap items-center gap-2 ${NOTE}`}>
        <p>{AGREEMENT_NO_BUDGET}</p>
        {view.noBudgetAction && <ActionButton action={view.noBudgetAction} />}
      </div>
    )
  }

  const over = view.pools.flatMap(pool => pool.lines).filter(line => !line.withinLimit).length
  const hasBucket = (view.notInARecordedPool ?? 0) > 0 || (view.outsideThePlan ?? 0) > 0

  return (
    <section aria-label="Agreement against the participant's budget" aria-busy={view.refreshing === true} className="flex flex-col gap-2">
      {view.pools.length === 0 && !hasBucket && (
        <p className={NOTE}>Nothing in the agreement is priced against a pool yet, so there is nothing to compare.</p>
      )}
      {view.pools.map(pool => <Pool key={pool.poolLabel} pool={pool} figures={figures} />)}
      {(view.notInARecordedPool ?? 0) > 0 && (
        <p className={NOTE}>
          <BudgetFigure figures={figures} amount={view.notInARecordedPool} /> of the agreement is in no pool the plan records, so it is not compared.
        </p>
      )}
      {(view.outsideThePlan ?? 0) > 0 && (
        <p className={NOTE}>
          <BudgetFigure figures={figures} amount={view.outsideThePlan} /> of the agreement is delivered outside the plan&rsquo;s dates, so it is not compared.
        </p>
      )}
      {over > 0 && (
        <p className="flex items-start gap-1 text-[13px] font-medium">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {over === 1 ? 'One period would' : `${over} periods would`} be over what is left. {AGREEMENT_WARNING_ONLY}
          </span>
        </p>
      )}
      {view.refreshing === true && <p className={NOTE}>Updating…</p>}
    </section>
  )
}
