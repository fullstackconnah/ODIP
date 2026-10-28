import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import type { BudgetSeries } from '@/api/types'
import { money } from '@/lib/budgetLedger'
import { budgetTrackFootnotes, budgetTrackSentence, chartHeight, compactAud, expectedDrawn, liveLine, readoutHeader, readoutRows, xTicks, yTicks } from '@/lib/budgetTrack'
import { writtenDay, writtenSpan } from '@/lib/fundingPlan'
import { AnnouncementRegion } from './AnnouncementRegion'
import { Card } from './Card'
import { SelectField } from './SelectField'
import { ToggleGroup } from './ToggleGroup'

// The budget graph (Funding tab): the whole plan's or one pool's weekly budget, used, booked-ahead and expected lines, hand-drawn in SVG at the card's own width so text stays 12px. The server
// sends every figure; this only places them. Strokes are .bt-* classes (index.css), so forced colours can re-point them. DESIGN.md "Chart series" and the shape brief set every value here.

export const BUDGET_TRACK_TITLE = 'How the budget is tracking'
/** Below this card width the switch is a select on its own row and the readout sits in the plot's top band. */
const NARROW = 480
const M = { top: 20, right: 12, bottom: 28, left: 48 }
const DAY = 86_400_000
/** Calendar dates, never `new Date(iso)`, so every zone draws the same x. */
const dayOf = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY
const r1 = (n: number) => Math.round(n * 10) / 10

type Line = 'budget' | 'used' | 'booked' | 'expected'
const LEGEND: Record<Line, string> = { budget: 'Budget, spread evenly', used: 'Used', booked: 'Booked ahead', expected: 'Expected from the agreement (estimate)' }

