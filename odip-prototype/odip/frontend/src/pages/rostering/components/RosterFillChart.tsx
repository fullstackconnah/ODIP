import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { RosterFillDto } from '@/api/types'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { ChartReadout, readoutLeft } from '@/components/chart/ChartReadout'
import { ChartTable } from '@/components/chart/ChartTable'
import { countTicks } from '@/components/chart/ticks'
import { useChartPoints } from '@/components/chart/useChartPoints'
import { detailLine, liveLine, movedLine, plotLabel, readoutRows, tableCaption, tableRows, TABLE_COLUMNS, weekLabel, yearBreakIndex } from '../lib/rosterFill'

/** Below this card width the weeks are rows (44px touch rows); at or above it, columns. */
export const COLUMNS_MIN = 480

const PLOT_H = 120
const M = { top: 8, right: 0, left: 28 }
const FILLED_GAP = 2

const coarse = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

type Props = {
  data: RosterFillDto
  /** The Monday the board is showing (the page's weekStart). */
  boardWeek: string | undefined
  /** The measured card width; 0 before the first measure. */
  width: number
  /** Show this week on the board (the page's moveToWeek: the leave-without-publishing guard asks as it does for Prev/Next). */
  onSelectWeek: (weekStart: string) => void
  sentenceId: string
}

