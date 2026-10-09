import { AlertTriangle, ChevronRight } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { TONE } from '@/lib/tone'
import { writtenDay, writtenSpan } from '@/lib/fundingPlan'
import { formatCurrency } from '@/lib/utils'
import type { AgreementBudgetBreakdownView, AgreementBudgetLine, AgreementBudgetPool, BudgetAttentionAction, BudgetFigureVisibility } from './viewModel'
import { BudgetFigure } from './BudgetFigure'
import { AGREEMENT_NO_BUDGET, AGREEMENT_WARNING_ONLY, OVER_BY_WORD, WITHIN_WORD, agreementNoBudgetEnded } from './wording'

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
  // A period that is already over before the agreement has less than nothing "left", and "against -$1,563.21 left" is hard to parse and says two different overs. The Funding tab never prints a
  // minus; it says "$X over", so this does: nothing is left, and how far over the period already is. (The verdict below stays the server's "Over by".)
  const alreadyOver = figures.visible && line.remaining !== null && line.remaining < 0 ? -line.remaining : null
  return (
    <li className={`flex flex-col gap-0.5 rounded-[var(--radius-sm)] px-2 py-1 ${line.withinLimit ? '' : TONE.warning.solid}`}>
      <p className="text-[13px] tabular-nums">
        <span className="sr-only">{poolLabel}, </span>
        Agreement <span className="font-semibold"><BudgetFigure figures={figures} amount={line.cost} /></span>
        {alreadyOver !== null ? (
          <> in {period}; nothing left (already <span className="font-semibold"><BudgetFigure figures={figures} amount={alreadyOver} /></span> over)</>
        ) : (
          <> against{' '}<span className="font-semibold"><BudgetFigure figures={figures} amount={line.remaining} /></span> left in {period}</>
        )}
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

/**
 * One pool the agreement touches. A pool that falls in ONE funding period is that period's sentence and verdict. A pool that spans several (a plan funded monthly is twelve) gets ONE line in the dock,
 * because the bar is docked and the sentences used to fill a quarter of a laptop screen: what the agreement costs there in all, in how many of the periods it would be over and by how much in all (the
 * server's own counts and sum: nothing is added up here), and every period's sentence behind a native disclosure, still in the page, that says how many there are.
 */
function Pool({ pool, figures }: { pool: AgreementBudgetPool; figures: BudgetFigureVisibility }) {
  const lineOf = (line: AgreementBudgetLine) => <Line key={`${line.periodStart}-${line.periodEnd}`} line={line} poolLabel={pool.poolLabel} figures={figures} />
  const count = pool.lines.length
  const overCount = pool.lines.filter(line => !line.withinLimit).length
  return (
    <div role="group" aria-label={pool.poolLabel} className="flex flex-col gap-0.5">
      <p className={`${LABEL} font-medium`}>{pool.poolLabel}</p>
      {count <= 1 ? (
        <ul className="flex flex-col gap-1">{pool.lines.map(lineOf)}</ul>
      ) : (
        <>
          <div className={`flex flex-col gap-0.5 rounded-[var(--radius-sm)] px-2 py-1 ${overCount > 0 ? TONE.warning.solid : ''}`}>
            <p className="text-[13px] tabular-nums">
              <span className="sr-only">{pool.poolLabel}, </span>
              Agreement <span className="font-semibold"><BudgetFigure figures={figures} amount={pool.cost} /></span> across {count} periods
            </p>
            <p className={`flex items-start gap-1 text-[13px] ${overCount > 0 ? 'font-medium' : 'text-[var(--color-muted-foreground)]'}`}>
              {overCount > 0 && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              {overCount > 0 ? (
                <span>
                  Over in {overCount} of {count} periods
                  {figures.visible && pool.overBy !== null && <>, <span className="tabular-nums">{formatCurrency(pool.overBy)}</span> in all</>}
                </span>
              ) : (
                <span>{WITHIN_WORD} in all {count} periods</span>
              )}
            </p>
          </div>
          <details className="group mt-1">
            <summary className="flex min-h-[var(--control-h)] cursor-pointer select-none items-center gap-1 text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
              {/* A flex summary loses the browser's own disclosure marker, so it carries a chevron that turns when it is open. */}
              <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
              Each of the {count} periods
            </summary>
            <ul className="mt-1 flex flex-col gap-1">{pool.lines.map(lineOf)}</ul>
          </details>
        </>
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
        {/* Not announced by itself: an advisory check that fails (a 429, a network blip) would interrupt a person typing in a block each time it recurs. The bar's one polite status says it, once. */}
        <Callout tone="warning" announce={false} className="max-w-prose">
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
        <p>{view.noBudgetReason === 'PlanEnded' && view.planEnd ? agreementNoBudgetEnded(writtenDay(view.planEnd)) : AGREEMENT_NO_BUDGET}</p>
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
