import { useId, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useIncidentTrend } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { ChartKey } from '@/components/chart/ChartKey'
import { readHidden, writeHidden } from '@/components/chart/storedHidden'
import { useElementWidth } from '@/components/chart/useElementWidth'
import { RetryCallout } from '@/components/PageState'
import { TAP_AREA } from '@/components/tapArea'
import { retryingAfterError } from '@/lib/queryPhase'
import { IncidentTrendChart, NARROW } from './IncidentTrendChart'
import { SENTENCE_SAMPLE, TREND_ERROR, TREND_LOADING, TREND_SCOPE, TREND_STALE, TREND_TITLE, trendSentence } from './incidentTrend'

// Above the Incidents list for managers: incidents and restrictive practice uses by month, over the last 6 months (shape brief 2026-10-31). Its own request,
// loading and failure, and each says the list below is unaffected. The hide choice is remembered per device.

const HIDDEN_KEY = 'odip.incidents.trendHidden'
const WIDE = 960 // the 1280 desktop card is ~982px inner

export function IncidentTrendCard() {
  const query = useIncidentTrend()
  const [boxWidth, boxRef] = useElementWidth()
  const [measuredPlot, plotBoxRef] = useElementWidth()
  const plotWidth = measuredPlot ?? 0
  const [stored, setStored] = useState<boolean | null>(() => readHidden(HIDDEN_KEY))
  const bodyId = useId()
  const sentenceId = useId()
  // A phone-width card starts collapsed (expanded it is ~415px and pushes the list below the fold); a stored choice wins.
  const hidden = stored ?? (boxWidth !== undefined && boxWidth < NARROW)
  const toggle = () => { writeHidden(HIDDEN_KEY, !hidden); setStored(!hidden) }
  const wide = (boxWidth ?? 0) >= WIDE

  const titleRow = (toggleButton: boolean) => (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 ${toggleButton ? 'min-h-8' : ''}`}>
      <h3 className="text-sm font-semibold">{TREND_TITLE}</h3>
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
      <div aria-busy="true" data-incident-trend>
        <Card>
          <div ref={boxRef}>
            {titleRow(true)}
            <div aria-hidden="true" className="animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-container)]">
              <p className="invisible mt-2 max-w-prose text-sm">{SENTENCE_SAMPLE}</p>
              <div hidden={hidden} id={bodyId}>
                <div className="invisible mt-2 text-xs">Restrictive practice uses Other incidents</div>
                <p className="invisible mt-2 text-[13px]">{TREND_SCOPE}</p>
                <div ref={plotBoxRef} data-chart-plot-skeleton className="mt-2" style={{ height: 174 }} />
              </div>
            </div>
          </div>
          <p role="status" className="sr-only">{TREND_LOADING}</p>
        </Card>
      </div>
    )
  }

  if (!query.data) {
    return (
      <div data-incident-trend>
        <Card>
          {titleRow(false)}
          <RetryCallout tone="warning" onRetry={() => query.refetch()}>{TREND_ERROR}</RetryCallout>
        </Card>
      </div>
    )
  }

  const data = query.data
  if (data.months.every(m => m.incidents === 0)) {
    return (
      <div data-incident-trend>
        <Card>
          {titleRow(false)}
          <p className="mt-2 max-w-prose text-sm">{trendSentence(data)}</p>
        </Card>
      </div>
    )
  }

  const legend = (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="whitespace-nowrap"><ChartKey mark="rp" label="Restrictive practice uses" /></span>
      <span className="whitespace-nowrap"><ChartKey mark="other" label="Other incidents" /></span>
    </div>
  )
  const sentence = <p id={sentenceId} className="mt-2 max-w-prose text-sm text-[var(--color-foreground)]">{trendSentence(data)}</p>
  const scope = <p className="mt-2 text-[13px] text-[var(--color-muted-foreground)]">{TREND_SCOPE}</p>
  const chart = (
    <div ref={plotBoxRef} className="mt-2">
      <IncidentTrendChart data={data} width={plotWidth} sentenceId={sentenceId} />
    </div>
  )

  return (
    <div data-incident-trend>
      <Card>
        <div ref={boxRef}>
          {titleRow(true)}
          {wide && !hidden ? (
            <div className="grid grid-cols-[20rem_minmax(0,1fr)] gap-x-6">
              <div>
                {sentence}
                {legend}{scope}
              </div>
              <div id={bodyId}>{chart}</div>
            </div>
          ) : (
            <>
              {sentence}
              <div id={bodyId} hidden={hidden}>{legend}{scope}{chart}</div>
            </>
          )}
          {query.isError && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-on-warning-container)]">
              <p>{TREND_STALE}</p>
              <Button variant="secondary" size="sm" onClick={() => { void query.refetch() }}>Try again</Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
