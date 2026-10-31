import { useId, useLayoutEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useRosterFill } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { ChartKey } from '@/components/chart/ChartKey'
import { RetryCallout } from '@/components/PageState'
import { TAP_AREA } from '@/components/tapArea'
import { retryingAfterError } from '@/lib/queryPhase'
import { COLUMNS_MIN, RosterFillChart } from './RosterFillChart'
import { FILL_ERROR, FILL_LOADING, FILL_SCOPE, FILL_STALE, FILL_TITLE, SENTENCE_SAMPLE, fillSentence } from '../lib/rosterFill'

// Under the Rostering header: how full the next 8 weeks are, and a week picker (shape brief 2026-10-31). Its own request, loading and failure,
// and each says the board below is unaffected. The hide choice is remembered per device.

const HIDDEN_KEY = 'odip.roster.fillHidden'
const WIDE = 1024

/** The element's content width. The card swaps its subtree between loading and loaded, so this follows the element (a callback ref), not one ref object. */
function useElementWidth() {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState<number>()
  useLayoutEffect(() => {
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])
  return [width, setEl] as const
}

/** '1' hidden, '0' shown, anything else (or storage unreadable) null: the card then follows its width. */
function readHidden(): boolean | null {
  try {
    const v = window.localStorage.getItem(HIDDEN_KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch { return null }
}
function writeHidden(hidden: boolean) {
  try { window.localStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0') } catch { /* the choice just isn't remembered */ }
}

export function RosterFillCard({ boardWeek, onSelectWeek }: { boardWeek: string | undefined; onSelectWeek: (weekStart: string) => void }) {
  const query = useRosterFill()
  const [boxWidth, boxRef] = useElementWidth()
  const [measuredPlot, plotBoxRef] = useElementWidth()
  const plotWidth = measuredPlot ?? 0
  const [stored, setStored] = useState<boolean | null>(readHidden)
  const bodyId = useId()
  const sentenceId = useId()
  // A phone-width card starts collapsed (the expanded rows are ~650px); a stored choice wins.
  const hidden = stored ?? (boxWidth !== undefined && boxWidth < COLUMNS_MIN)
  const toggle = () => { writeHidden(!hidden); setStored(!hidden) }
  const wide = (boxWidth ?? 0) >= WIDE

  const titleRow = (toggleButton: boolean) => (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <h3 className="text-sm font-semibold">{FILL_TITLE}</h3>
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
      <div aria-busy="true">
        <Card>
          <div ref={boxRef}>
            {titleRow(true)}
            <div aria-hidden="true" className="animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-container)]">
              <p className="invisible mt-2 max-w-prose text-sm">{SENTENCE_SAMPLE}</p>
              <div hidden={hidden} id={bodyId}>
                <div className="invisible mt-2 text-xs">Filled Open</div>
                <p className="invisible mt-2 text-[13px]">{FILL_SCOPE}</p>
                <div ref={plotBoxRef} data-chart-plot-skeleton className="mt-2" style={{ height: plotWidth >= COLUMNS_MIN ? 160 : 8 * 44 + 40 }} />
              </div>
            </div>
          </div>
          <p role="status" className="sr-only">{FILL_LOADING}</p>
        </Card>
      </div>
    )
  }

  if (!query.data) {
    return (
      <Card>
        {titleRow(false)}
        <RetryCallout tone="warning" onRetry={() => query.refetch()}>{FILL_ERROR}</RetryCallout>
      </Card>
    )
  }

  const data = query.data
  if (data.weeks.every(w => w.shifts === 0)) {
    return (
      <Card>
        {titleRow(false)}
        <p className="mt-2 max-w-prose text-sm">{fillSentence(data)}</p>
      </Card>
    )
  }

  const legend = (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      <ChartKey mark="filled" label="Filled" />
      <ChartKey mark="open" label="Open" />
    </div>
  )
  const sentence = <p id={sentenceId} className="mt-2 max-w-prose text-sm text-[var(--color-foreground)]">{fillSentence(data)}</p>
  const scope = <p className="mt-2 text-[13px] text-[var(--color-muted-foreground)]">{FILL_SCOPE}</p>
  const chart = (
    <div ref={plotBoxRef} className="mt-2">
      <RosterFillChart data={data} boardWeek={boardWeek} width={plotWidth} onSelectWeek={onSelectWeek} sentenceId={sentenceId} />
    </div>
  )

  return (
    <Card>
      <div ref={boxRef}>
        {titleRow(true)}
        {wide ? (
          <div className="grid grid-cols-[18rem_minmax(0,1fr)] gap-x-6">
            <div>
              {sentence}
              <div hidden={hidden}>{legend}{scope}</div>
            </div>
            <div id={bodyId} hidden={hidden}>{chart}</div>
          </div>
        ) : (
          <>
            {sentence}
            <div id={bodyId} hidden={hidden}>{legend}{scope}{chart}</div>
          </>
        )}
        {query.isError && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-on-warning-container)]">
            <p>{FILL_STALE}</p>
            <Button variant="secondary" size="sm" onClick={() => { void query.refetch() }}>Try again</Button>
          </div>
        )}
      </div>
    </Card>
  )
}
