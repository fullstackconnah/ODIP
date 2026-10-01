import { addDays, addWeeks, format, parseISO, startOfWeek } from 'date-fns'
import { formatShiftTime } from '@/lib/utils'
import { formatRatio } from '@/lib/format'

// Re-exported so existing `from '../lib/roster'` imports across the rostering feature keep
// working unchanged — the implementation itself now lives in the shared lib alongside
// formatDateAu/formatCurrency, since participant-detail's RoutinesTab needs the same algorithm
// and importing it from here (a rostering-feature module) into an unrelated feature would be
// backwards, not just semantically off.
export { formatShiftTime }

/**
 * Sticky first-column width. Sized so the longest name in the fixture ("Marcus Papadopoulos",
 * ~152px of text at the header's 14px/600 font) clears its 32px of horizontal padding with a
 * few px to spare — that name truncating was a deliberate pass-1 fix (see StaffRow), so this
 * floor exists specifically to not regress it.
 */
export const ROSTER_STICKY_COL_WIDTH = 195

/**
 * Day-column floor. Sized (with ROSTER_STICKY_COL_WIDTH) so all 7 day columns fit within the
 * board's available width at 1440px with the sidebar expanded (measured ~1088px) without
 * requiring horizontal scroll to reach Sunday — the whole point of a week-at-a-glance board.
 * Columns still grow past this via the `1fr` in minmax() on wider viewports.
 */
export const ROSTER_DAY_COL_MIN_WIDTH = 127

/** Grid-template-columns for the board's header row: the sticky column plus 7 day columns. */
export const ROSTER_GRID_TEMPLATE_COLUMNS = `${ROSTER_STICKY_COL_WIDTH}px repeat(7, minmax(${ROSTER_DAY_COL_MIN_WIDTH}px, 1fr))`

/** Grid-template-columns for a row's day-cell strip (no sticky column — that's a separate grid item spanning column 1). */
export function rosterDayColumnsTemplate(dayCount: number): string {
  return `repeat(${dayCount}, minmax(${ROSTER_DAY_COL_MIN_WIDTH}px, 1fr))`
}