export function RosterFillChart({ data, boardWeek, width: W, onSelectWeek, sentenceId }: Props) {
  const { today, weeks } = data
  const columns = W >= COLUMNS_MIN
  const patId = useId()
  const readoutRef = useRef<HTMLDivElement>(null)
  const [readoutW, setReadoutW] = useState(160)
  const [moved, setMoved] = useState<string | null>(null)
  const boardIdx = weeks.findIndex(w => w.weekStart === boardWeek)
  const touch = coarse()
  const slot = (W - M.left) / weeks.length
  const yearAt = yearBreakIndex(weeks)
  const bottom = yearAt >= 0 && columns ? 38 : 24
  const H = M.top + PLOT_H + bottom
  const max = Math.max(...weeks.map(w => w.shifts), 1)
  const ticks = countTicks(max, PLOT_H)
  const top = ticks[ticks.length - 1]
  const baseline = M.top + PLOT_H
  const yOf = (v: number) => baseline - (v / top) * PLOT_H

  const chart = useChartPoints({
    count: weeks.length,
    restIndex: boardIdx >= 0 ? boardIdx : 0,
    nearest: e => {
      const box = plotEl()?.getBoundingClientRect()
      if (!box) return 0
      if (columns) return Math.min(Math.max(Math.floor((e.clientX - box.left - M.left) / slot), 0), weeks.length - 1)
      const rows = [...(plotEl()?.querySelectorAll('[data-fill-row]') ?? [])]
      const hit = rows.findIndex(r => e.clientY < r.getBoundingClientRect().bottom)
      return hit === -1 ? weeks.length - 1 : hit
    },
    onCommit: i => { setMoved(movedLine(weeks[i].weekStart, today)); onSelectWeek(weeks[i].weekStart) },
    label: plotLabel(weeks.length),
    sentenceId,
    describe: i => liveLine(weeks[i], { today, boardWeek }),
  })
  const { shown, plotProps } = chart
  const plotEl = () => plotProps.ref.current
  const [lastMessage, setLastMessage] = useState(chart.message)
  if (chart.message !== lastMessage) { setLastMessage(chart.message); setMoved(null) }

  useLayoutEffect(() => {
    const w = readoutRef.current?.offsetWidth
    if (w) setReadoutW(w)
  }, [shown, W])

  const opts = { today, boardWeek, touch }
  const readout = shown === null ? null : readoutRows(weeks[shown], opts)
  const detailWeek = shown !== null ? weeks[shown] : boardIdx >= 0 ? weeks[boardIdx] : undefined

  return (
    <div>
      <div {...plotProps} data-plot className="rf-plot relative cursor-pointer">
        {columns && W > 0 && (
          <>
            <svg width={W} height={H} aria-hidden="true" className="block">
              <defs>
                <pattern id={patId} patternUnits="userSpaceOnUse" width={4} height={4} patternTransform="rotate(45)">
                  <line x1={0} y1={0} x2={0} y2={4} strokeWidth={1} style={{ stroke: 'var(--color-chart-open)' }} />
                </pattern>
              </defs>
              {ticks.map(v => (
                <g key={v} data-ytick={v}>
                  <line className="stroke-[var(--color-chart-grid)]" strokeWidth={1} x1={M.left} x2={W} y1={Math.round(yOf(v)) + 0.5} y2={Math.round(yOf(v)) + 0.5} />
                  <text x={22} y={yOf(v) + 4} textAnchor="end" className="fill-[var(--color-muted-foreground)] text-xs tabular-nums">{v}</text>
                </g>
              ))}
              {weeks.map((w, i) => {
                const cx = M.left + slot * (i + 0.5)
                const barW = Math.min(Math.max(Math.round(slot * 0.5), 16), 48)
                const onBoard = w.weekStart === boardWeek
                const fh = w.filled > 0 ? Math.max(2, (w.filled / top) * PLOT_H) : 0
                const oh = w.open > 0 ? Math.max(5.5, (w.open / top) * PLOT_H) : 0
                return (
                  <g key={w.weekStart}>
                    <rect data-fill-week={w.weekStart} data-on-board={onBoard || undefined} x={M.left + slot * i} y={M.top} width={slot} height={PLOT_H} fill="transparent" />
                    {shown === i && <rect className="rf-wash" x={M.left + slot * i} y={M.top} width={slot} height={PLOT_H} />}
                    {fh > 0 && <rect data-bar="filled" className="rf-filled" x={cx - barW / 2} y={baseline - fh} width={barW} height={fh} />}
                    {oh > 0 && (
                      <rect data-bar="open" className="rf-open" fill={`url(#${patId})`} x={cx - barW / 2 + 0.75} y={baseline - fh - (fh > 0 ? FILLED_GAP : 0) - oh + 0.75} width={barW - 1.5} height={oh - 1.5} />
                    )}
                    <text data-xlabel x={cx} y={baseline + 16} textAnchor="middle" className={`text-xs ${onBoard ? 'fill-[var(--color-foreground)] font-semibold' : 'fill-[var(--color-muted-foreground)]'}`}>{weekLabel(w.weekStart)}</text>
                    {yearAt >= 0 && i === yearAt && <text data-xlabel x={cx} y={baseline + 30} textAnchor="middle" className="fill-[var(--color-muted-foreground)] text-xs">{w.weekStart.slice(0, 4)}</text>}
                    {onBoard && <rect data-marker className="rf-marker" x={cx - barW / 2} y={H - 2} width={barW} height={2} />}
                  </g>
                )
              })}
            </svg>
            {weeks.map((w, i) => w.shifts === 0 && (
              <div key={w.weekStart} data-fill-empty className="pointer-events-none absolute flex items-end justify-center pb-2 text-center text-xs leading-tight text-[var(--color-muted-foreground)]" style={{ left: M.left + slot * i, top: M.top, width: slot, height: PLOT_H }}>
                Not rostered yet
              </div>
            ))}
            {readout && shown !== null && (
              <ChartReadout ref={readoutRef} header={readout.header} className="rf-readout" left={readoutLeft(M.left + slot * (shown + 0.5), W, readoutW, false)} top={M.top}>
                {readout.empty ? <p className="text-sm text-[var(--color-muted-foreground)]">Not rostered yet</p> : (
                  <>
                    <div className="flex items-center gap-2"><span aria-hidden="true" className="rf-filled block h-3 w-3" /><span className="text-sm font-semibold tabular-nums">{readout.filled}</span><span className="text-xs text-[var(--color-muted-foreground)]">filled</span></div>
                    <div className="flex items-center gap-2"><span aria-hidden="true" className="rf-open rf-hatch block h-3 w-3" /><span className="text-sm font-semibold tabular-nums">{readout.open}</span><span className="text-xs text-[var(--color-muted-foreground)]">open</span></div>
                    <p className="text-xs text-[var(--color-muted-foreground)]">{readout.hours}</p>
                    {readout.draft && <p className="text-xs text-[var(--color-muted-foreground)]">{readout.draft}</p>}
                  </>
                )}
                <p className="text-xs">{readout.last}</p>
              </ChartReadout>
            )}
          </>
        )}
        {!columns && W > 0 && (
          <div aria-hidden="true">
            {weeks.map((w, i) => {
              const onBoard = w.weekStart === boardWeek
              return (
                <div key={w.weekStart} data-fill-row={w.weekStart} data-on-board={onBoard || undefined} className="relative grid min-h-[max(32px,var(--tap-min))] grid-cols-[3.25rem_minmax(0,1fr)_4.5rem] items-center gap-x-2">
                  {shown === i && <span className="rf-wash absolute inset-0" />}
                  {onBoard && <span data-marker className="rf-marker absolute bottom-2 left-0 top-2 w-0.5" />}
                  <span data-xlabel className={`relative pl-2 text-xs ${onBoard ? 'font-semibold text-[var(--color-foreground)]' : 'text-[var(--color-muted-foreground)]'}`}>
                    {weekLabel(w.weekStart)}
                    {yearAt >= 0 && i === yearAt && <span className="block font-normal text-[var(--color-muted-foreground)]">{w.weekStart.slice(0, 4)}</span>}
                  </span>
                  {w.shifts === 0 ? (
                    <span data-fill-empty className="relative col-span-2 text-xs text-[var(--color-muted-foreground)]">Not rostered yet</span>
                  ) : (
                    <>
                      <span className="relative block h-3">
                        <span className="flex h-3 gap-0.5" style={{ width: `${(w.shifts / max) * 100}%` }}>
                          {w.filled > 0 && <span data-bar="filled" className="rf-filled block h-3 min-w-0.5" style={{ flexGrow: w.filled, flexBasis: 0 }} />}
                          {w.open > 0 && <span data-bar="open" className="rf-open rf-hatch block h-3 min-w-1" style={{ flexGrow: w.open, flexBasis: 0 }} />}
                        </span>
                      </span>
                      <span className="relative text-right text-xs tabular-nums text-[var(--color-foreground)]">{w.filled} of {w.shifts}</span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {!columns && W > 0 && <p data-detail className="mt-2 min-h-10 text-[13px] text-[var(--color-muted-foreground)]">{detailLine(detailWeek, opts)}</p>}
      <AnnouncementRegion message={moved ?? chart.message} />
      <ChartTable caption={tableCaption(weeks, today)} columns={TABLE_COLUMNS} rows={tableRows(data, boardWeek)} />
    </div>
  )
}
