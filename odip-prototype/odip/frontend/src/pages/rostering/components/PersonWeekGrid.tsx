import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { LeaveBarDto, ShiftDto, TripBarDto } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'
import { useMeasuredWidth } from '@/hooks/useMeasuredWidth'
import { formatShiftTime } from '@/lib/utils'
import { barOverlapsWeek, formatDayAccessibleName, formatDayHeader, formatShiftTimeRange, isToday } from '../lib/roster'
import { DAY_PX, PX_PER_MIN, laneCap, openingScrollTop, packDay, weekSegments, type Segment } from '../lib/weekGrid'
import { ShiftBlock } from './ShiftBlock'

export type Bar = { key: string; trip?: TripBarDto; leave?: LeaveBarDto; start: string; end: string }

export type PersonWeekGridProps = {
  kind: 'staff' | 'participant'
  personId: string
  weekStart: string
  days: string[]
  shifts: ShiftDto[]
  /** [] when the previous week's read is not usable. */
  prevWeekShifts: ShiftDto[]
  bars: Bar[]
  renderBar: (b: Bar, barDays: string[], fullWidth?: boolean) => ReactNode
  /** The section's measured width: under DAY_VIEW_BELOW it is the one-day view. */
  width: number | undefined
  /** False while the week on screen is placeholder data. */
  ready: boolean
  canWrite: boolean
  DayHeading: 'h3' | 'h4' | 'h5'
  onOpen: (shift: ShiftDto) => void
  /** The grid has already focused the scroller, so the panel returns focus there. */
  onAddAt: (date: string, minute: number) => void
}