/** The element's content width, kept current with a ResizeObserver; undefined until measured. */
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>): number | undefined {
  const [width, setWidth] = useState<number>()
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/** A series' line key: the mark's own class, so its colour, width and dash are the line's. */
function LineKey({ line, width = 24 }: { line: Line; width?: number }) {
  return (
    <svg width={width} height={8} aria-hidden="true" className="shrink-0">
      <line x1={1} x2={width - 1} y1={4} y2={4} className={`bt-${line}`} />
    </svg>
  )
}

function Cell({ value }: { value: number | undefined }) {
  return value === undefined
    ? <td><span aria-hidden="true">—</span><span className="sr-only">none</span></td>
    : <td>{money(value)}</td>
}

export function BudgetTrackChart({ series, width }: { series: BudgetSeries; width?: number }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLDivElement>(null)
  const pointerFocus = useRef(false)
  const measured = useMeasuredWidth(boxRef)
  const sentenceId = useId()
  const [key, setKey] = useState('plan')
  const [active, setActive] = useState<number | null>(null)
  const [hidden, setHidden] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [message, setMessage] = useState('')
  const [readoutW, setReadoutW] = useState(200)

  const W = width ?? measured ?? 0
  const scope = series.scopes.find(s => s.scopeKey === key) ?? series.scopes[0]
  const { points } = scope
  const stops = points.filter(p => !p.isEdge)   // edge points only shape the expected line; nothing interactive lands on them
  const planStart = series.planStart ?? points[0].date
  const planEnd = series.planEnd ?? points[points.length - 1].date
  const current = series.planIsCurrent
  const showBooked = current && scope.summary.bookedEnd !== undefined
  const showExpected = expectedDrawn(series, scope)
  const todayIndex = current ? stops.findIndex(p => p.date === series.today) : -1
  const restIndex = todayIndex >= 0 ? todayIndex : stops.length - 1
  const shown = active !== null && !hidden && active < stops.length ? active : null

  // A tap's readout stays until a tap outside the plot, or the plot scrolls out of view.
  useEffect(() => {
    if (!pinned) return
    const el = plotRef.current
    const clear = () => { setActive(null); setPinned(false) }
    const onDown = (e: Event) => { if (!el?.contains(e.target as Node)) clear() }
    document.addEventListener('pointerdown', onDown)
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) clear() })
    if (el) observer?.observe(el)
    return () => { document.removeEventListener('pointerdown', onDown); observer?.disconnect() }
  }, [pinned])

  useLayoutEffect(() => {
    const w = readoutRef.current?.offsetWidth
    if (w) setReadoutW(w)
  }, [shown, key])

  const H = chartHeight(W)
  const plotW = Math.max(W - M.left - M.right, 0)
  const plotH = H - M.top - M.bottom
  const span = Math.max(dayOf(planEnd) - dayOf(planStart), 1)
  const x = (iso: string) => M.left + ((dayOf(iso) - dayOf(planStart)) / span) * plotW
  const max = Math.max(scope.limit, ...points.flatMap(p => [p.budget, p.used ?? 0, p.usedAndBooked ?? 0, p.expected ?? 0]))
  const ticks = yTicks(max, plotH)
  const top = ticks[ticks.length - 1]
  const y = (v: number) => M.top + plotH - (v / top) * plotH
  const baseline = M.top + plotH
  const pathOf = (pts: Array<[string, number]>) => pts.map(([d, v], i) => `${i ? 'L' : 'M'}${r1(x(d))},${r1(y(v))}`).join('')

  const used = points.filter(p => p.used !== undefined).map(p => [p.date, p.used!] as [string, number])
  const booked = points.filter(p => p.usedAndBooked !== undefined).map(p => [p.date, p.usedAndBooked!] as [string, number])
  const expectedRuns: Array<Array<[string, number]>> = []
  points.forEach((p, i) => {
    if (p.expected === undefined) return
    if (i === 0 || points[i - 1].expected === undefined) expectedRuns.push([])
    expectedRuns[expectedRuns.length - 1].push([p.date, p.expected])
  })
  const labelPoint = current ? points.find(p => p.date === series.today && p.used !== undefined) : points.filter(p => p.used !== undefined).at(-1)
  const legend: Line[] = ['budget', 'used', ...(showBooked ? ['booked' as const] : []), ...(showExpected ? ['expected' as const] : [])]

  const options = series.scopes.map(s => ({ key: s.scopeKey, label: s.scopeKey === 'plan' ? 'Whole plan' : s.name }))
  const choose = (next: string) => { setKey(next); setActive(null); setPinned(false) }

  const move = (i: number) => {
    setActive(i)
    setHidden(false)
    setMessage(liveLine(stops, i, series))
  }
  const nearest = (clientX: number) => {
    const px = clientX - plotRef.current!.getBoundingClientRect().left
    let best = 0
    stops.forEach((p, i) => { if (Math.abs(x(p.date) - px) < Math.abs(x(stops[best].date) - px)) best = i })
    return best
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      if (shown !== null) { e.preventDefault(); e.stopPropagation(); setHidden(true) }
      return
    }
    const from = active ?? restIndex
    const steps: Record<string, number> = { ArrowRight: from + 1, ArrowLeft: from - 1, PageDown: from + 4, PageUp: from - 4, Home: 0, End: stops.length - 1 }
    if (!(e.key in steps)) return
    e.preventDefault()
    move(Math.min(Math.max(steps[e.key], 0), stops.length - 1))
  }
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    pointerFocus.current = true
    setActive(nearest(e.clientX))
    setHidden(false)
    if (e.pointerType === 'touch') setPinned(true)
  }

  let readoutLeft = 0
  if (shown !== null) {
    const cx = x(stops[shown].date)
    if (W < NARROW) readoutLeft = cx > W / 2 ? 0 : W - readoutW
    else readoutLeft = cx + 12 + readoutW <= W ? cx + 12 : cx - 12 - readoutW
    readoutLeft = Math.min(Math.max(readoutLeft, 0), Math.max(W - readoutW, 0))
  }
  const readout = shown === null ? null : readoutRows(stops, shown, series)
  const at = shown === null ? null : stops[shown]
  const dots = at === null ? [] : ([
    ['budget', at.budget],
    ...(showExpected && at.expected !== undefined ? [['expected', at.expected]] : []),
    at.used !== undefined ? ['used', at.used] : showBooked && at.usedAndBooked !== undefined ? ['booked', at.usedAndBooked] : null,
  ].filter(Boolean) as Array<[Line, number]>)

  return (
    <Card>
      <div ref={boxRef}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h3 className="text-sm font-semibold">{BUDGET_TRACK_TITLE}</h3>
          {series.scopes.length > 2 && (options.length <= 3 && W >= NARROW
            ? <ToggleGroup options={options} value={scope.scopeKey} onChange={choose} ariaLabel="Show the budget for" />
            : <SelectField label="Show" options={options.map(o => ({ value: o.key, label: o.label }))} value={scope.scopeKey} onChange={e => choose(e.target.value)} className={W < NARROW ? 'w-full' : 'min-w-48'} />)}
        </div>
        <p id={sentenceId} className="mt-2 max-w-prose text-sm text-[var(--color-foreground)]">{budgetTrackSentence(series, scope)}</p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {legend.map(line => (
            <li key={line} data-legend={line} className="flex items-center gap-1.5 text-[13px] text-[var(--color-muted-foreground)]">
              <LineKey line={line} />
              {LEGEND[line]}
            </li>
          ))}
        </ul>
        <div
          ref={plotRef}
          data-plot
          className="bt-plot relative mt-2"
          tabIndex={0}
          role="group"
          aria-roledescription="chart"
          aria-label={`Weekly budget chart for ${scope.name}`}
          aria-describedby={sentenceId}
          onKeyDown={onKeyDown}
          onFocus={() => { if (!pointerFocus.current) move(active ?? restIndex); pointerFocus.current = false }}
          onBlur={() => { setActive(null); setPinned(false) }}
          onPointerDown={onPointerDown}
          onPointerMove={e => { setActive(nearest(e.clientX)); setHidden(false) }}
          onPointerLeave={e => { if (e.pointerType !== 'touch') setActive(null) }}
        >
          {W > 0 && (
            <svg width={W} height={H} aria-hidden="true" className="block">
              {ticks.map(v => (
                <g key={v} data-ytick={v}>
                  <line className="bt-grid" x1={M.left} x2={W - M.right} y1={r1(y(v))} y2={r1(y(v))} />
                  <text x={40} y={y(v) + 4} textAnchor="end" className="fill-[var(--color-muted-foreground)] text-xs tabular-nums">{compactAud(v)}</text>
                </g>
              ))}
              {xTicks(planStart, planEnd, plotW).map(t => (
                <g key={t.date}>
                  <line className="bt-grid" x1={r1(x(t.date))} x2={r1(x(t.date))} y1={baseline} y2={baseline + 4} />
                  <text x={x(t.date)} y={baseline + 18} textAnchor={x(t.date) + 28 > W ? 'end' : 'middle'} className="fill-[var(--color-muted-foreground)] text-xs">{t.label}</text>
                </g>
              ))}
              <path data-series="budget" className="bt-budget" d={pathOf([[planStart, 0], [planEnd, scope.limit]])} />
              {showExpected && <path data-series="expected" className="bt-expected" d={expectedRuns.map(pathOf).join('')} />}
              {showExpected && series.expected.revisionChanges.map(change => {
                const p = points.find(q => q.date >= change && q.expected !== undefined)
                if (!p) return null
                const ty = y(p.expected!)
                return <line key={change} data-revision className="bt-tick" x1={r1(x(change))} x2={r1(x(change))} y1={r1(ty - 3)} y2={r1(ty + 3)} />
              })}
              {showBooked && booked.length > 0 && <path data-series="booked" className="bt-booked" d={pathOf(booked)} />}
              {used.length > 0 && <path data-series="used" className="bt-used" d={pathOf(used)} />}
              {current && (
                <g data-today>
                  <line className="bt-today" x1={r1(x(series.today))} x2={r1(x(series.today))} y1={M.top} y2={baseline} />
                  <text x={x(series.today)} y={M.top - 6} textAnchor="middle" className="fill-[var(--color-muted-foreground)] text-xs">Today</text>
                </g>
              )}
              {labelPoint && (() => {
                const lx = x(labelPoint.date)
                const ly = y(labelPoint.used!)
                const flip = lx - M.left < 120
                return (
                  <g>
                    <circle className="bt-dot" data-dot="used" cx={r1(lx)} cy={r1(ly)} r={4} />
                    <text x={flip ? lx + 8 : lx - 8} y={Math.max(ly - 8, M.top + 12)} textAnchor={flip ? 'start' : 'end'} className="fill-[var(--color-foreground)] text-xs tabular-nums">Used {money(labelPoint.used!)}</text>
                  </g>
                )
              })()}
              {at && (
                <g>
                  <line data-cross className="bt-cross" x1={r1(x(at.date))} x2={r1(x(at.date))} y1={M.top} y2={baseline} />
                  {dots.map(([line, v]) => <circle key={line} className="bt-dot" data-dot={line} cx={r1(x(at.date))} cy={r1(y(v))} r={4} />)}
                </g>
              )}
            </svg>
          )}
          {readout && at && (
            <div
              ref={readoutRef}
              data-readout
              className="bt-readout pointer-events-none absolute z-10 whitespace-nowrap rounded-[var(--radius-md)] bg-[var(--color-popover)] px-3 py-2 text-[var(--color-popover-foreground)] shadow-[var(--shadow-float)]"
              style={{ left: readoutLeft, top: W < NARROW ? 0 : M.top }}
            >
              <p data-readout-header className="text-xs text-[var(--color-muted-foreground)]">{readoutHeader(at, series)}</p>
              {readout.rows.map(row => (
                <div key={row.series} className="flex items-center gap-2">
                  <LineKey line={row.series} width={16} />
                  <span className="text-sm font-semibold tabular-nums">{row.value}</span>
                  <span className="text-xs text-[var(--color-muted-foreground)]">{row.label}</span>
                </div>
              ))}
              {readout.note && <p className="text-xs text-[var(--color-muted-foreground)]">{readout.note}</p>}
            </div>
          )}
        </div>
        <AnnouncementRegion message={message} />
        <table data-table className="sr-only">
          <caption>Weekly figures for {scope.name}, {writtenSpan(planStart, planEnd)}</caption>
          <thead>
            <tr><th scope="col">Week to</th><th scope="col">Budget, spread evenly</th><th scope="col">Used</th><th scope="col">Used and booked</th><th scope="col">Expected</th></tr>
          </thead>
          <tbody>
            {stops.map(p => (
              <tr key={p.date}>
                <th scope="row">{writtenDay(p.date)}</th>
                <td>{money(p.budget)}</td>
                <Cell value={p.used} />
                <Cell value={p.usedAndBooked} />
                <Cell value={p.expected} />
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 space-y-1 empty:hidden">
          {budgetTrackFootnotes(series, scope).map(note => (
            <p key={note.text} className={`text-[13px] ${note.tone === 'warning' ? 'text-[var(--color-on-warning-container)]' : 'text-[var(--color-muted-foreground)]'}`}>{note.text}</p>
          ))}
        </div>
      </div>
    </Card>
  )
}
