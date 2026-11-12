import { format, parseISO } from 'date-fns'
import { Link } from 'react-router-dom'
import { AlertTriangle, Map } from 'lucide-react'
import type { TripBarDayDto, TripBarDto } from '@/api/types'
import { plural } from '@/lib/format'
import { formatShiftTime } from '@/lib/utils'
import { ON_TINT } from '@/lib/tone'
import { clampedDayIndex, formatShiftTimeRange } from '../lib/roster'

export type TripBarProps = {
  tripBar: TripBarDto
  days: string[]
}

/** A day's times as the cell reads them ('8am–5pm', 'from 8am', 'until 5pm'), and as a screen reader says them. */
function dayText(d: TripBarDayDto, spoken = false): string {
  if (d.start && d.finish) return spoken ? `${formatShiftTime(d.start)} to ${formatShiftTime(d.finish)}` : formatShiftTimeRange(d.start, d.finish)
  return d.start ? `from ${formatShiftTime(d.start)}` : d.finish ? `until ${formatShiftTime(d.finish)}` : ''
}

/**
 * Trip staffing rendered read-only on the roster board — visibly a different material from a
 * shift chip (filled secondary surface, no border, a map glyph) so a coordinator never mistakes
 * it for something editable here. Not draggable, no menu; the only interaction is navigating to
 * the trip itself. The link is `relative` so its sr-only spans stay inside the board scroller instead of widening the page. A trip short of staff ends its bar with an amber "n short" pill (a reminder, never a block). Sits in the row's second lane at --control-h-sm (24px) with a mouse; under a coarse
 * pointer it is a link, so it takes --control-h (44px), the touch target. When a visible day has an itinerary time, a second line (text-xs, aria-hidden) gives one cell per day,
 * each over its own day column: the trip's start and finish that day, not the worker's own hours.
 */
export function TripBar({ tripBar, days }: TripBarProps) {
  const startCol = clampedDayIndex(tripBar.startDate, days) + 1
  const endCol = clampedDayIndex(tripBar.endDate, days) + 2
  const short = tripBar.staffShort
  const visible = days.slice(clampedDayIndex(tripBar.startDate, days), clampedDayIndex(tripBar.endDate, days) + 1)
  const timed = visible.map(date => tripBar.days?.find(d => d.date === date) ?? null).map(d => (d && dayText(d) ? d : null))
  const hasTimes = timed.some(Boolean)
  const times = timed.filter((d): d is TripBarDayDto => d !== null)

  const head = (
    <>
      <Map className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-medium">
        {tripBar.tripName}
        {short > 0 && <span className="sr-only">, {plural(short, 'staff member')} short</span>}
        {times.map(d => <span key={d.date} className="sr-only">, {format(parseISO(d.date), 'EEEE')} {dayText(d, true)}</span>)}
      </span>
      {tripBar.isDriver && <span className="shrink-0 text-xs opacity-80">Driver</span>}
      {short > 0 && (
        <span data-staff-short aria-hidden="true" className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 text-xs font-semibold leading-[18px] ${ON_TINT.warning}`}>
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          {short} short
        </span>
      )}
    </>
  )

  return (
    <Link
      to={`/trips/${tripBar.tripInstanceId}`}
      style={{ gridColumn: `${startCol} / ${endCol}` }}
      className={`relative rounded-sm bg-secondary-container text-[13px] text-foreground transition-colors duration-150 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        hasTimes ? 'flex min-h-[var(--control-h-sm)] flex-col pointer-coarse:min-h-[var(--control-h)]' : 'flex h-[var(--control-h-sm)] pointer-coarse:h-[var(--control-h)] items-center gap-1.5 px-2'
      }`}
      title={`${tripBar.tripName} (${tripBar.tripCode})${short ? ` · ${short} staff short` : ''}${times.map(d => ` · ${format(parseISO(d.date), 'EEE')} ${dayText(d)}`).join('')}`}
    >
      {hasTimes ? (
        <>
          <span className="flex h-[var(--control-h-sm)] shrink-0 items-center gap-1.5 px-2">{head}</span>
          <span aria-hidden="true" className="grid gap-x-1 pb-1" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}>
            {timed.map((d, i) => (
              <span key={visible[i]} data-trip-day={visible[i]} className="whitespace-nowrap px-2 text-xs tabular-nums opacity-80">{d ? dayText(d) : ''}</span>
            ))}
          </span>
        </>
      ) : head}
    </Link>
  )
}