/** SHAPE §2: the week needs 89 px a column, which is 672 px of section. */
export const DAY_VIEW_BELOW = 672
const GUTTER_PX = 48
const HEADER_BG_TODAY = 'bg-[color-mix(in_srgb,var(--color-primary)_6%,var(--color-surface-container-low))]'
const LINES =
  'repeating-linear-gradient(to bottom, var(--color-border) 0, var(--color-border) 1px, transparent 1px, transparent 24px, color-mix(in srgb, var(--color-border) 45%, transparent) 24px, color-mix(in srgb, var(--color-border) 45%, transparent) 25px, transparent 25px, transparent 48px)'
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`

function useCoarsePointer(): boolean {
  const query = () => (typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null)
  const [coarse, setCoarse] = useState(() => query()?.matches ?? false)
  useEffect(() => {
    const mq = query()
    if (!mq) return
    const on = () => setCoarse(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return coarse
}

/** The block's lane in CSS: 2 px in from the left, 4 px from the right, 2 px between lanes. */
function laneStyle(lane: number, lanes: number, top: number, height: number) {
  return { top, height, left: `calc(2px + (100% - 4px) * ${lane} / ${lanes})`, width: `calc((100% - 4px) / ${lanes} - 2px)` }
}

export function PersonWeekGrid({ kind, personId, weekStart, days, shifts, prevWeekShifts, bars, renderBar, width, ready, canWrite, DayHeading, onOpen, onAddAt }: PersonWeekGridProps) {
  const idBase = useId()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const coarse = useCoarsePointer()
  const inner = useMeasuredWidth(scrollerRef)
  const dayView = width !== undefined && width > 0 && width < DAY_VIEW_BELOW
  const [picked, setPicked] = useState<{ week: string; day: string } | null>(null)
  const day = picked?.week === weekStart ? picked.day : (days.find(isToday) ?? days[0])
  const shownDays = dayView ? [day] : days
  const floorPx = coarse ? 44 : 24

  const segments = useMemo(() => weekSegments(shifts, prevWeekShifts, days), [shifts, prevWeekShifts, days])
  // The scroller's own clientWidth, borders and a classic scrollbar already out; the section's width stands in until it is measured.
  const bodyWidth = inner || (dayView ? (width ?? 390) - 2 : (width || 1000) - 2)
  const colWidth = dayView ? bodyWidth - GUTTER_PX : (bodyWidth - GUTTER_PX) / 7

  const scrolledFor = useRef<string | null>(null)
  useLayoutEffect(() => {
    const key = `${personId}|${weekStart}`
    // width undefined: a cached week mounts before useMeasuredWidth has run, so a phone would get the week view's target.
    if (!ready || width === undefined || scrolledFor.current === key || !scrollerRef.current) return
    scrollerRef.current.scrollTop = openingScrollTop(shifts, days, dayView ? day : undefined)
    scrolledFor.current = key
  }, [ready, width, personId, weekStart, shifts, days, dayView, day])

  const labelOf = (s: ShiftDto) => (kind === 'staff' ? s.participantName : (s.staffName ?? 'Needs staff'))
  const idOfDay = (d: string, part: string) => `${idBase}-${part}-${d}`

  function addAt(date: string, e: React.MouseEvent<HTMLElement>) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-minute]')
    if (!el) return
    scrollerRef.current?.focus({ preventScroll: true })
    onAddAt(date, Number(el.dataset.minute))
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const to = e.key === 'ArrowRight' ? Math.min(6, i + 1) : e.key === 'ArrowLeft' ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? 6 : -1
    if (to < 0) return
    e.preventDefault()
    setPicked({ week: weekStart, day: days[to] })
    tabRefs.current[to]?.focus()
  }

  function column(date: string) {
    const segs = segments.filter(g => g.date === date)
    const { blocks, more } = packDay(segs, floorPx, laneCap(colWidth))
    const ordered = [...blocks].sort((a, b) => a.top - b.top || a.lane - b.lane)
    const headingId = dayView ? idOfDay(date, 'tab') : idOfDay(date, 'h')
    return (
      <div
        key={date}
        id={dayView ? idOfDay(date, 'col') : undefined}
        role={dayView ? 'tabpanel' : 'group'}
        aria-labelledby={headingId}
        data-day={date}
        className="relative border-l border-border"
        style={{ height: DAY_PX, backgroundImage: LINES }}
      >
        {canWrite && (
          <div aria-hidden="true" className="absolute inset-0 cursor-pointer" onClick={e => addAt(date, e)}>
            {HOURS.map(h => (
              <div key={h} data-minute={h * 60} className="h-12 active:bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)]">
                {[0, 30].map(m => (
                  <div
                    key={m}
                    data-minute={h * 60 + m}
                    className="group/half h-6 px-1.5 text-xs font-medium leading-6 text-primary pointer-coarse:pointer-events-none hover:bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)] hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-primary)_40%,transparent)]"
                  >
                    <span className="hidden group-hover/half:inline pointer-coarse:hidden">{colWidth >= 72 ? `+ ${formatShiftTime(hhmm(h * 60 + m))}` : '+'}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {ordered.map(b => (
          // Both segments of an overnight shift share data-shift-open; the key tells them apart.
          <ShiftBlock
            key={`${b.seg.shift.id}:${b.seg.part}`}
            seg={b.seg}
            context={kind}
            style={{ ...laneStyle(b.lane, b.lanes, b.top, b.height), zIndex: 10 }}
            heightPx={b.height}
            laneWidthPx={(colWidth - 4) / b.lanes - 2}
            onOpen={onOpen}
          />
        ))}
        {more.map(t => {
          const first = t.hidden[0]
          const keyOf = (g: Segment) => `${g.shift.id}:${g.part}`
          return (
            <div key={`more-${t.top}`} className="absolute z-10 flex [&>div]:flex-1" style={laneStyle(t.lane, t.lanes, t.top, t.height)}>
              <Dropdown
                variant="icon"
                icon={<span>+{t.hidden.length}</span>}
                label={`${t.hidden.length} more shifts from ${formatShiftTime(first.shift.startTime)}`}
                triggerClassName="flex flex-1 items-center justify-center h-full w-full rounded-sm bg-surface-container-high text-xs font-semibold tabular-nums focus-visible:ring-2 focus-visible:ring-ring"
                items={t.hidden.map(g => ({
                  value: keyOf(g),
                  label: `${formatShiftTimeRange(g.shift.startTime, g.shift.endTime)}, ${labelOf(g.shift)}${g.shift.status === 'Draft' ? ', Draft' : g.shift.status === 'Cancelled' ? ', Cancelled' : ''}`,
                }))}
                onSelect={v => onOpen(t.hidden.find(g => keyOf(g) === v)!.shift)}
              />
            </div>
          )
        })}
      </div>
    )
  }

  const template = dayView ? 'grid-cols-[3rem_minmax(0,1fr)]' : 'grid-cols-[3rem_repeat(7,minmax(0,1fr))]'
  const dayBars = bars.filter(b => barOverlapsWeek(b.start, b.end, [day]))

  return (
    <div>
      {dayView && (
        <>
          <div role="tablist" aria-label="Day" className="mb-2 grid grid-cols-7">
            {days.map((d, i) => {
              const { weekday, day: num } = formatDayHeader(d)
              const count = segments.filter(g => g.date === d).length
              const selected = d === day
              const today = isToday(d)
              return (
                <button
                  key={d}
                  ref={el => { tabRefs.current[i] = el }}
                  id={idOfDay(d, 'tab')}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={idOfDay(d, 'col')}
                  aria-current={today ? 'date' : undefined}
                  aria-label={`${formatDayAccessibleName(d)}, ${count === 0 ? 'no shifts' : count === 1 ? '1 shift' : `${count} shifts`}${today ? ', today' : ''}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setPicked({ week: weekStart, day: d })}
                  onKeyDown={e => onTabKey(e, i)}
                  className={`relative flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-md hover:bg-accent active:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${today && !selected ? HEADER_BG_TODAY : ''}`}
                >
                  {selected && <span aria-hidden="true" className="absolute inset-0.5 rounded-md bg-[var(--color-primary-fixed)]" />}
                  <span className={`relative text-xs ${selected ? 'text-[var(--color-on-primary-fixed)]' : 'text-muted-foreground'}`}>{weekday}</span>
                  <span className={`relative text-[15px] font-semibold tabular-nums ${selected ? 'text-[var(--color-on-primary-fixed)]' : today ? 'text-primary' : 'text-foreground'}`}>{num}</span>
                  <span aria-hidden="true" className={`relative h-1 w-1 rounded-full ${count === 0 ? '' : selected ? 'bg-[var(--color-on-primary-fixed)]' : 'bg-muted-foreground'}`} />
                </button>
              )
            })}
          </div>
          {dayBars.length > 0 && (
            <div className="mb-2 grid w-full grid-cols-1 gap-y-0.5">
              {dayBars.map(b => <div key={b.key} className="contents">{renderBar(b, [day], true)}</div>)}
            </div>
          )}
        </>
      )}
      <div className="overflow-hidden rounded-md border border-border">
        <div
          ref={scrollerRef}
          role="region"
          aria-label={dayView ? `Shifts on ${formatDayAccessibleName(day)}` : 'Shifts by hour'}
          tabIndex={0}
          className="scroll-pt-12 overflow-y-auto bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          style={{ height: 'min(70dvh, 40rem)', minHeight: '20rem' }}
        >
          {!dayView && (
            <div className="sticky top-0 z-30 border-b border-border bg-surface-container-low">
              <div className={`grid ${template}`}>
                <div />
                {days.map(d => {
                  const { weekday, day: num } = formatDayHeader(d)
                  const today = isToday(d)
                  return (
                    <DayHeading
                      key={d}
                      id={idOfDay(d, 'h')}
                      aria-current={today ? 'date' : undefined}
                      className={`flex h-[var(--table-head-h,2rem)] items-baseline justify-center gap-1.5 border-l border-border px-1 py-1 ${today ? HEADER_BG_TODAY : 'bg-surface-container-low'}`}
                    >
                      <span aria-hidden="true" className="text-sm font-semibold leading-5 text-foreground">{weekday}</span>
                      <span aria-hidden="true" className="text-[13px] tabular-nums text-muted-foreground">{num}</span>
                      <span className="sr-only">{formatDayAccessibleName(d)}{today ? ', today' : ''}</span>
                    </DayHeading>
                  )
                })}
              </div>
              {bars.length > 0 && (
                <div className="grid grid-cols-[3rem_minmax(0,1fr)] border-t border-border">
                  <div />
                  <ul aria-label="Leave and trips" className="grid grid-cols-7 gap-y-0.5 py-1">
                    {/* `contents`, so each bar is the grid item and places itself across its days, as on the board. */}
                    {bars.map(b => <li key={b.key} className="contents">{renderBar(b, days)}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
          <div className={`relative grid ${template}`} style={{ height: DAY_PX }}>
            <div aria-hidden="true" className="relative">
              {HOURS.slice(1).map(h => (
                <span key={h} className="absolute right-1.5 -translate-y-1/2 text-xs tabular-nums text-muted-foreground" style={{ top: h * 60 * PX_PER_MIN }}>
                  {formatShiftTime(`${pad(h)}:00`)}
                </span>
              ))}
            </div>
            {shownDays.map(column)}
          </div>
        </div>
      </div>
    </div>
  )
}
