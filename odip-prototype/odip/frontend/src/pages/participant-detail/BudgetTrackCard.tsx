import { useRef } from 'react'
import { useBudgetSeries } from '@/api/hooks'
import { BudgetTrackChart, BudgetTrackLegend, BUDGET_TRACK_TITLE, FULL_LEGEND, useMeasuredWidth } from '@/components/BudgetTrackChart'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { RetryCallout } from '@/components/PageState'
import { chartHeight } from '@/lib/budgetTrack'
import { retryingAfterError } from '@/lib/queryPhase'

// The budget graph's place on the Funding tab: its own request, so the ledger's figures never wait on it, and its own loading and failure, which say the figures below are not affected.
// Rendered only for a ledger that has a running plan with pools (FundingLedger's main branch), so it never asks for a participant with no plan or one funded another way.

export default function BudgetTrackCard({ participantId }: { participantId: string }) {
  const query = useBudgetSeries(participantId)
  const boxRef = useRef<HTMLDivElement>(null)
  const width = useMeasuredWidth(boxRef)

  if (query.isLoading && !retryingAfterError(query)) {
    return (
      <div aria-busy="true">
        <Card title={BUDGET_TRACK_TITLE}>
          {/* The loaded legend and plot take this exact height, so the pool cards below don't move when the chart arrives. */}
          <div ref={boxRef}>
            <div data-chart-skeleton aria-hidden="true" className="animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-container)]">
              {/* The full legend, laid out unseen, so the skeleton wraps to as many lines as the loaded legend at this width. */}
              <BudgetTrackLegend lines={FULL_LEGEND} className="invisible" />
              <div style={{ height: 8 + chartHeight(width ?? 0) }} />
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
