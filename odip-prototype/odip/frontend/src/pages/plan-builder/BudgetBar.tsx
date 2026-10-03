import { useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import type { PlanBudget } from '@/api/hooks'
import { Button } from '@/components/Button'
import { TONE } from '@/lib/tone'
import { formatHours } from '@/lib/planBlocks'
import { categoryLabel, compareBudget, describeQuoteError, totalsCaption } from '@/lib/planQuote'
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
  /**
   * The plan has changes nobody has saved. The one-line form says so with a Save beside it: "Add to plan" does not save, and the save row is a long scroll away under the blocks.
   */
  unsaved?: { onSave: () => void; saving: boolean }
  /**
   * The plan cannot be saved as it is: the engine refused a block, and the save row says why. Save is off, and the over-budget sentence does not say the draft can still be saved. It is the plan's
   * state and not the Save button's, so it is given whether or not there is anything unsaved.
   */
  blocked?: boolean
  /**
   * What the last save said when it was not "saved": the problems found, the server's refusal, a newer version somebody else made. Docked with the bar, so it is in view from the overview and from
   * every step of a block, wherever Save was pressed: a Save from the bar, with a block open, used to answer nowhere and go back to "Save".
   */
  notice?: ReactNode
  /** What a save that worked said ("Saved as version 3."): a polite status in a region that is always in the page, so it is announced when it is filled. */
  saved?: string | null
}

