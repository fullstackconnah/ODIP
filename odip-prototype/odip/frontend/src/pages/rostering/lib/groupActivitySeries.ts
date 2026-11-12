import { format, parseISO } from 'date-fns'
import type { GroupActivityRepeats, GroupActivitySeriesDto } from '@/api/types'
import { formatDayNumber, parseDateOnly } from '@/lib/dateOnly'

/** The server's cap: a series ends within this many days of its first activity (GA_SERIES_RANGE). */
export const SERIES_MAX_DAYS = 400

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ORDINALS = ['1st', '2nd', '3rd', '4th']
// Calendar days only (day numbers since 1970-01-01), so nothing shifts across a Sydney clock change. 1970-01-01 was a Thursday.
const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7
const ymd = (day: number) => formatDayNumber(day).split('-').map(Number) as [number, number, number]
const monthStart = (y: number, m: number) => parseDateOnly(`${y}-${String(m).padStart(2, '0')}-01`) as number

/** The 1-based ordinal of a day's weekday within its month; 5 means "the last one" (the server's rule for a 5th-weekday start). */
const ordinalOf = (day: number) => Math.floor((ymd(day)[2] - 1) / 7) + 1

/** The same weekday in month m of year y: its ordinal (1 to 4), or the last one for a 5th-weekday start. */
function monthlyDay(y: number, m: number, weekday: number, ordinal: number): number {
  const first = monthStart(y, m)
  if (ordinal <= 4) return first + ((weekday - weekdayOf(first) + 7) % 7) + 7 * (ordinal - 1)
  const last = (m === 12 ? monthStart(y + 1, 1) : monthStart(y, m + 1)) - 1
  return last - ((weekdayOf(last) - weekday + 7) % 7)
}

/** Every date of a series as "yyyy-MM-dd", end date included; empty for a bad or backwards range. Mirrors the server's GroupActivitySeriesDates. */
export function seriesDates(interval: GroupActivityRepeats, startDate: string, endDate: string): string[] {
  const start = parseDateOnly(startDate)
  const end = parseDateOnly(endDate)
  if (start === null || end === null || end < start) return []
  const days: number[] = []
  if (interval === 'Monthly') {
    const weekday = weekdayOf(start)
    const ordinal = ordinalOf(start)
    const [y0, m0] = ymd(start)
    for (let i = 0; ; i++) {
      const day = monthlyDay(y0 + Math.floor((m0 - 1 + i) / 12), ((m0 - 1 + i) % 12) + 1, weekday, ordinal)
      if (day > end) break
      days.push(day)
    }
  } else {
    const step = interval === 'Weekly' ? 7 : 14
    for (let day = start; day <= end; day += step) days.push(day)
  }
  return days.map(formatDayNumber)
}

/** "Every Tuesday", "Every second Tuesday", "3rd Tuesday of each month", "Last Friday of each month". '' without a usable date. */
export function seriesCadence(interval: GroupActivityRepeats, startDate: string): string {
  const start = parseDateOnly(startDate)
  if (start === null) return ''
  const name = WEEKDAYS[weekdayOf(start)]
  if (interval === 'Weekly') return `Every ${name}`
  if (interval === 'Fortnightly') return `Every second ${name}`
  const n = ordinalOf(start)
  return `${n <= 4 ? ORDINALS[n - 1] : 'Last'} ${name} of each month`
}

const dayText = (iso: string) => format(parseISO(iso), 'd MMM yyyy')

/** The create form's line under the Repeats row: "Every Tuesday until 9 Mar 2027 · 17 activities". */
export function seriesSummary(interval: GroupActivityRepeats, startDate: string, endDate: string): string {
  const n = seriesDates(interval, startDate, endDate).length
  return `${seriesCadence(interval, startDate)} until ${dayText(endDate)} · ${n} ${n === 1 ? 'activity' : 'activities'}`
}

type SeriesText = Pick<GroupActivitySeriesDto, 'interval' | 'startDate' | 'endDate'>

/** The modal's read-only Repeats value: "Every Tuesday until 9 Mar 2027". */
export const seriesUntilText = (s: SeriesText) => `${seriesCadence(s.interval, s.startDate)} until ${dayText(s.endDate)}`

/** The overview row's line: "Repeats every Tuesday until 9 Mar 2027", "Repeats on the 3rd Tuesday of each month until ...". */
export function seriesOverviewLine(s: SeriesText): string {
  const cadence = seriesCadence(s.interval, s.startDate)
  return `Repeats ${s.interval === 'Monthly' ? 'on the ' : ''}${cadence.charAt(0).toLowerCase()}${cadence.slice(1)} until ${dayText(s.endDate)}`
}

/** The last end date a series starting on `date` may use (date + 400 days), "yyyy-MM-dd"; '' for a bad date. */
export function seriesLastDay(date: string): string {
  const d = parseDateOnly(date)
  return d === null ? '' : formatDayNumber(d + SERIES_MAX_DAYS)
}

export const dayLabel = dayText
