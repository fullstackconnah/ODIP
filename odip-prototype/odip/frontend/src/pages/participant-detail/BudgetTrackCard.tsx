import { useRef } from 'react'
import { useBudgetSeries } from '@/api/hooks'
import { BudgetTrackChart, BudgetTrackLegend, BudgetTrackSwitch, BUDGET_TRACK_TITLE } from '@/components/BudgetTrackChart'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { useMeasuredWidth } from '@/hooks/useMeasuredWidth'
import { RetryCallout } from '@/components/PageState'
import { chartHeight, EXPECTED_FOOTNOTE } from '@/lib/budgetTrack'
import { retryingAfterError } from '@/lib/queryPhase'

// The budget graph's place on the Funding tab: its own request, so the ledger's figures never wait on it, and its own loading and failure, which say the figures below are not affected.
// Rendered only for a ledger that has a running plan with pools (FundingLedger's main branch), so it never asks for a participant with no plan or one funded another way.

// The longest sentence the card writes (every clause), laid out unseen so the loading card wraps to the loaded sentence's lines.
const SENTENCE_SAMPLE = 'The whole plan: used $12,427.40 of $52,000.00 so far, $1,200.00 less than an even spread by 28 Oct. At this rate it reaches $50,000.00 by 30 Jun 2027, $2,000.00 under the budget. Booked shifts take it to $51,000.00. The agreement expects $52,000.00 by 30 Jun 2027.'

/** `poolCount` is the ledger's pools: two or more put the plan / pool switch on the loaded card, so the loading card holds its place. */
export default function BudgetTrackCard({ participantId, poolCount = 0 }: { participantId: string; poolCount?: number }) {
  const query = useBudgetSeries(participantId)
  const boxRef = useRef<HTMLDivElement>(null)
  const width = useMeasuredWidth(boxRef)

  if (query.isLoading && !retryingAfterError(query)) {
    return (
      <div aria-busy="true">
        <Card>
          {/* Everything the loaded card has but the plot is laid out unseen, so the pool cards below don't move when the chart arrives; the pulse is the whole chart body, title row aside. */}
          <div ref={boxRef}>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h3 className="text-sm font-semibold">{BUDGET_TRACK_TITLE}</h3>
              {poolCount > 1 && (
                <div className="contents" aria-hidden="true">
                  <BudgetTrackSwitch className="invisible" options={[{ key: 'plan', label: 'Whole plan' }, ...Array.from({ length: poolCount }, (_, i) => ({ key: `pool${i}`, label: 'Pool' }))]} value="plan" onChange={() => {}} width={width ?? 0} />
                </div>
              )}
            </div>
            <div data-chart-skeleton aria-hidden="true" className="animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-container)]">
              <p className="invisible mt-2 max-w-prose text-sm">{SENTENCE_SAMPLE}</p>
              <BudgetTrackLegend className="invisible" />
              <div data-chart-plot-skeleton className="mt-2" style={{ height: chartHeight(width ?? 0) }} />
              <p className="invisible mt-3 text-[13px]">{EXPECTED_FOOTNOTE}</p>
            </div>
          </div>
          <p role="status" className="sr-only">Loading the budget chart…</p>
        </Card>
      </div>
    )
  }

  if (!query.data) {
    return (
      <Card title={BUDGET_TRACK_TITLE}>
        <RetryCallout tone="warning" onRetry={() => query.refetch()}>The budget chart couldn't load. The figures below are not affected.</RetryCallout>
      </Card>
    )
  }

  const series = query.data
  if (series.chart === 'None') return null
  if (series.chart === 'NoPricing') {
    return <p data-chart-state="no-pricing" className="text-[13px] text-[var(--color-muted-foreground)]">The chart needs the price list for this plan's dates before it can be drawn.</p>
  }

  return (
    <div>
      <BudgetTrackChart series={series} />
      {/* A background refetch that fails keeps the chart on screen (DESIGN.md: loading and failure are not zero) and says so under it. */}
      {query.isError && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-on-warning-container)]">
          <p>The chart couldn't be refreshed, so it may be out of date.</p>
          <Button variant="secondary" size="sm" onClick={() => { void query.refetch() }}>Try again</Button>
        </div>
      )}
    </div>
  )
}
