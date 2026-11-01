import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { PipelineDto } from '@/api/types'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { ChartReadout } from '@/components/chart/ChartReadout'
import { ChartTable } from '@/components/chart/ChartTable'
import { countTicks, readoutLeft } from '@/components/chart/ticks'
import { useChartPoints } from '@/components/chart/useChartPoints'
import { compactAud } from '@/lib/budgetTrack'
import { labelledWeeks, liveLine, PIPELINE_LABEL, readoutRows, tableCaption, tableRows, TABLE_COLUMNS, weekShort } from './claimsPipeline'

/** Below this plot width the readout sits on the side away from the week, and only every third week is labelled. */
export const NARROW = 480

const PLOT_H = 120
const M = { top: 8, bottom: 38 }
const H = M.top + PLOT_H + M.bottom
const LEFT = 44 // fits "$100K" at 12px
const GAP = 2

/** Twelve weeks at every width: a hollow hatched Sent bar beside a solid Paid bar (shape brief 2026-11-01). Zero weeks draw nothing; the readout and the table carry the zeros. */
export function ClaimsPipelineChart({ data, width: W, sentenceId }: { data: PipelineDto; width: number; sentenceId: string }) {
  const { weeks } = data
  const patId = useId()
  const readoutRef = useRef<HTMLDivElement>(null)
  const [readoutSize, setReadoutSize] = useState({ w: 160, h: 80 })
  const narrow = W < NARROW
  const max = Math.max(...weeks.map(w => Math.max(w.sent, w.paid)), 1)
  const ticks = countTicks(Math.ceil(max), PLOT_H)
  const top = ticks[ticks.length - 1]
  const slot = (W - LEFT) / weeks.length
  const baseline = M.top + PLOT_H
  const yOf = (v: number) => baseline - (v / top) * PLOT_H
  const pair = Math.min(Math.max(Math.round(slot * 0.6), 14), 56)
  const barW = (pair - GAP) / 2
  const labelled = labelledWeeks(weeks.length, narrow)

  const chart = useChartPoints({
    count: weeks.length,
    restIndex: weeks.length - 1,
    nearest: e => {
      const box = plotProps.ref.current?.getBoundingClientRect()
      return box ? Math.min(Math.max(Math.floor((e.clientX - box.left - LEFT) / slot), 0), weeks.length - 1) : 0
    },
    label: PIPELINE_LABEL,
    sentenceId,
    describe: i => liveLine(data, i),
  })
  const { shown, plotProps } = chart

  useLayoutEffect(() => {
    const el = readoutRef.current
    if (el) setReadoutSize({ w: el.offsetWidth, h: el.offsetHeight })
  }, [shown, W])

  const readout = shown === null ? null : readoutRows(data, shown)
  const barH = (v: number) => (v > 0 ? Math.max(2, (v / top) * PLOT_H) : 0)

  return (
    <div>
      <div {...plotProps} data-plot className="rf-plot relative">
        {W > 0 && (
          <>
            <svg width={W} height={H} aria-hidden="true" className="block">
              <defs>
                <pattern id={patId} patternUnits="userSpaceOnUse" width={4} height={4} patternTransform="rotate(45)">
                  <line x1={0} y1={0} x2={0} y2={4} strokeWidth={1} style={{ stroke: 'var(--color-chart-other)' }} />
                </pattern>
              </defs>
              {ticks.map(v => (
                <g key={v} data-ytick={v}>
                  <line className="bt-grid" x1={LEFT} x2={W} y1={Math.round(yOf(v)) + 0.5} y2={Math.round(yOf(v)) + 0.5} />
                  <text x={LEFT - 6} y={yOf(v) + 4} textAnchor="end" className="fill-[var(--color-muted-foreground)] text-xs tabular-nums">{compactAud(v)}</text>
                </g>
              ))}
              {weeks.map((w, i) => {
                const cx = LEFT + slot * (i + 0.5)
                const sentX = cx - pair / 2
                const sh = barH(w.sent)
                const ph = barH(w.paid)
                return (
                  <g key={w.weekStart} data-cp-week={w.weekStart}>
                    <rect x={LEFT + slot * i} y={M.top} width={slot} height={PLOT_H} fill="transparent" />
                    {shown === i && <rect className="rf-wash" x={LEFT + slot * i} y={M.top} width={slot} height={PLOT_H} />}
                    {sh > 0 && <rect data-bar="sent" className="cp-sent" fill={`url(#${patId})`} x={sentX + 0.75} y={baseline - sh + 0.75} width={barW - 1.5} height={Math.max(sh - 1.5, 0.5)} />}
                    {ph > 0 && <rect data-bar="paid" className="cp-paid" x={sentX + barW + GAP} y={baseline - ph} width={barW} height={ph} />}
                    {labelled.includes(i) && <text data-xlabel x={cx} y={baseline + 16} textAnchor="middle" className="fill-[var(--color-muted-foreground)] text-xs">{weekShort(w.weekStart)}</text>}
                    {i === weeks.length - 1 && <text data-xlabel x={cx} y={baseline + 30} textAnchor="middle" className="fill-[var(--color-muted-foreground)] text-xs">so far</text>}
                  </g>
                )
              })}
            </svg>
            {readout && shown !== null && (
              <ChartReadout ref={readoutRef} header={readout.header} className="rf-readout" left={Math.max(readoutLeft(LEFT + slot * (shown + 0.5), W, readoutSize.w, narrow), LEFT)} top={Math.min(M.top, H - readoutSize.h)}>
                {readout.empty ? <p className="text-xs">Nothing sent or paid</p> : (
                  <>
                    <div className="flex items-center gap-2"><span aria-hidden="true" className="cp-sent it-hatch block h-3 w-3" /><span className="text-xs text-[var(--color-muted-foreground)]">Sent</span><span className="text-sm font-semibold tabular-nums">{readout.sent}</span></div>
                    <div className="flex items-center gap-2"><span aria-hidden="true" className="cp-paid block h-3 w-3" /><span className="text-xs text-[var(--color-muted-foreground)]">Paid</span><span className="text-sm font-semibold tabular-nums">{readout.paid}</span></div>
                    <p className="text-xs text-[var(--color-muted-foreground)]">{readout.rejected}</p>
                  </>
                )}
              </ChartReadout>
            )}
          </>
        )}
      </div>
      <AnnouncementRegion message={chart.message} />
      <ChartTable caption={tableCaption(data)} columns={TABLE_COLUMNS} rows={tableRows(data)} />
    </div>
  )
}
