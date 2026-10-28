import { useId, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, CalendarDays, CalendarOff, ChevronLeft, ChevronRight } from 'lucide-react'
import type { LeaveBarDto, RosterBoardDto, ShiftDto, TripBarDto } from '@/api/types'
import { useRosterPersonWeek } from '@/api/hooks'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import { TAP_FLOOR } from '@/components/tapArea'
import { retryingAfterError } from '@/lib/queryPhase'
import { ShiftChip } from './ShiftChip'
import { TripBar } from './TripBar'
import { LeaveBar } from './LeaveBar'
import { barOverlapsWeek, daysOfWeek, formatDayAccessibleName, formatDayHeader, formatHoursMeter, formatWeekRange, isToday, shiftWeek, weekStartFromDateParam } from '../lib/roster'
import { firstName } from '../lib/rosterDrag'

export type PersonWeekProps = {
  kind: 'staff' | 'participant'
  personId: string
  name: string
  /** The week span's heading level; the day headings sit one below it. */
  headingLevel: 2 | 3 | 4
}

// The board's header tints (RosterGrid.tsx:73), copied rather than shared so the board's grid stays untouched.
const HEADER_BG_TODAY = 'bg-[color-mix(in_srgb,var(--color-primary)_6%,var(--color-surface-container-low))]'
const noop = () => {}

type Bar = { key: string; trip?: TripBarDto; leave?: LeaveBarDto; start: string; end: string }

/** The row the person-filtered board returned for this person, or undefined when they aren't on the roster. */
function rowOf(data: RosterBoardDto, personId: string) {
  return data.groupBy === 'Staff' ? data.staffRows.find(r => r.staffId === personId) : data.participantRows.find(r => r.participantId === personId)
}

/**
 * One person's roster week (spec 2026-10-28), read-only: the board's own chips and bars for one staff member or participant, by day.
 * Every change happens on the board; a chip opens it on that week with the shift's editor open.
 */
