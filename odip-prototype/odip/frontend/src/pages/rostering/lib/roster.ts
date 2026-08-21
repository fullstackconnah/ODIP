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
