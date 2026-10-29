import { useId, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, CalendarOff, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { RosterBoardDto } from '@/api/types'
import { useRosterPersonWeek } from '@/api/hooks'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import { TAP_FLOOR } from '@/components/tapArea'
import { useMeasuredWidth } from '@/hooks/useMeasuredWidth'
import { usePermissions } from '@/lib/permissions'
import { retryingAfterError } from '@/lib/queryPhase'
import { PersonWeekGrid, DAY_VIEW_BELOW, type Bar } from './PersonWeekGrid'
import { PersonWeekPanel } from './PersonWeekPanel'
import type { ShiftSlideOverTarget } from './ShiftSlideOver'
import { TripBar } from './TripBar'
import { LeaveBar } from './LeaveBar'
import { barOverlapsWeek, daysOfWeek, formatHoursMeter, formatWeekRange, isToday, shiftWeek, weekStartFromDateParam } from '../lib/roster'

export type PersonWeekProps = {
  kind: 'staff' | 'participant'
  personId: string
  name: string
  /** The week span's heading level; the day headings sit one below it. */
  headingLevel: 2 | 3 | 4
}

/** The row the person-filtered board returned for this person, or undefined when they aren't on the roster. */
function rowOf(data: RosterBoardDto, personId: string) {
  return data.groupBy === 'Staff' ? data.staffRows.find(r => r.staffId === personId) : data.participantRows.find(r => r.participantId === personId)
}

/**
 * One person's roster week as a time grid (spec 2026-10-29): hours down, days across, a shift drawn at its true length. A block opens the board's
 * shift panel in place and an empty slot starts a new shift at that time. Under 672px the grid is one day at a time, picked from a strip.
 */
export function PersonWeek({ kind, personId, headingLevel }: PersonWeekProps) {
  const sectionRef = useRef<HTMLElement>(null)
  const width = useMeasuredWidth(sectionRef)
  const { canWrite } = usePermissions()
  const [panelTarget, setPanelTarget] = useState<ShiftSlideOverTarget | null>(null)
  // The panel mounts on the first open and stays, so it keeps its exit motion and focus return.
  const [panelUsed, setPanelUsed] = useState(false)
  const [params, setParams] = useSearchParams()
  const week = weekStartFromDateParam(params.get('week'))
  const query = useRosterPersonWeek(kind, personId, week)
  const { data, isPlaceholderData, isLoading, isError, refetch } = query
  // The previous week's Sunday overnight carries onto Monday. Never blocks: placeholder or failed, there is simply no tail.
  const prev = useRosterPersonWeek(kind, personId, shiftWeek(week, -1))
  const prevWeekShifts = (prev.data && !prev.isPlaceholderData ? rowOf(prev.data, personId) : undefined)?.shifts ?? []
  const [announcement, setAnnouncement] = useState('')
  const spanId = useId()
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  const DayHeading = `h${headingLevel + 1}` as 'h3' | 'h4' | 'h5'

  // The span answers the click at once, from the address; the days below come from the data they belong to.
  const span = formatWeekRange(daysOfWeek(week))
  const open = (t: ShiftSlideOverTarget) => {
    setPanelTarget(t)
    setPanelUsed(true)
  }
  const createAt = (serviceDate: string, minute?: number) => {
    const startTime = minute === undefined ? undefined : `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`
    open(
      kind === 'staff'
        ? { mode: 'create', staffId: personId, serviceDate, startTime, focusField: 'participant' }
        : { mode: 'create', participantId: personId, staffId: null, serviceDate, startTime, focusField: 'staff' },
    )
  }
  const weekDays = daysOfWeek(week)
  const boardHref = kind === 'staff' ? `/rostering?date=${week}` : `/rostering?date=${week}&participant=${personId}`

  function goTo(target: string | null) {
    setParams(prev => {
      const p = new URLSearchParams(prev)
      if (target) p.set('week', target)
      else p.delete('week')
      return p
    }, { replace: true })
    setAnnouncement(`Showing ${formatWeekRange(daysOfWeek(target ?? weekStartFromDateParam(null)))}`)
  }

  const row = data ? rowOf(data, personId) : undefined
  const staffRow = row && 'staffId' in row ? row : undefined
  const loading = isLoading && !retryingAfterError(query)
  const failed = !data && (isError || retryingAfterError(query))

  let body: React.ReactNode
  if (loading) body = <WeekSkeleton dayView={width !== undefined && width > 0 && width < DAY_VIEW_BELOW} />
  else if (failed) body = <PageState kind="error" noun="roster week" onRetry={() => refetch()} />
  else if (data && !row && !isPlaceholderData) {
    body = <EmptyState icon={CalendarOff} size="inline" title="Not on the roster" description={kind === 'staff' ? 'Only active staff appear on the roster.' : 'Only active participants appear on the roster.'} />
  } else if (data && row) {
    const days = data.days
    const bars: Bar[] = [
      ...('leave' in row ? row.leave.map((l, i) => ({ key: `leave-${l.startDate}-${i}`, leave: l, start: l.startDate, end: l.endDate })) : []),
      ...row.tripBars.map(t => ({ key: `trip-${t.tripInstanceId}`, trip: t, start: t.startDate, end: t.endDate })),
    ].filter(b => barOverlapsWeek(b.start, b.end, days))
    const renderBar = (b: Bar, barDays: string[], fullWidth?: boolean) => (b.trip ? <TripBar tripBar={b.trip} days={barDays} /> : <LeaveBar leave={b.leave!} days={barDays} fullWidth={fullWidth} />)

    body = (
      <div className={isPlaceholderData ? 'opacity-60' : undefined}>
        {row.shifts.length === 0 && <p className="mb-2 text-[13px] text-muted-foreground">Nothing rostered this week. Choose a time on the grid to add a shift.</p>}
        <PersonWeekGrid
          kind={kind}
          personId={personId}
          weekStart={data.weekStart}
          days={days}
          shifts={row.shifts}
          prevWeekShifts={prevWeekShifts}
          bars={bars}
          renderBar={renderBar}
          width={width}
          ready={!isPlaceholderData}
          canWrite={canWrite}
          DayHeading={DayHeading}
          onOpen={s => open({ mode: 'edit', shift: s })}
          onAddAt={createAt}
        />
      </div>
    )
  }

  return (
    <section ref={sectionRef} aria-labelledby={spanId} aria-busy={loading || isPlaceholderData || undefined} className="@container flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <Button variant="secondary" size="md" onClick={() => goTo(shiftWeek(week, -1))} aria-label="Previous week" className="w-[var(--control-h)] px-0!">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="md" onClick={() => goTo(null)} className="whitespace-nowrap">
            This week
          </Button>
          <Button variant="secondary" size="md" onClick={() => goTo(shiftWeek(week, 1))} aria-label="Next week" className="w-[var(--control-h)] px-0!">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Heading id={spanId} className="whitespace-nowrap font-display text-sm font-semibold tabular-nums text-foreground">{span}</Heading>
        <div className="ml-auto flex items-center gap-3">
          {canWrite && (
            <Button variant="secondary" size="md" onClick={() => createAt(weekDays.find(isToday) ?? weekDays[0])}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add shift
            </Button>
          )}
          <Link to={boardHref} className={`${TAP_FLOOR} inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
            Open in roster
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      </div>
      {staffRow && <HoursLine rostered={staffRow.rosteredHours} target={staffRow.targetHours} />}
      {body}
      {panelUsed && <PersonWeekPanel kind={kind} target={panelTarget} onClose={() => setPanelTarget(null)} />}
    </section>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Hours against target, the board's staff-row meter (StaffRow) on its own line. Over target says so in words, so colour is never the only cue. */
function HoursLine({ rostered, target }: { rostered: number; target: number }) {
  const over = target > 0 && rostered > target
  const hours = Number.isInteger(rostered) ? String(rostered) : rostered.toFixed(1)
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] tabular-nums">
        <span className="text-muted-foreground">Hours</span>
        <span className="text-foreground">{target > 0 ? formatHoursMeter(rostered, target) : `${hours} h rostered`}</span>
        {over && <span className="font-medium text-[var(--color-on-warning-container)]">Over target</span>}
      </p>
      {target > 0 && (
        <div className="h-0.5 w-full max-w-[16rem] bg-input" aria-hidden="true">
          <div className={`h-full ${over ? 'bg-[var(--color-on-warning-container)]' : 'bg-primary'}`} style={{ width: `${Math.min(100, (rostered / target) * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

/** First load, in the grid's real shape (SHAPE §7): a header row with a few pulse blocks over hour lines, or the day strip and one column on a phone. */
function WeekSkeleton({ dayView }: { dayView: boolean }) {
  const block = 'absolute inset-x-0.5 rounded-sm bg-muted motion-safe:animate-pulse'
  const body = (cols: number, blocks: { col: number; top: number; height: number }[]) => (
    <div className={`grid ${cols === 1 ? 'grid-cols-[3rem_minmax(0,1fr)]' : 'grid-cols-[3rem_repeat(7,minmax(0,1fr))]'}`} style={{ height: 'min(70dvh, 40rem)', minHeight: '20rem' }}>
      <div />
      {Array.from({ length: cols }, (_, c) => (
        <div key={c} className="relative border-l border-border">
          {blocks.filter(b => b.col === c).map(b => <div key={b.top} className={block} style={{ top: b.top, height: b.height }} />)}
        </div>
      ))}
    </div>
  )
  return (
    <div>
      <span className="sr-only">Loading roster week…</span>
      <div aria-hidden="true">
        {dayView ? (
          <>
            <div className="mb-2 grid grid-cols-7">
              {Array.from({ length: 7 }, (_, i) => <div key={i} className="m-0.5 h-[52px] rounded-md bg-muted motion-safe:animate-pulse" />)}
            </div>
            <div className="overflow-hidden rounded-md border border-border">{body(1, [{ col: 0, top: 48, height: 144 }, { col: 0, top: 240, height: 96 }])}</div>
          </>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-border">
              <div className="h-8 bg-surface-container-low" />
              {Array.from({ length: 7 }, (_, i) => <div key={i} className="h-8 border-l border-border bg-surface-container-low" />)}
            </div>
            {body(7, [0, 1, 3, 4].map(col => ({ col, top: 48, height: 144 })).concat({ col: 2, top: 240, height: 96 }))}
          </div>
        )}
      </div>
    </div>
  )
}
