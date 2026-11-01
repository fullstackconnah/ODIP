import { useId, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useClaimPipeline } from '@/api/hooks/claimHub'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { ChartKey } from '@/components/chart/ChartKey'
import { readHidden, writeHidden } from '@/components/chart/storedHidden'
import { useElementWidth } from '@/components/chart/useElementWidth'
import { RetryCallout } from '@/components/PageState'
import { TAP_AREA } from '@/components/tapArea'
import { retryingAfterError } from '@/lib/queryPhase'
import { ClaimsPipelineChart } from './ClaimsPipelineChart'
import {
  FOOTNOTE_SAMPLE, PIPELINE_ERROR, PIPELINE_LOADING, PIPELINE_SCOPE, PIPELINE_STALE, PIPELINE_TITLE, SENTENCE_SAMPLE, pipelineSentence, rejectedLink, undatedFootnote, weeksEmpty,
} from './claimsPipeline'

// Above the claims hub's files strip: dollars sent to the NDIA and paid in each of the last 12 weeks, and where the money stands today (shape brief 2026-11-01).
// Its own request, loading and failure, and each says the rest of the page is unaffected. The hide choice is remembered per device.

const HIDDEN_KEY = 'odip.claims.pipelineHidden'

export function ClaimsPipelineCard({ rejectedCount, onShowRejected }: { rejectedCount: number; onShowRejected: () => void }) {
  const query = useClaimPipeline()
  const [measuredPlot, plotBoxRef] = useElementWidth()
  const plotWidth = measuredPlot ?? 0
  const [stored, setStored] = useState<boolean | null>(() => readHidden(HIDDEN_KEY))
  const bodyId = useId()
  const sentenceId = useId()
  const hidden = stored ?? false
  const toggle = () => { writeHidden(HIDDEN_KEY, !hidden); setStored(!hidden) }

  const titleRow = (toggleButton: boolean) => (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 ${toggleButton ? 'min-h-8' : ''}`}>
      <h3 className="text-sm font-semibold">{PIPELINE_TITLE}</h3>
      {toggleButton && (
        <Button variant="ghost" size="sm" className={TAP_AREA} onClick={toggle} aria-expanded={!hidden} aria-controls={bodyId}>
          {hidden ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronUp aria-hidden="true" className="h-4 w-4" />}
          {hidden ? 'Show chart' : 'Hide chart'}
        </Button>
      )}
    </div>
  )

  if (query.isLoading && !retryingAfterError(query)) {
    return (
      <div aria-busy="true" data-claims-pipeline>
        <Card>
          {titleRow(true)}
          <div aria-hidden="true" className="animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-container)]">
            <p className="invisible mt-2 max-w-prose text-sm">{SENTENCE_SAMPLE}</p>
            <div hidden={hidden} id={bodyId}>
              <div className="invisible mt-2 text-xs">Sent Paid</div>
              <div ref={plotBoxRef} data-chart-plot-skeleton className="mt-2" style={{ height: 166 }} />
              <p className="invisible mt-2 text-[13px]">{PIPELINE_SCOPE}</p>
              <p className="invisible mt-2 text-[13px]">{FOOTNOTE_SAMPLE}</p>
            </div>
          </div>
          <p role="status" className="sr-only">{PIPELINE_LOADING}</p>
        </Card>
      </div>
    )
  }

  if (!query.data) {
    return (
      <div data-claims-pipeline>
        <Card>
          {titleRow(false)}
          <RetryCallout tone="warning" onRetry={() => query.refetch()}>{PIPELINE_ERROR}</RetryCallout>
        </Card>
      </div>
    )
  }

  const data = query.data
  const link = rejectedCount > 0 && (
    <button type="button" className={`${TAP_AREA} mt-1 text-sm font-medium text-[var(--color-primary)] hover:underline`} onClick={onShowRejected}>{rejectedLink(rejectedCount)}</button>
  )

  if (weeksEmpty(data)) {
    return (
      <div data-claims-pipeline>
        <Card>
          {titleRow(false)}
          <p className="mt-2 max-w-prose text-sm">{pipelineSentence(data)}</p>
          {link}
          {data.undatedPaid > 0 && <p className="mt-2 text-[13px] text-[var(--color-muted-foreground)]">{undatedFootnote(data.undatedPaid)}</p>}
        </Card>
      </div>
    )
  }

  return (
    <div data-claims-pipeline>
      <Card>
        {titleRow(true)}
        <p id={sentenceId} className="mt-2 max-w-prose text-sm text-[var(--color-foreground)]">{pipelineSentence(data)}</p>
        {link}
        <div id={bodyId} hidden={hidden}>
          <div data-legend className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex whitespace-nowrap"><ChartKey mark="sent" label="Sent" /></span>
            <span className="flex whitespace-nowrap"><ChartKey mark="paid" label="Paid" /></span>
          </div>
          <div ref={plotBoxRef} className="mt-2">
            <ClaimsPipelineChart data={data} width={plotWidth} sentenceId={sentenceId} />
          </div>
          <p className="mt-2 text-[13px] text-[var(--color-muted-foreground)]">{PIPELINE_SCOPE}</p>
          {data.undatedPaid > 0 && <p className="mt-2 text-[13px] text-[var(--color-muted-foreground)]">{undatedFootnote(data.undatedPaid)}</p>}
        </div>
        {query.isError && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-on-warning-container)]">
            <p>{PIPELINE_STALE}</p>
            <Button variant="secondary" size="sm" onClick={() => { void query.refetch() }}>Try again</Button>
          </div>
        )}
      </Card>
    </div>
  )
}