/** Monday-start ISO week key, e.g. "2026-08-17". */
export function weekStartOf(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

export function shiftWeek(weekStart: string, deltaWeeks: number): string {
  return format(addWeeks(parseISO(weekStart), deltaWeeks), 'yyyy-MM-dd')
}

/** The 7 ISO dates for a Monday-start week, used as a client-side fallback before the board loads. */
export function daysOfWeek(weekStart: string): string[] {
  const start = parseISO(weekStart)
  return Array.from({ length: 7 }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'))
}

export function formatWeekRange(days: string[]): string {
  if (days.length === 0) return ''
  const first = parseISO(days[0])
  const last = parseISO(days[days.length - 1])
  const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()
  return sameMonth
    ? `${format(first, 'd')} – ${format(last, 'd MMM yyyy')}`
    : `${format(first, 'd MMM')} – ${format(last, 'd MMM yyyy')}`
}

export function formatDayHeader(iso: string): { weekday: string; day: string } {
  const d = parseISO(iso)
  return { weekday: format(d, 'EEE'), day: format(d, 'd') }
}

/** Full weekday + date, for accessible names (e.g. "Wednesday 19 August") — screen-reader users don't get the two-letter/number split the visual header uses. */
export function formatDayAccessibleName(iso: string): string {
  return format(parseISO(iso), 'EEEE d MMMM')
}

export function isToday(iso: string): boolean {
  return iso === format(new Date(), 'yyyy-MM-dd')
}

export function formatShiftRange(startTime: string, endTime: string, endsNextDay: boolean): string {
  return `${formatShiftTime(startTime)}–${formatShiftTime(endTime)}${endsNextDay ? ' +1' : ''}`
}

/**
 * Just the "start–end" range, without the endsNextDay suffix — for callers that render the
 * next-day indicator as its own styled element (ShiftChip's compact superscript) instead of
 * concatenating " +1" into the string. Time is a chip's highest-priority content and must never
 * clip, so on a narrow day column even a ~10px suffix matters; formatShiftRange (with the
 * suffix inline) stays as-is for callers like PatternsPage that just need plain text.
 */
export function formatShiftTimeRange(startTime: string, endTime: string): string {
  return `${formatShiftTime(startTime)}–${formatShiftTime(endTime)}`
}

/**
 * Clamps a bar's endpoint to the visible week when the bar starts before or ends after the
 * current 7-day window (e.g. a multi-week trip), so it still renders as a spanning bar
 * instead of vanishing because its exact date isn't one of the 7 columns.
 */
export function clampedDayIndex(iso: string, days: string[]): number {
  const idx = days.indexOf(iso)
  if (idx !== -1) return idx
  return iso < days[0] ? 0 : days.length - 1
}

export function barOverlapsWeek(startDate: string, endDate: string, days: string[]): boolean {
  return endDate >= days[0] && startDate <= days[days.length - 1]
}

export function formatHoursMeter(rostered: number, target: number): string {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  return `${formatRatio(fmt(rostered), fmt(target))} h`
}

/**
 * Signed rostered-vs-actual variance in minutes (design spec §3 — positive is late/over,
 * negative is early/under) as short display text: "On time" at exactly 0, otherwise
 * "+N min"/"-N min". Shared by PortalShiftDetailPage's Completed summary and
 * CompletionReviewPage's queue table so the two surfaces read the same number the same way.
 */
export function formatVarianceMinutes(minutes: number): string {
  if (minutes === 0) return 'On time'
  return `${minutes > 0 ? '+' : ''}${minutes} min`
}

/**
 * "Started Xh Ym ago" style elapsed-time text for an InProgress shift's Start/Finish card —
 * floors to whole minutes, never negative (a clock-skew `actualStart` slightly in the future
 * reads as "just now" rather than a nonsensical negative duration).
 */
export function formatElapsedSince(actualStartIso: string, now: Date = new Date()): string {
  const startMs = new Date(actualStartIso).getTime()
  const totalMinutes = Math.max(0, Math.floor((now.getTime() - startMs) / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  return `${hours}h ${minutes}m`
}

export const NIGHT_TYPE_LABELS: Record<string, string> = {
  None: 'None',
  ActiveNight: 'Active Night',
  PassiveNight: 'Passive Night',
  Sleepover: 'Sleepover',
}

export const RATIO_LABELS: Record<string, string> = {
  OneToOne: '1:1',
  OneToTwo: '1:2',
  TwoToOne: '2:1',
  SharedSupport: 'Shared',
  Other: 'Other',
  OneToThree: '1:3',
  OneToFour: '1:4',
  OneToFive: '1:5',
}

/** .NET `DayOfWeek` numbering (Sunday = 0), matched so pattern day sorting/expansion agrees with the backend. */
export const DAY_OF_WEEK_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
}

export function formatEffectiveRange(from: string, to: string | null): string {
  const start = format(parseISO(from), 'd MMM yyyy')
  return to ? `${start} – ${format(parseISO(to), 'd MMM yyyy')}` : `${start} – ongoing`
}

/**
 * Preview-only estimate of a generate run's size — NOT the source of truth. The authoritative
 * implementation is `ShiftPatternExpander.Occurrences`
 * (`Odip.Domain/Rostering/Services/ShiftPatternExpander.cs`); this is a client-side port of the
 * same rule (intersection of [from,to] with [effectiveFrom,effectiveTo], inclusive of
 * effectiveTo, then a weekly stride from the first matching day-of-week) and must be kept in
 * step with it by hand. There's no dry-run endpoint for patterns, only for individual shifts, so
 * this is what drives the Patterns page's pre-submit preview. The server remains authoritative
 * for the real result — it also skips dates that already carry a shift from this pattern, which
 * this function has no way to know about, so callers must present the count as an upper bound.
 */
export function countPatternOccurrences(
  pattern: { dayOfWeek: string; effectiveFrom: string; effectiveTo: string | null; isActive: boolean },
  from: string,
  to: string,
): number {
  if (!pattern.isActive) return 0
  const fromDate = parseISO(from)
  const toDate = parseISO(to)
  if (fromDate > toDate) return 0

  const effectiveFrom = parseISO(pattern.effectiveFrom)
  const effectiveTo = pattern.effectiveTo ? parseISO(pattern.effectiveTo) : null
  const rangeStart = fromDate > effectiveFrom ? fromDate : effectiveFrom
  const rangeEnd = effectiveTo && effectiveTo < toDate ? effectiveTo : toDate
  if (rangeStart > rangeEnd) return 0

  const targetDow = DAY_OF_WEEK_INDEX[pattern.dayOfWeek] ?? 0
  const offset = (targetDow - rangeStart.getDay() + 7) % 7
  let current = addDays(rangeStart, offset)
  let count = 0
  while (current <= rangeEnd) {
    count++
    current = addDays(current, 7)
  }
  return count
}
