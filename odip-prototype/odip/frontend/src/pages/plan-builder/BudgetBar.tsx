import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import type { PlanBudget } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { TONE } from '@/lib/tone'
import { formatHours } from '@/lib/planBlocks'
import { NO_FIGURE, asSentence, categoryLabel, describeQuoteError, pricedNothing, totalsCaption } from '@/lib/planQuote'
import { plural } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import { AgreementBudgetBreakdown } from '../budgets/components/AgreementBudgetBreakdown'
import type { AgreementBudgetBreakdownView } from '../budgets/components/viewModel'
import { CHECK_COULD_NOT_BE_MADE, CHIP_NOT_CHECKED, CHIP_NO_BUDGET, CHIP_PLAN_ENDED } from '../budgets/components/wording'

type BudgetBarProps = {
  /** What the query is doing: `idle` (nothing to price yet), `loading` (the first answer), `error`, `ready`. */
  status: 'idle' | 'loading' | 'error' | 'ready'
  budget?: PlanBudget
  /** A newer answer is on its way while the last one is still shown. */
  refreshing?: boolean
  /**
   * Why there is nothing to price when it is not for want of a block: the agreement's dates are not there, are no day, or end before they start. Said in the one line and in Details, as idle: nothing is
   * in flight, so it is not "pricing" and the bar is not busy.
   */
  idleNote?: string
  error?: unknown
  onRetry?: () => void
  /**
   * The agreement against the participant's real pools (budget phase 2b): for each pool and funding period it touches, what the agreement costs, what is left, and whether it fits. The server works
   * it out (POST participants/{id}/funding/agreement-check); the plan builder maps the answer. Null when there is nothing to compare yet (no block, or no dates to price over). It replaces the sum
   * of the Billing funding sources the bar used to compare the agreement with, with no fallback to it: with no budget recorded the bar says so and links to the Funding tab.
   */
  budgetCheck?: AgreementBudgetBreakdownView | null
  /** Blocks left out of the figures because they are not complete yet. */
  incompleteBlocks?: number
  /**
   * The plan has changes nobody has saved. The one-line form says so with a Save beside it: "Add to plan" does not save, and the save row is a long scroll away under the blocks. `holding`: something
   * the save would race with is under way (another version is being loaded over this plan), so Save is held without saying it is saving.
   */
  unsaved?: { onSave: () => void; saving: boolean; holding?: boolean }
  /**
   * The plan cannot be saved as it is: the engine refused a block, and the save row says why. Save is off, and the over-budget sentence does not say the draft can still be saved. It is the plan's
   * state and not the Save button's, so it is given whether or not there is anything unsaved.
   */
  blocked?: boolean
  /**
   * Why it is blocked, in a sentence: an alert in the dock, so that a refusal found in the stepper (where the save row is not drawn, and the issue list is quiet) is announced, and so that the Save it has
   * switched off has its reason beside it (review L1). Given with `blocked`.
   */
  blockedReason?: string
  /**
   * What the last save said when it was not "saved": the problems found, the server's refusal, a newer version somebody else made. Docked with the bar, so it is in view from the overview and from
   * every step of a block, wherever Save was pressed: a Save from the bar, with a block open, used to answer nowhere and go back to "Save".
   */
  notice?: ReactNode
  /** What a save that worked said ("Saved as version 3."): a polite status in a region that is always in the page, so it is announced when it is filled. */
  saved?: string | null
  /**
   * Told how tall the dock is (the bar with whatever notice is above it) now and each time that changes, and 0 when the bar goes. The plan builder keeps a control the keyboard moves focus to clear of the
   * dock with it (WCAG 2.4.11): the dock is 57 to 123 px as a bar and a notice adds up to 40vh, so no fixed margin can be right.
   */
  onDockHeight?: (px: number) => void
}

