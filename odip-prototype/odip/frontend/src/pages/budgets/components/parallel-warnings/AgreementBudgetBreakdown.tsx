import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { TONE } from '@/lib/tone'
import { plural } from '@/lib/format'
import { writtenSpan } from '@/lib/fundingPlan'
import { formatCurrency } from '@/lib/utils'
import type { AgreementBudgetBreakdownView, AgreementBudgetLine, BudgetAttentionAction, BudgetFigureVisibility } from './viewModel'
import { BudgetFigure } from './BudgetFigure'
import { NO_FIGURE, agreementLineSentence } from './wording'

// The action the "no budget recorded" line offers, shared with the band so a destination is rendered one way across these surfaces.
function ActionButton({ action }: { action: BudgetAttentionAction }) {
  if ('to' in action) return <Button size="sm" variant="secondary" to={action.to}>{action.label}</Button>
  return <Button size="sm" variant="secondary" onClick={action.onSelect}>{action.label}</Button>
}

// The agreement budget bar's per-pool, per-period breakdown: what the agreement is signed/committed at, what its work is forecast to come
// to, and what the period has available. The phase-2b agreement-check endpoint computes every one of those figures; this component only
// draws them, and it draws them in three separate places on purpose.
//
// Why three separate places, never a sum:
//   COMMITTED  money that is signed or already saved against the period. A fact about an agreement.
//   FORECAST   what the booked work would come to. An estimate, and legitimately null (the server could not price it).
//   AVAILABLE  what the period has, and WHICH figure that is (the provider's set-aside or the whole-plan amount) is the server's decision:
//              owner decision 1 says the set-aside when one is recorded, otherwise the plan amount.
// Adding committed to available, or printing a plan amount beside a set-aside as if they were alternatives, is exactly the conflation this
// component exists to prevent. The whole-plan amount therefore gets its own labelled line and is never the limit.
//
// WARNING ONLY, in every mode, including Hard Limit: an owner decision. Nothing here blocks a save or an approval, and this component
// cannot express a block: it holds no callback that could refuse anything.

const LABEL = 'text-xs text-[var(--color-muted-foreground)]'
const FIGURE = 'text-sm font-semibold tabular-nums'

/** One pool and period, as its own line. Every figure goes through `BudgetFigure`, so a withheld amount cannot leak into a title or an aria. */
function Line({ line, figures }: { line: AgreementBudgetLine; figures: BudgetFigureVisibility }) {
  const periodLabel = writtenSpan(line.periodStart, line.periodEnd)
  const fromSetAside = line.allowance.limitSource === 'setAside'
  const limit = fromSetAside ? line.allowance.setAside : line.allowance.planAmount

  return (
    <li
      className={`flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)] ${line.withinLimit ? '' : TONE.warning.solid}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold">{line.poolLabel}</p>
        <p className="text-[13px] text-[var(--color-muted-foreground)]">{periodLabel}</p>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className={LABEL}>Signed or committed</dt>
          <dd className={FIGURE}>
            <BudgetFigure figures={figures} amount={line.committed} />
          </dd>
        </div>
        <div>
          <dt className={LABEL}>Forecast of this agreement</dt>
          <dd className={FIGURE}>
            <BudgetFigure figures={figures} amount={line.forecast} srNote="An estimate, not a signed figure." />
          </dd>
        </div>
        <div>
          <dt className={LABEL}>{fromSetAside ? 'Available: set aside for us' : 'Available: whole plan amount'}</dt>
          <dd className={FIGURE}>
            <BudgetFigure figures={figures} amount={limit} />
            {/* Which of the two figures is the limit is the server's decision (owner decision 1), and a reader cannot infer it from the two
                lines alone. Said in one line, always, and never as an error: having no set-aside is a fact, not a failure. */}
            {!fromSetAside && <span className="block text-xs font-normal text-[var(--color-muted-foreground)]">No set-aside is recorded, so the whole plan amount is the limit.</span>}
          </dd>
        </div>
        {/* The other figure, on its own line, always: it is never the limit, and leaving it out would let a reader assume it is. */}
        <div>
          <dt className={LABEL}>{fromSetAside ? 'Whole plan amount for this pool' : 'Set aside for us'}</dt>
          <dd className="text-sm tabular-nums text-[var(--color-muted-foreground)]">
            {!figures.visible
              ? 'Not shown'
              : fromSetAside
                ? (line.allowance.planAmount === null ? <span aria-hidden="true">{NO_FIGURE}</span> : formatCurrency(line.allowance.planAmount))
                : <span aria-hidden="true">{NO_FIGURE}</span>}
          </dd>
        </div>
      </dl>

      <p className={`flex items-start gap-1 text-[13px] ${line.withinLimit ? 'text-[var(--color-muted-foreground)]' : 'font-medium'}`}>
        {!line.withinLimit && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span>
          {line.withinLimit
            ? agreementLineSentence({ within: true, overBy: '', periodLabel })
            : agreementLineSentence({
                within: false,
                overBy: figures.visible && line.overBy !== null ? formatCurrency(line.overBy) : 'an amount not shown here',
                periodLabel,
              })}
        </span>
      </p>
    </li>
  )
}

export function AgreementBudgetBreakdown({ view }: { view: AgreementBudgetBreakdownView }) {
  const { figures } = view

  if (view.status === 'loading') {
    return (
      <p role="status" className="text-[13px] text-[var(--color-muted-foreground)]">
        Checking the agreement against the participant&rsquo;s budget…
      </p>
    )
  }

  if (view.status === 'failed') {
    return (
      <Callout tone="warning" className="max-w-prose">
        {view.failureMessage ?? 'The agreement could not be checked against the budget, so no comparison is shown. The plan can still be saved.'}
      </Callout>
    )
  }

  if (view.lines.length === 0) {
    // "No budget recorded" is the commonest state and must link to where a budget is recorded, never warn (SHAPE-BRIEF §5).
    const action = view.noBudgetAction
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-muted-foreground)]">
        <p>No budget recorded for this participant, so there is nothing to compare the agreement against.</p>
        {action && <ActionButton action={action} />}
      </div>
    )
  }

  const over = view.lines.filter(line => !line.withinLimit).length

  return (
    <section aria-label="Agreement against the participant budget" aria-busy={view.refreshing === true} className="flex flex-col gap-2">
      <p className="text-[13px] text-[var(--color-muted-foreground)]">
        {plural(view.lines.length, 'pool and period', 'pools and periods')}, at the agreement&rsquo;s signed figures and at the forecast, against
        what each period has available. A dash is a figure the server could not give: it is not zero.
        {view.refreshing === true && ' Updating…'}
      </p>
      <ul className="flex flex-col gap-2">
        {view.lines.map(line => (
          <Line key={`${line.poolLabel}-${line.periodStart}-${line.periodEnd}`} line={line} figures={figures} />
        ))}
      </ul>
      {over > 0 && (
        <p className="flex items-start gap-1 text-[13px] font-medium">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {plural(over, 'pool and period', 'pools and periods')} would be over the available funds. This is a warning only: the agreement
            can still be saved and approved, in every mode.
          </span>
        </p>
      )}
    </section>
  )
}