// The week is a grid of seven columns once its box (@container) is 58rem wide, 129px a column over the board's 127px floor; below that, a list of days.
export function PersonWeek({ kind, personId, name, headingLevel }: PersonWeekProps) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const week = weekStartFromDateParam(params.get('week'))
  const query = useRosterPersonWeek(kind, personId, week)
  const { data, isPlaceholderData, isLoading, isError, refetch } = query
  const [announcement, setAnnouncement] = useState('')
  const spanId = useId()
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  const DayHeading = `h${headingLevel + 1}` as 'h3' | 'h4' | 'h5'

  // The span answers the click at once, from the address; the days below come from the data they belong to.
  const span = formatWeekRange(daysOfWeek(week))
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
  if (loading) body = <WeekSkeleton />
  else if (failed) body = <PageState kind="error" noun="roster week" onRetry={() => refetch()} />
  else if (data && !row && !isPlaceholderData) {
    body = <EmptyState icon={CalendarOff} size="inline" title="Not on the roster" description={kind === 'staff' ? 'Only active staff appear on the roster.' : 'Only active participants appear on the roster.'} />
  } else if (data && row) {
    const days = data.days
    const bars: Bar[] = [
      ...('leave' in row ? row.leave.map((l, i) => ({ key: `leave-${l.startDate}-${i}`, leave: l, start: l.startDate, end: l.endDate })) : []),
      ...row.tripBars.map(t => ({ key: `trip-${t.tripInstanceId}`, trip: t, start: t.startDate, end: t.endDate })),
    ].filter(b => barOverlapsWeek(b.start, b.end, days))
    const label = (s: ShiftDto) => (kind === 'staff' ? s.participantName : s.staffName ?? '')
    const shifts = [...row.shifts].sort((a, b) => a.startTime.localeCompare(b.startTime) || label(a).localeCompare(label(b)))
    const renderBar = (b: Bar, barDays: string[], fullWidth?: boolean) => (b.trip ? <TripBar tripBar={b.trip} days={barDays} /> : <LeaveBar leave={b.leave!} days={barDays} fullWidth={fullWidth} />)

    body = shifts.length === 0 && bars.length === 0 ? (
      <EmptyState
        icon={CalendarDays}
        size="inline"
        title="Nothing rostered this week"
        description={`${firstName(name)} has no shifts this week. Shifts added on the roster board show here.`}
        action={{ label: 'Open in roster', to: boardHref }}
      />
    ) : (
      <div className={isPlaceholderData ? 'opacity-60' : undefined}>
        <ol className="flex flex-col gap-3 @[58rem]:grid @[58rem]:grid-cols-7 @[58rem]:gap-0 @[58rem]:divide-x @[58rem]:divide-border @[58rem]:overflow-hidden @[58rem]:rounded-md @[58rem]:border @[58rem]:border-border">
          {days.map(day => {
            const { weekday, day: dayNum } = formatDayHeader(day)
            const today = isToday(day)
            const dayShifts = shifts.filter(s => s.serviceDate === day)
            const dayBars = bars.filter(b => barOverlapsWeek(b.start, b.end, [day]))
            return (
              <li key={day} aria-current={today ? 'date' : undefined} className={`flex min-w-0 flex-col ${dayShifts.length === 0 ? `@max-[58rem]:flex-row @max-[58rem]:flex-wrap @max-[58rem]:items-baseline` : ''}`}>
                <DayHeading className={`flex items-baseline gap-1.5 rounded-sm px-2 py-1 ${dayShifts.length > 0 ? '@max-[58rem]:self-start' : ''} @[58rem]:rounded-none @[58rem]:border-b @[58rem]:border-border @[58rem]:px-3 @[58rem]:py-1.5 ${today ? HEADER_BG_TODAY : `@[58rem]:bg-surface-container-low`}`}>
                  <span aria-hidden="true" className="text-sm font-semibold leading-5 text-foreground">{weekday}</span>
                  <span aria-hidden="true" className="text-[13px] tabular-nums text-muted-foreground">{dayNum}</span>
                  <span className="sr-only">{formatDayAccessibleName(day)}{today ? ', today' : ''}</span>
                </DayHeading>
                {dayShifts.length === 0 ? (
                  <p className="text-xs text-muted-foreground before:mr-1.5 before:content-['·'] @[58rem]:px-3 @[58rem]:py-2 @[58rem]:before:content-none">No shifts</p>
                ) : (
                  <ul className="flex flex-col gap-y-1 px-1 py-1 @[58rem]:gap-y-0.5">
                    {dayShifts.map(s => (
                      <li key={s.id}>
                        <ShiftChip
                          shift={s}
                          canWrite={false}
                          draggable={false}
                          dashed={!s.staffId}
                          context={kind}
                          onOpen={sh => navigate(`/rostering?date=${data.weekStart}&shift=${sh.id}`)}
                          onAssignTo={noop}
                          onUnassign={noop}
                          onDelete={noop}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {/* On the list, a day's leave and trips follow its shifts, one line a day; the grid draws them once, spanning, in the lane below. */}
                {dayBars.length > 0 && (
                  <div className="grid w-full grid-cols-1 gap-y-0.5 px-1 @[58rem]:hidden">
                    {dayBars.map(b => <div key={b.key} className="contents">{renderBar(b, [day], true)}</div>)}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
        {bars.length > 0 && (
          <ul aria-label="Leave and trips" className="hidden grid-cols-7 gap-y-0.5 py-1 @[58rem]:grid">
            {/* `contents`, so each bar is the grid item and places itself across its days, as on the board (StaffRow). */}
            {bars.map(b => <li key={b.key} className="contents">{renderBar(b, days)}</li>)}
          </ul>
        )}
      </div>
    )
  }

  return (
    <section aria-labelledby={spanId} aria-busy={loading || isPlaceholderData || undefined} className="@container flex flex-col gap-3">
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
        <Link to={boardHref} className={`${TAP_FLOOR} ml-auto inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
          Open in roster
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      </div>
      {staffRow && <HoursLine rostered={staffRow.rosteredHours} target={staffRow.targetHours} />}
      {body}
    </section>
  )
}

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

/** First load, in the week's real shape: the grid's seven headers with a few chip blocks, or three day blocks on the list. */
function WeekSkeleton() {
  const block = 'rounded-sm bg-muted motion-safe:animate-pulse'
  return (
    <div>
      <span className="sr-only">Loading roster week…</span>
      <div aria-hidden="true" className="hidden grid-cols-7 divide-x divide-border overflow-hidden rounded-md border border-border @[58rem]:grid">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex flex-col">
            <div className="h-8 border-b border-border bg-surface-container-low" />
            {i < 5 && <div className="flex flex-col gap-0.5 p-1"><div className={`h-14 ${block}`} /><div className={`h-14 ${block}`} /></div>}
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="flex flex-col gap-3 @[58rem]:hidden">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className={`h-5 w-24 ${block}`} />
            <div className={`h-14 ${block}`} />
          </div>
        ))}
      </div>
    </div>
  )
}
