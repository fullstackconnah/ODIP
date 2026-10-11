import { useMemo } from 'react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { StatusBadge } from '@/components/StatusBadge'
import type { AgreementIssue } from '@/lib/agreementIssues'
import { plural } from '@/lib/format'
import { formatHours } from '@/lib/planBlocks'
import { NO_FIGURE, asSentence, categoryLabel, describeQuoteError, pricedNothing, totalsCaption } from '@/lib/planQuote'
import { formatCurrency } from '@/lib/utils'
import { AgreementBudgetBreakdown } from '../budgets/components/AgreementBudgetBreakdown'
import { PlanNotices } from './PlanNotices'
import type { useAgreementPricing } from './useAgreementPricing'

type CheckStepProps = {
  pricing: ReturnType<typeof useAgreementPricing>
  issues: AgreementIssue[]
  /** Any shift is set to skip public holidays. */
  anySkipped: boolean
  /** Select these shifts in the Week step (or the Agreement step for a date). */
  onFix: (issue: AgreementIssue) => void
  /** Select the shifts that fall on a public holiday, to change how they are charged. */
  onChangeHolidays: (blockIds: string[]) => void
  readOnly: boolean
}

const LABEL = 'text-xs text-[var(--color-muted-foreground)]'
const HEADLINE = 'text-xl font-bold tabular-nums leading-tight'

/**
 * Step 3: the one place for money and for what stands in the way. The participant's budget comes first (per pool and funding period, the server's comparison), then the week and the agreement
 * in figures, then every issue in plain words with a Fix that jumps to the shifts. A comparison with the budget never stops a save: it is a warning only.
 */
export function CheckStep({ pricing, issues, anySkipped, onFix, onChangeHolidays, readOnly }: CheckStepProps) {
  const { answer, status, budgetView, refreshing, leftOut } = pricing
  const period = answer?.period
  const weekly = answer?.weekly ?? null
  const nothing = status === 'ready' && !!period && pricedNothing(period)
  const caption = period ? totalsCaption(period) : { text: '', notFullyPriced: false }
  const failure = status === 'error' ? describeQuoteError(pricing.error) : null
  const holidays = useMemo(() => {
    const occurrences = period?.holidayOccurrences ?? []
    return { days: new Set(occurrences.map(occurrence => occurrence.date)).size, blockIds: [...new Set(occurrences.map(occurrence => occurrence.blockId))] }
  }, [period])

  return (
    <div className="flex max-w-4xl flex-col gap-[var(--section-gap)]">
      {failure && (
        <Callout tone="error" title={`${failure.title}`} actions={failure.retryable ? <Button variant="secondary" size="sm" onClick={pricing.retry}>Retry</Button> : undefined}>{failure.detail}</Callout>
      )}
      {status === 'idle' && <p className="text-sm text-[var(--color-muted-foreground)]">{pricing.dates ? 'Set the agreement dates in the first step to price the week.' : 'Add shifts in the Week step to see what they cost.'}</p>}
      {status === 'loading' && <p className="text-sm text-[var(--color-muted-foreground)]" aria-busy="true">Pricing the agreement…</p>}

      {status === 'ready' && period && (
        <>
          <section aria-labelledby="check-budget" className="flex flex-col gap-2" aria-busy={refreshing}>
            <h3 id="check-budget" className="text-sm font-semibold">Against the participant&apos;s budget{refreshing && <span className="font-normal text-[var(--color-muted-foreground)]"> · updating…</span>}</h3>
            {nothing ? (
              <p className="text-[13px] text-[var(--color-muted-foreground)]">Nothing is priced yet, so there is nothing to compare.</p>
            ) : budgetView ? <AgreementBudgetBreakdown view={budgetView} /> : null}
          </section>

          <section aria-labelledby="check-cost" className="flex flex-col gap-2">
            <h3 id="check-cost" className="text-sm font-semibold">What it costs</h3>
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              <div>
                <p className={LABEL}>An ordinary week</p>
                {weekly ? (
                  <p className={HEADLINE}>{pricedNothing(weekly) ? NO_FIGURE : formatHours(weekly.totals.supportHours)} h <span className="font-normal text-[var(--color-muted-foreground)]">·</span> {pricedNothing(weekly) ? NO_FIGURE : formatCurrency(weekly.totals.amount)}</p>
                ) : <p className="text-sm text-[var(--color-muted-foreground)]">The agreement is shorter than a week.</p>}
              </div>
              <div>
                <p className={LABEL}>The whole agreement</p>
                <p className={HEADLINE}>{nothing ? NO_FIGURE : formatCurrency(period.totals.amount)}{!nothing && <> <span className="text-[13px] font-normal text-[var(--color-muted-foreground)]">{formatHours(period.totals.supportHours)} h of support</span></>}</p>
              </div>
            </div>
            {period.totals.byCategory.length > 0 && (
              <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] tabular-nums" aria-label="By budget category">
                {period.totals.byCategory.map(category => <li key={category.paceCategory} title={category.name}>{categoryLabel(category)} {formatCurrency(category.amount)}</li>)}
              </ul>
            )}
            {caption.text && <p className="text-[13px] text-[var(--color-muted-foreground)]">{asSentence(caption.text)}.</p>}
            {leftOut > 0 && <p className="text-[13px] text-[var(--color-muted-foreground)]">{plural(leftOut, 'shift')} left out of these figures until {leftOut === 1 ? 'it is' : 'they are'} complete.</p>}
          </section>

          {holidays.days > 0 && (
            <p className="text-sm">
              {plural(holidays.days, 'public holiday')} {holidays.days === 1 ? 'falls' : 'fall'} in this agreement; shifts on them are charged at the holiday rate{anySkipped ? ', except those set to skip' : ''}.{' '}
              {!readOnly && <Button variant="ghost" size="sm" onClick={() => onChangeHolidays(holidays.blockIds)}>Change</Button>}
            </p>
          )}
        </>
      )}

      <section aria-labelledby="check-issues" className="flex flex-col gap-2">
        <h3 id="check-issues" className="text-sm font-semibold">To look at</h3>
        {issues.length === 0 ? (
          status === 'ready' && <p className="text-sm text-[var(--color-muted-foreground)]">Nothing to fix before it is saved.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {issues.map(issue => (
              <li key={issue.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
                <div className="flex min-w-0 flex-1 items-start gap-2 text-sm">
                  <StatusBadge tone={issue.tone === 'fix' ? 'danger' : 'warning'} label={issue.tone === 'fix' ? 'Fix' : 'Review'} />
                  <span className="min-w-0 flex-1">
                    {issue.title}
                    {issue.detail && <span className="block text-[13px] text-[var(--color-muted-foreground)]">{issue.detail}</span>}
                    {issue.advice && <span className="block text-[13px] text-[var(--color-muted-foreground)]">{issue.advice}</span>}
                  </span>
                </div>
                {!readOnly && <Button className="self-start" variant="secondary" size="sm" onClick={() => onFix(issue)}>{issue.step === 'agreement' ? 'Go to dates' : 'Fix'}<span className="sr-only"> {issue.title}</span></Button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {period && <PlanNotices notices={period.notices} />}
    </div>
  )
}
