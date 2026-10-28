import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/Button'
import type { PlanBudget } from '@/api/hooks'
import { plural } from '@/lib/format'
import { TONE } from '@/lib/tone'
import { NO_FIGURE, describeQuoteError, pricedNothing } from '@/lib/planQuote'
import { formatCurrency } from '@/lib/utils'
import type { AgreementBudgetBreakdownView } from '../budgets/components/viewModel'

type RunningTotalProps = {
  /** What the pricing is doing: `idle` (nothing to price yet), `loading` (the first answer), `error`, `ready`. */
  status: 'idle' | 'loading' | 'error' | 'ready'
  answer?: PlanBudget
  /** A newer answer is on its way while the last one is still shown. */
  refreshing: boolean
  error?: unknown
  onRetry: () => void
  budgetView: AgreementBudgetBreakdownView | null
  /** Shifts left out of the figures because something is missing from them. */
  leftOut: number
}

/** How the agreement stands against the participant's pools, in the few words the footer has room for. The server's verdict is only read: nothing is compared here. */
function budgetWords(view: AgreementBudgetBreakdownView | null): { long: string; short: string; over?: boolean } | null {
  if (!view || view.status === 'loading') return null
  if (view.status === 'none') return view.noBudgetReason === 'OtherFunded' ? { long: 'no NDIS budget', short: 'no budget' } : { long: 'no budget recorded', short: 'no budget' }
  if (view.status === 'failed') return { long: 'budget not checked', short: 'not checked' }
  const over = view.pools.reduce((sum, pool) => sum + (pool.overBy ?? 0), 0)
  return over > 0 ? { long: `over by ${formatCurrency(over)}`, short: 'over budget', over: true } : { long: 'within budget', short: 'within' }
}

/** Over budget is a warning that never blocks anything: the warning tone and a sign, not the danger tone. */
const mark = (text: string, over?: boolean) => (over ? <span className={`inline-flex items-center gap-1 ${TONE.warning.ink}`}><AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{text}</span> : text)

/**
 * The agreement's one running total, in the wizard's footer beside Back and Next: what a week costs, what the agreement costs and where that leaves the budget. It is the only place
 * the figures are stated outside the Check step. A figure being replaced keeps showing, marked "updating", so it does not flicker.
 */
export function RunningTotal({ status, answer, refreshing, error, onRetry, budgetView, leftOut }: RunningTotalProps) {
  const period = answer?.period
  const weekly = answer?.weekly ?? null
  const nothing = status === 'ready' && !!period && pricedNothing(period)
  const failure = status === 'error' ? describeQuoteError(error) : null
  const budget = status === 'ready' && !nothing ? budgetWords(budgetView) : null
  const agreement = nothing || !period ? NO_FIGURE : formatCurrency(period.totals.amount)
  const week = weekly && !pricedNothing(weekly) ? formatCurrency(weekly.totals.amount) : null

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums" aria-busy={status === 'loading' || refreshing}>
      <p role="status" aria-atomic="true" className="min-w-0 font-medium">
        {status === 'ready' && period ? (
          <>
            <span className="max-sm:sr-only">{week ? `${week} a week · ` : ''}{agreement} for the agreement{budget && <> · {mark(budget.long, budget.over)}</>}</span>
            <span aria-hidden="true" className="sm:hidden">{week ? `${week} / week` : agreement}{budget && <> · {mark(budget.short, budget.over)}</>}</span>
          </>
        ) : status === 'loading' ? 'Pricing the agreement…'
          : status === 'error' ? `${NO_FIGURE} Couldn't price`
            : 'Add a shift to see the total'}
      </p>
      {status === 'ready' && refreshing && <span className="font-normal text-[var(--color-muted-foreground)]">updating…</span>}
      {status === 'ready' && leftOut > 0 && <span className="font-normal text-[var(--color-muted-foreground)]">{plural(leftOut, 'shift')} left out</span>}
      {failure?.retryable && <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  )
}
