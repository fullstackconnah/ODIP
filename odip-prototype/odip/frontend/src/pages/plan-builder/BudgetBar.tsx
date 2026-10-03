import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import type { PlanBudget } from '@/api/hooks'
import { Button } from '@/components/Button'
import { TONE } from '@/lib/tone'
import { formatHours } from '@/lib/planBlocks'
import { categoryLabel, compareBudget, describeQuoteError, flagSummary } from '@/lib/planQuote'
import { plural } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'

type BudgetBarProps = {
  /** What the query is doing: `idle` (nothing to price yet), `loading` (the first answer), `error`, `ready`. */
  status: 'idle' | 'loading' | 'error' | 'ready'
  budget?: PlanBudget
  /** A newer answer is on its way while the last one is still shown. */
  refreshing?: boolean
  error?: unknown
  onRetry?: () => void
  /** The participant's plan budget as the funding sources record it (null when none does). */
  planBudget: { total: number; count: number } | null
  /** The funding sources could not be read, so the comparison is left out. */
  planBudgetUnreadable?: boolean
  /** Blocks left out of the figures because they are not complete yet. */
  incompleteBlocks?: number
}

const LABEL = 'text-xs text-[var(--color-muted-foreground)]'
const FIGURE = 'text-base font-semibold tabular-nums'

/**
 * The running budget, docked at the foot through every step: hours and cost in an ordinary week, the cost of the agreement period by budget category, and how that stands against
 * the plan budget. Over the plan budget is a warning and never a block; with no plan budget recorded the totals stand alone and say so. On a phone it is one line and a Details
 * toggle. Every figure is the pricing engine's, for the plan as it would be saved.
 */
export function BudgetBar({ status, budget, refreshing = false, error, onRetry, planBudget, planBudgetUnreadable = false, incompleteBlocks = 0 }: BudgetBarProps) {
  const [open, setOpen] = useState(false)
  const period = budget?.period
  const weekly = budget?.weekly ?? null
  const comparison = compareBudget(period?.totals.amount ?? 0, planBudget?.total)
  const over = status === 'ready' && comparison.status === 'over'
  const flags = period ? flagSummary(period.totals) : ''

  const oneLine = status === 'ready' && period
    ? `${weekly ? `${formatHours(weekly.totals.supportHours)} h · ${formatCurrency(weekly.totals.amount)} a week · ` : ''}${formatCurrency(period.totals.amount)} in all`
    : status === 'loading' ? 'Pricing the plan…' : status === 'error' ? 'The plan could not be priced' : 'Add a block to see the budget'

  return (
    <section aria-label="Running budget" aria-busy={status === 'loading'} className="sticky bottom-[var(--mobile-nav-h)] z-30 -mx-[var(--card-pad)] -mb-[var(--card-pad)] border-t border-[var(--color-border)] bg-[var(--color-card)] px-[var(--card-pad)] py-2 lg:bottom-0">
      <div className="flex items-center justify-between gap-3 md:hidden">
        <p className="min-w-0 flex-1 text-sm font-medium tabular-nums">{oneLine}{over && <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${TONE.warning.solid}`}><AlertTriangle className="h-3 w-3" aria-hidden="true" />Over budget</span>}</p>
        <Button variant="ghost" size="sm" aria-expanded={open} aria-controls="plan-budget-details" onClick={() => setOpen(current => !current)}>
          Details{open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
        </Button>
      </div>

      <div id="plan-budget-details" className={`${open ? 'mt-2 grid max-md:max-h-[45vh] max-md:overflow-y-auto' : 'hidden'} grid-cols-1 gap-x-6 gap-y-3 md:mt-0 md:grid md:grid-cols-[minmax(11rem,auto)_1fr_minmax(14rem,auto)]`}>
        {status === 'idle' && <p className="text-sm text-[var(--color-muted-foreground)] md:col-span-3">Add a block to see the weekly hours and cost, and what the agreement comes to.</p>}

        {status === 'loading' && <p role="status" className="text-sm text-[var(--color-muted-foreground)] md:col-span-3">Pricing the plan…</p>}

        {status === 'error' && (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm md:col-span-3">
            <span><span className="font-medium">{describeQuoteError(error).title}.</span> {describeQuoteError(error).detail}</span>
            {onRetry && describeQuoteError(error).retryable && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
          </div>
        )}

        {status === 'ready' && period && (
          <>
            <div>
              <p className={LABEL}>An ordinary week</p>
              {weekly ? (
                <p className={FIGURE}>{formatHours(weekly.totals.supportHours)} h <span className="font-normal text-[var(--color-muted-foreground)]">·</span> {formatCurrency(weekly.totals.amount)}</p>
              ) : (
                <p className="text-sm text-[var(--color-muted-foreground)]">The agreement is shorter than a week.</p>
              )}
            </div>

            <div className="min-w-0">
              <p className={LABEL}>The agreement period{refreshing && <span aria-live="polite"> · updating…</span>}</p>
              <p className={FIGURE}>{formatCurrency(period.totals.amount)} <span className="text-[13px] font-normal text-[var(--color-muted-foreground)]">{formatHours(period.totals.supportHours)} h of support</span></p>
              {period.totals.byCategory.length > 0 && (
                <ul className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] tabular-nums" aria-label="By budget category">
                  {period.totals.byCategory.map(category => (
                    <li key={category.paceCategory} title={category.name}>{categoryLabel(category)} {formatCurrency(category.amount)}</li>
                  ))}
                </ul>
              )}
              {flags && <p className="mt-0.5 text-[13px] text-[var(--color-muted-foreground)]">{flags}.</p>}
            </div>

            <div>
              <p className={LABEL}>Plan budget</p>
              {planBudgetUnreadable ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">The plan budget could not be read, so there is no comparison.</p>
              ) : comparison.status === 'unknown' ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">Not recorded for this participant. The totals stand alone.</p>
              ) : (
                <>
                  <p className={FIGURE}>{formatCurrency(comparison.budget ?? 0)} <span className="text-[13px] font-normal text-[var(--color-muted-foreground)]">{comparison.percent}% used</span></p>
                  {over ? (
                    <p className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${TONE.warning.solid}`} role="status"><AlertTriangle className="h-3 w-3" aria-hidden="true" />Over the plan budget by {formatCurrency(Math.abs(comparison.remaining ?? 0))}. You can still save the draft.</p>
                  ) : (
                    <p className="mt-0.5 text-[13px] text-[var(--color-muted-foreground)]">{formatCurrency(comparison.remaining ?? 0)} left{planBudget && planBudget.count > 1 ? `, across ${plural(planBudget.count, 'funding source')}` : ''}.</p>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {incompleteBlocks > 0 && <p className="text-[13px] text-[var(--color-muted-foreground)] md:col-span-3">{plural(incompleteBlocks, 'block')} left out of these figures until {incompleteBlocks === 1 ? 'it is' : 'they are'} complete.</p>}
      </div>
    </section>
  )
}
