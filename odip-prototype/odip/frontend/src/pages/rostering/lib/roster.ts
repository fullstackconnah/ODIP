import { addDays, addWeeks, format, parseISO, startOfWeek } from 'date-fns'

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

export function isToday(iso: string): boolean {
  return iso === format(new Date(), 'yyyy-MM-dd')
}

/** Formats "HH:mm:ss" or "HH:mm" as "h:mma" (lowercase, no space) for compact tabular display. */
export function formatShiftTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'pm' : 'am'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, '0')}${period}`
}

export function formatShiftRange(startTime: string, endTime: string, endsNextDay: boolean): string {
  return `${formatShiftTime(startTime)}–${formatShiftTime(endTime)}${endsNextDay ? ' +1' : ''}`
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
  return `${fmt(rostered)} / ${fmt(target)} h`
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
