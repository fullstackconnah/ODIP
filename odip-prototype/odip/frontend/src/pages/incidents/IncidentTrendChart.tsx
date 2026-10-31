import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { IncidentTrendDto } from '@/api/types'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { ChartReadout } from '@/components/chart/ChartReadout'
import { ChartTable } from '@/components/chart/ChartTable'
import { countTicks, readoutLeft } from '@/components/chart/ticks'
import { useChartPoints } from '@/components/chart/useChartPoints'
import { liveLine, monthShort, readoutRows, tableCaption, tableRows, TABLE_COLUMNS, TREND_LABEL } from './incidentTrend'

/** Below this plot width the readout sits on the side away from the month. */
export const NARROW = 480

const PLOT_H = 120
const M = { top: 8, bottom: 38 }
const H = M.top + PLOT_H + M.bottom
const GAP = 2

/** Six columns at every width: one stacked bar per month, restrictive practice uses on the baseline and the other incidents above (shape brief 2026-10-31). */
export function IncidentTrendChart({ data, width: W, sentenceId }: { data: IncidentTrendDto; width: number; sentenceId: string }) {
  const { months } = data
  const patId = useId()
  const readoutRef = useRef<HTMLDivElement>(null)
  const [readoutSize, setReadoutSize] = useState({ w: 160, h: 80 })
  const max = Math.max(...months.map(m => m.incidents), 1)
  const ticks = countTicks(max, PLOT_H)
  const top = ticks[ticks.length - 1]
  const left = top >= 1000 ? 40 : 28
  const slot = (W - left) / months.length
  const baseline = M.top + PLOT_H
  const yOf = (v: number) => baseline - (v / top) * PLOT_H

  const chart = useChartPoints({
    count: months.length,
    restIndex: months.length - 1,
    nearest: e => {
      const box = plotProps.ref.current?.getBoundingClientRect()
      return box ? Math.min(Math.max(Math.floor((e.clientX - box.left - left) / slot), 0), months.length - 1) : 0
    },
    label: TREND_LABEL,
    sentenceId,
    describe: i => liveLine(data, i),
  })
  const { shown, plotProps } = chart

  useLayoutEffect(() => {
    const el = readoutRef.current
    if (el) setReadoutSize({ w: el.offsetWidth, h: el.offsetHeight })
  }, [shown, W])

  const readout = shown === null ? null : readoutRows(data, shown)

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
                  <line className="bt-grid" x1={left} x2={W} y1={Math.round(yOf(v)) + 0.5} y2={Math.round(yOf(v)) + 0.5} />
                  <text x={left - 6} y={yOf(v) + 4} textAnchor="end" className="fill-[var(--color-muted-foreground)] text-xs tabular-nums">{v.toLocaleString('en-AU')}</text>
                </g>
              ))}
              {months.map((m, i) => {
                const cx = left + slot * (i + 0.5)
                const barW = Math.min(Math.max(Math.round(slot * 0.5), 16), 48)
                const rh = m.rpUses > 0 ? Math.max(2, (m.rpUses / top) * PLOT_H) : 0
                const oh = m.otherIncidents > 0 ? Math.max(5.5, (m.otherIncidents / top) * PLOT_H) : 0
                const current = i === months.length - 1
                return (
                  <g key={m.month} data-trend-month={m.month}>
                    <rect x={left + slot * i} y={M.top} width={slot} height={PLOT_H} fill="transparent" />
                    {shown === i && <rect className="rf-wash" x={left + slot * i} y={M.top} width={slot} height={PLOT_H} />}
                    {rh > 0 && <rect data-bar="rp" className="it-rp" x={cx - barW / 2} y={baseline - rh} width={barW} height={rh} />}
                    {oh > 0 && (
                      <rect data-bar="other" className="it-other" fill={`url(#${patId})`} x={cx - barW / 2 + 0.75} y={baseline - rh - (rh > 0 ? GAP : 0) - oh + 0.75} width={barW - 1.5} height={oh - 1.5} />
                    )}
                    {m.incidents === 0 && <text data-zero x={cx} y={baseline - 4} textAnchor="middle" className="fill-[var(--color-muted-foreground)] text-xs">0</text>}
                    <text data-xlabel x={cx} y={baseline + 16} textAnchor="middle" className="fill-[var(--color-muted-foreground)] text-xs">{monthShort(m.month)}</text>
                    {current && <text data-xlabel x={cx} y={baseline + 30} textAnchor="middle" className="fill-[var(--color-muted-foreground)] text-xs">so far</text>}
                  </g>
                )
              })}
            </svg>
            {readout && shown !== null && (
              <ChartReadout ref={readoutRef} header={readout.header} className="rf-readout" left={Math.max(readoutLeft(left + slot * (shown + 0.5), W, readoutSize.w, W < NARROW), left)} top={Math.min(M.top, H - readoutSize.h)}>
                {readout.empty ? <p className="text-xs">No incidents</p> : (
                  <>
                    <div className="flex items-center gap-2"><span aria-hidden="true" className="it-rp block h-3 w-3" /><span className="text-sm font-semibold tabular-nums">{readout.rp}</span><span className="text-xs text-[var(--color-muted-foreground)]">{readout.rpText}</span></div>
                    <div className="flex items-center gap-2"><span aria-hidden="true" className="it-other it-hatch block h-3 w-3" /><span className="text-sm font-semibold tabular-nums">{readout.other}</span><span className="text-xs text-[var(--color-muted-foreground)]">{readout.otherText}</span></div>
                    <p className="text-xs text-[var(--color-muted-foreground)]">{readout.last}</p>
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