const LABEL = 'text-xs text-[var(--color-muted-foreground)]'
/** The figures the bar is for: the Headline step, so they read before the labels and the notes around them. */
const HEADLINE = 'text-xl font-bold tabular-nums leading-tight'
const NOTE = 'text-[13px] text-[var(--color-muted-foreground)]'
const CHIP = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${TONE.warning.solid}`
/** For "nothing to compare" and "could not be checked": neutral, because being over is what earns the warning tone, and these are not a warning. */
const NEUTRAL_CHIP = 'inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-foreground)]'

/**
 * The running budget, docked at the foot through every step: hours and cost in an ordinary week, the cost of the agreement period by budget category, and how that stands against the
 * participant's real pools (each pool and funding period the agreement touches: "Agreement $2,355 against $3,120 left in 1 Oct to 31 Dec"). It is the point of the screen, so its figures are the
 * largest thing on it. Over what a pool has left is a warning and never a block, in every mode; with no budget recorded the totals stand alone and the bar says so and links to the Funding tab.
 * A total that leaves work out says so beside the figure, in shifts, and a chip says it on the one-line form. Below 1280px it is one line and a Details toggle (the full bar is a third of a
 * tablet's screen). Every figure is the pricing engine's, for the plan as it would be saved, and the comparison is the server's.
 */
export function BudgetBar({ status, budget, refreshing = false, idleNote, error, onRetry, budgetCheck = null, incompleteBlocks = 0, blocked = false, blockedReason, unsaved, notice, saved = null, onDockHeight }: BudgetBarProps) {
  const [open, setOpen] = useState(false)
  const dock = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = dock.current
    if (!element || !onDockHeight) return
    const report = () => onDockHeight(Math.ceil(element.getBoundingClientRect().height))
    report()
    if (typeof ResizeObserver === 'undefined') return () => onDockHeight(0)
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => { observer.disconnect(); onDockHeight(0) }
  }, [onDockHeight])
  const period = budget?.period
  const weekly = budget?.weekly ?? null
  const caption = period ? totalsCaption(period) : { text: '', notFullyPriced: false }
  const notFullyPriced = status === 'ready' && caption.notFullyPriced
  const failure = status === 'error' ? describeQuoteError(error) : null
  // A plan that prices to nothing has no total to show: $0.00 would read as a price, and a comparison with the participant's budget as a verdict (review N6).
  const nothingPriced = status === 'ready' && !!period && pricedNothing(period)
  // Over what a pool has left in some period: the server's verdict on each line, and the bar only reads it. Nothing is compared here, and nothing is said of a plan that prices to nothing.
  const over = status === 'ready' && !nothingPriced && budgetCheck?.status === 'ready' && budgetCheck.pools.some(pool => pool.lines.some(line => !line.withinLimit))
  // The reference week can price to nothing while the agreement does not (an agreement that starts before the first catalogue date): its figure is an en dash too, not "0 h . $0.00 a week" (review L2).
  const weekNothing = nothingPriced || (status === 'ready' && !!weekly && pricedNothing(weekly))
  const updating = status === 'ready' && refreshing
  // The agreement check has its own answer to wait for: busy while the first one is on its way and while a newer one replaces the last.
  const checking = status === 'ready' && (budgetCheck?.status === 'loading' || budgetCheck?.refreshing === true)
  // What the one-line form says when there is nothing to compare with, or the comparison failed: below 1280px that line is all a phone or tablet reads, and silence there reads as "fits". A plan that
  // prices to nothing has nothing to compare, and the Details say so.
  const checkState = status === 'ready' && !nothingPriced ? budgetCheck?.status : undefined
  const checkFailed = checkState === 'failed'
  const checkChip = checkState === 'none' ? (budgetCheck?.noBudgetReason === 'PlanEnded' ? CHIP_PLAN_ENDED : CHIP_NO_BUDGET) : checkFailed ? CHIP_NOT_CHECKED : null

  const oneLine = status === 'ready' && period
    ? `${weekly ? (weekNothing ? `${NO_FIGURE} h · ${NO_FIGURE} a week · ` : `${formatHours(weekly.totals.supportHours)} h · ${formatCurrency(weekly.totals.amount)} a week · `) : ''}${nothingPriced ? NO_FIGURE : formatCurrency(period.totals.amount)} in all`
    : status === 'loading' ? 'Pricing the plan…' : idleNote ?? 'Add a block to see the budget'

  return (
    <div ref={dock} className="sticky bottom-[var(--mobile-nav-h)] z-30 -mx-[var(--card-pad)] -mb-[var(--card-pad)] border-t border-[var(--color-border)] bg-[var(--color-card)] px-[var(--card-pad)] py-2 lg:bottom-0">
      {/* The last save's answer, above the figures it is about, capped so a long list of problems scrolls and never takes the screen. */}
      <div className="mb-2 flex max-h-[40vh] flex-col gap-2 overflow-y-auto empty:hidden">
        {notice}
        {blockedReason && <Callout tone="error" className="max-w-prose">{blockedReason}</Callout>}
      </div>
      {/* The bar's one polite live region, in the page from the start so that what is put into it is announced: the answer of a save that worked, and, visually hidden, the plan crossing its budget (it
          says so once, when it crosses, and not with the amount, which changes on every recalculation while somebody types) and the plan becoming unsaved (once, when it does, and not on every keystroke
          after it: the sentence does not change). Nothing else in the bar is live. */}
      <div role="status">
        {saved && <p className="mb-2 text-sm font-medium">{saved}</p>}
        <p className="sr-only">{over ? 'Over the participant\'s budget.' : ''}</p>
        <p className="sr-only">{checkFailed ? CHECK_COULD_NOT_BE_MADE : ''}</p>
        <p className="sr-only">{unsaved ? 'The plan has changes that are not saved.' : ''}</p>
      </div>
      <section aria-label="Running budget" aria-busy={status === 'loading' || updating || checking}>
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
              <p className="text-sm font-medium tabular-nums">
                {oneLine}
                {/* The one line is all a tablet reads, so what makes it provisional is in it: a newer answer on its way, and the blocks the figure leaves out. */}
                {status === 'ready' && (updating || incompleteBlocks > 0) && (
                  <span className="font-normal text-[var(--color-muted-foreground)]">{updating && ' · updating…'}{incompleteBlocks > 0 && ` · ${plural(incompleteBlocks, 'block')} left out`}</span>
                )}
              </p>
              {(unsaved || over || notFullyPriced || checkChip) && (
                <p className="mt-1 flex flex-wrap items-center gap-1.5">
                  {unsaved && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className={CHIP}><AlertTriangle className="h-3 w-3" aria-hidden="true" />Not saved</span>
                      <Button variant="secondary" size="sm" data-plan-save disabled={unsaved.saving || unsaved.holding || blocked} onClick={unsaved.onSave}>{unsaved.saving ? 'Saving…' : 'Save'}</Button>
                    </span>
                  )}
                  {notFullyPriced && <span className={CHIP}><AlertTriangle className="h-3 w-3" aria-hidden="true" />Not fully priced</span>}
                  {over && <span className={CHIP}><AlertTriangle className="h-3 w-3" aria-hidden="true" />Over budget</span>}
                  {checkChip && <span className={NEUTRAL_CHIP}>{checkChip}</span>}
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" aria-expanded={open} aria-controls="plan-budget-details" onClick={() => setOpen(current => !current)}>
              Details{open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
            </Button>
          </div>
        )}

        {status !== 'error' && (
          <div id="plan-budget-details" className={`${open ? 'mt-2 grid max-xl:max-h-[45vh] max-xl:overflow-y-auto' : 'hidden'} grid-cols-1 gap-x-6 gap-y-3 xl:mt-0 xl:grid xl:grid-cols-[minmax(11rem,auto)_1fr_minmax(14rem,26rem)]`}>
            {status === 'idle' && <p className="text-sm text-[var(--color-muted-foreground)] xl:col-span-3">{idleNote ? `${idleNote}. The dates are in Draft details, above the plan.` : 'Add a block to see the weekly hours and cost, and what the agreement comes to.'}</p>}

            {status === 'loading' && <p className="text-sm text-[var(--color-muted-foreground)] xl:col-span-3">Pricing the plan…</p>}

            {status === 'ready' && period && (
              <>
                <div>
                  <p className={LABEL}>An ordinary week</p>
                  {weekly ? (
                    <p className={HEADLINE}>{weekNothing ? NO_FIGURE : formatHours(weekly.totals.supportHours)} h <span className="font-normal text-[var(--color-muted-foreground)]">·</span> {weekNothing ? NO_FIGURE : formatCurrency(weekly.totals.amount)}</p>
                  ) : (
                    <p className="text-sm text-[var(--color-muted-foreground)]">The agreement is shorter than a week.</p>
                  )}
                </div>

                <div className="min-w-0">
                  {/* "updating…" is text, not a live region: it would speak on every recalculation while somebody types. aria-busy on the bar carries it for a screen reader. */}
                  <p className={LABEL}>The agreement period{refreshing && <span> · updating…</span>}</p>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
                    <p className={HEADLINE}>{nothingPriced ? NO_FIGURE : formatCurrency(period.totals.amount)}{!nothingPriced && <> <span className="text-[13px] font-normal text-[var(--color-muted-foreground)]">{formatHours(period.totals.supportHours)} h of support</span></>}</p>
                    {period.totals.byCategory.length > 0 && (
                      <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] tabular-nums" aria-label="By budget category">
                        {period.totals.byCategory.map(category => (
                          <li key={category.paceCategory} title={category.name}>{categoryLabel(category)} {formatCurrency(category.amount)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {caption.text && <p className={`mt-0.5 text-[13px] ${notFullyPriced ? TONE.warning.ink : 'text-[var(--color-muted-foreground)]'}`}>{asSentence(caption.text)}.</p>}
                </div>

                {/* The participant's budget (phase 2b): per pool and funding period, the agreement against what is left. A warning only - it is the pricing engine's cost against the ledger's remaining, both
                    the server's - so a plan that cannot be priced says nothing here, and one with no budget recorded says so and links to the Funding tab. */}
                {(nothingPriced || budgetCheck) && (
                  <div className="min-w-0">
                    <p className={LABEL}>Participant budget</p>
                    {nothingPriced ? (
                      <p className={NOTE}>Nothing is priced yet, so there is nothing to compare.</p>
                    ) : budgetCheck ? (
                      <AgreementBudgetBreakdown view={budgetCheck} />
                    ) : null}
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