const LABEL = 'text-xs text-[var(--color-muted-foreground)]'
/** The figures the bar is for: the Headline step, so they read before the labels and the notes around them. */
const HEADLINE = 'text-xl font-bold tabular-nums leading-tight'
const NOTE = 'text-[13px] text-[var(--color-muted-foreground)]'
const CHIP = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${TONE.warning.solid}`

/**
 * The running budget, docked at the foot through every step: hours and cost in an ordinary week, the cost of the agreement period by budget category, and how that stands against
 * the plan budget. It is the point of the screen, so its figures are the largest thing on it. Over the plan budget is a warning and never a block; with no plan budget recorded the
 * totals stand alone and say so. A total that leaves work out says so beside the figure, in shifts, and a chip says it on the one-line form. Below 1280px it is one line and a Details
 * toggle (the full bar is a third of a tablet's screen). Every figure is the pricing engine's, for the plan as it would be saved.
 */
export function BudgetBar({ status, budget, refreshing = false, error, onRetry, planBudget, planBudgetUnreadable = false, incompleteBlocks = 0, blocked = false, unsaved, notice, saved = null }: BudgetBarProps) {
  const [open, setOpen] = useState(false)
  const period = budget?.period
  const weekly = budget?.weekly ?? null
  const comparison = compareBudget(period?.totals.amount ?? 0, planBudget?.total)
  const over = status === 'ready' && comparison.status === 'over'
  const caption = period ? totalsCaption(period) : { text: '', notFullyPriced: false }
  const notFullyPriced = status === 'ready' && caption.notFullyPriced
  const failure = status === 'error' ? describeQuoteError(error) : null

  const oneLine = status === 'ready' && period
    ? `${weekly ? `${formatHours(weekly.totals.supportHours)} h · ${formatCurrency(weekly.totals.amount)} a week · ` : ''}${formatCurrency(period.totals.amount)} in all`
    : status === 'loading' ? 'Pricing the plan…' : 'Add a block to see the budget'

  return (
    <div className="sticky bottom-[var(--mobile-nav-h)] z-30 -mx-[var(--card-pad)] -mb-[var(--card-pad)] border-t border-[var(--color-border)] bg-[var(--color-card)] px-[var(--card-pad)] py-2 lg:bottom-0">
      {/* The last save's answer, above the figures it is about, capped so a long list of problems scrolls and never takes the screen. */}
      <div className="mb-2 flex max-h-[40vh] flex-col gap-2 overflow-y-auto empty:hidden">{notice}</div>
      {/* The bar's one polite live region, in the page from the start so that what is put into it is announced: the answer of a save that worked, and, visually hidden, the plan crossing its budget (it
          says so once, when it crosses, and not with the amount, which changes on every recalculation while somebody types). Nothing else in the bar is live. */}
      <div role="status">
        {saved && <p className="mb-2 text-sm font-medium">{saved}</p>}
        <p className="sr-only">{over ? 'Over the plan budget.' : ''}</p>
      </div>
      <section aria-label="Running budget" aria-busy={status === 'loading'}>
        {/* A plan that could not be priced says so wherever it is read, on a phone too: not inside the Details a phone keeps shut. */}
        {failure && (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <span><span className="font-medium">{failure.title}.</span> {failure.detail}</span>
            {onRetry && failure.retryable && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
          </div>
        )}

        {status !== 'error' && (
          <div className="flex items-center justify-between gap-3 xl:hidden">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium tabular-nums">{oneLine}</p>
              {(unsaved || over || notFullyPriced) && (
                <p className="mt-1 flex flex-wrap items-center gap-1.5">
                  {unsaved && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className={CHIP}><AlertTriangle className="h-3 w-3" aria-hidden="true" />Not saved</span>
                      <Button variant="secondary" size="sm" disabled={unsaved.saving || blocked} onClick={unsaved.onSave}>{unsaved.saving ? 'Saving…' : 'Save'}</Button>
                    </span>
                  )}
                  {notFullyPriced && <span className={CHIP}><AlertTriangle className="h-3 w-3" aria-hidden="true" />Not fully priced</span>}
                  {over && <span className={CHIP}><AlertTriangle className="h-3 w-3" aria-hidden="true" />Over budget</span>}
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" aria-expanded={open} aria-controls="plan-budget-details" onClick={() => setOpen(current => !current)}>
              Details{open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
            </Button>
          </div>
        )}

        {status !== 'error' && (
          <div id="plan-budget-details" className={`${open ? 'mt-2 grid max-xl:max-h-[45vh] max-xl:overflow-y-auto' : 'hidden'} grid-cols-1 gap-x-6 gap-y-3 xl:mt-0 xl:grid xl:grid-cols-[minmax(11rem,auto)_1fr_minmax(14rem,auto)]`}>
            {status === 'idle' && <p className="text-sm text-[var(--color-muted-foreground)] xl:col-span-3">Add a block to see the weekly hours and cost, and what the agreement comes to.</p>}

            {status === 'loading' && <p className="text-sm text-[var(--color-muted-foreground)] xl:col-span-3">Pricing the plan…</p>}

            {status === 'ready' && period && (
              <>
                <div>
                  <p className={LABEL}>An ordinary week</p>
                  {weekly ? (
                    <p className={HEADLINE}>{formatHours(weekly.totals.supportHours)} h <span className="font-normal text-[var(--color-muted-foreground)]">·</span> {formatCurrency(weekly.totals.amount)}</p>
                  ) : (
                    <p className="text-sm text-[var(--color-muted-foreground)]">The agreement is shorter than a week.</p>
                  )}
                </div>

                <div className="min-w-0">
                  {/* "updating…" is text, not a live region: it would speak on every recalculation while somebody types. aria-busy on the bar carries it for a screen reader. */}
                  <p className={LABEL}>The agreement period{refreshing && <span> · updating…</span>}</p>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
                    <p className={HEADLINE}>{formatCurrency(period.totals.amount)} <span className="text-[13px] font-normal text-[var(--color-muted-foreground)]">{formatHours(period.totals.supportHours)} h of support</span></p>
                    {period.totals.byCategory.length > 0 && (
                      <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] tabular-nums" aria-label="By budget category">
                        {period.totals.byCategory.map(category => (
                          <li key={category.paceCategory} title={category.name}>{categoryLabel(category)} {formatCurrency(category.amount)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {caption.text && <p className={`mt-0.5 text-[13px] ${notFullyPriced ? TONE.warning.ink : 'text-[var(--color-muted-foreground)]'}`}>{caption.text}.</p>}
                </div>

                {planBudgetUnreadable || comparison.status === 'unknown' ? (
                  <div>
                    <p className={LABEL}>Plan budget</p>
                    <p className="text-sm text-[var(--color-muted-foreground)]">{planBudgetUnreadable ? 'The plan budget could not be read, so there is no comparison.' : 'Not recorded for this participant. The totals stand alone.'}</p>
                  </div>
                ) : (
                  // Over the plan budget is the thing to act on: the cell takes the warning tint, and the sentence is text at 13px, not a pill.
                  <div className={over ? `rounded-[var(--radius-md)] p-2 ${TONE.warning.solid}` : ''}>
                    <p className={over ? 'text-xs' : LABEL}>Plan budget</p>
                    <p className={HEADLINE}>{formatCurrency(comparison.budget ?? 0)} <span className={`text-[13px] font-normal ${over ? '' : 'text-[var(--color-muted-foreground)]'}`}>{comparison.percent}% used</span></p>
                    {over ? (
                      <p className="mt-0.5 flex items-start gap-1 text-[13px]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>Over the plan budget by {formatCurrency(Math.abs(comparison.remaining ?? 0))}.{blocked ? '' : ' You can still save the draft.'}</span></p>
                    ) : (
                      <p className={`mt-0.5 ${NOTE}`}>{formatCurrency(comparison.remaining ?? 0)} left{planBudget && planBudget.count > 1 ? `, across ${plural(planBudget.count, 'funding source')}` : ''}.</p>
                    )}
                  </div>
                )}
              </>
            )}

            {incompleteBlocks > 0 && <p className={`${NOTE} xl:col-span-3`}>{plural(incompleteBlocks, 'block')} left out of these figures until {incompleteBlocks === 1 ? 'it is' : 'they are'} complete.</p>}
          </div>
        )}
      </section>
    </div>
  )
}
