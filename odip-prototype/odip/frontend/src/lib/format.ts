// Format helpers: how the app spells a count, a ratio and a relative time, in one place. Pure and JSX-free.
//
//   plural(2, 'day')            -> "2 days"            plural(1, 'person', 'people') -> "1 person"
//   joinList(['A', 'B', 'C'])   -> "A, B and C"        (a list in a sentence, no serial comma)
//   formatRatio(12, 14)         -> "12 / 14"           (DESIGN.md: a ratio is always "x / y")
//   formatRelative(iso, { style: 'compact' })  -> "5m ago"     { style: 'long' } -> "5 min ago"
//
// Every string a test pins is built from fixed words and arithmetic, never Intl: en-AU renders September as "Sep" in some ICU builds and
// "Sept" in others (the rule dateRange.ts follows). The two date-time formatters at the bottom are the exception and stay Intl-backed, so
// they print exactly what they always printed. Nothing reads the clock unless you leave `now` out.
import { calendarDaysUntil, isDateOnly } from './dateOnly'
import { formatWithTimeZone, parseApiDate } from './utils'

/**
 * The count and the noun that agrees with it: "1 day", "2 days", "0 days". Only exactly 1 is singular. Pass the plural for an
 * irregular noun: `plural(n, 'person', 'people')`, `plural(n, 'batch', 'batches')`, `plural(n, 'entry', 'entries')`.
 */
export function plural(n: number, singular: string, pluralForm: string = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

/** A list inside a sentence: "A", "A and B", "A, B and C" (no serial comma, the Australian way). '' for an empty list. */
export function joinList(items: readonly string[]): string {
  if (items.length < 2) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * The one spelling of an "x / y" figure: a space each side of the slash, so two figures can never drift apart ("12 / 10" beside "12/14").
 * It only joins the two parts; the caller decides what a missing count shows.
 */
export function formatRatio(numerator: number | string, denominator: number | string): string {
  return `${numerator} / ${denominator}`
}

/** The glance strip's earlier name for formatRatio (the same function); new code calls formatRatio. */
export const glanceRatio = formatRatio

export type RelativeStyle = 'compact' | 'long'

export interface RelativeOptions {
  /** `compact` for a cell or a chip on its own, `long` for running text. */
  style: RelativeStyle
  /** The moment to measure from: a Date or epoch milliseconds. Defaults to now; pass it in tests. */
  now?: Date | number
}

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
// A timestamp the server wrote can be a little ahead of the viewer's clock; that is "just now", not "in 2m". Only a real future date reads "in ...".
const CLOCK_SKEW = 5 * MINUTE

type Unit = 'min' | 'hr' | 'day' | 'month'

/** Days, or months from 30 days on in running text ("45 days ago" in a cell, "1 month ago" in a sentence). */
function dayUnits(days: number, long: boolean): { n: number; unit: Unit } {
  return long && days >= 30 ? { n: Math.floor(days / 30), unit: 'month' } : { n: days, unit: 'day' }
}

function words(n: number, unit: Unit, past: boolean, long: boolean): string {
  const span = long
    ? unit === 'min' ? `${n} min` : plural(n, unit)
    : `${n}${{ min: 'm', hr: 'h', day: 'd', month: 'mo' }[unit]}`
  return past ? `${span} ago` : `in ${span}`
}

/**
 * How long ago (or how far ahead) a moment is, rounded DOWN to one unit, the way a clock reads: 59 s is "just now", 119 min is "1 hr".
 *
 *   compact   Just now, 5m ago, 3h ago, 62d ago, in 2d        sentence case, for a cell or a chip; days at any size
 *   long      just now, 5 min ago, 3 hrs ago, 2 months ago    lower case, for running text; months from 30 days
 *
 * `null`, `undefined` and '' read "Never" / "never" (no moment was recorded); an unparseable value reads "—". A date-only string
 * ("2026-09-30", a due date) is a calendar day, not an instant, so it counts calendar days against the local day of `now` and reads
 * "Today" / "today" on the day. A timestamp string is an INSTANT and is read with parseApiDate: with a Z or an offset it is exact, and one sent
 * without a zone (an older response, a hand-built fixture) is UTC, never the viewer's local time, which in Sydney is 10-11 hours wrong.
 * (A provider-local wall-clock value is not an instant: lib/wallClock.ts.)
 */
export function formatRelative(value: string | Date | null | undefined, { style, now = new Date() }: RelativeOptions): string {
  const long = style === 'long'
  if (value === null || value === undefined || value === '') return long ? 'never' : 'Never'
  const nowMs = typeof now === 'number' ? now : now.getTime()

  if (typeof value === 'string' && isDateOnly(value)) {
    const ahead = calendarDaysUntil(value, new Date(nowMs))
    if (ahead === null) return '—'
    if (ahead === 0) return long ? 'today' : 'Today'
    const { n, unit } = dayUnits(Math.abs(ahead), long)
    return words(n, unit, ahead < 0, long)
  }

  const then = typeof value === 'string' ? parseApiDate(value).getTime() : value.getTime()
  if (Number.isNaN(then) || Number.isNaN(nowMs)) return '—'
  const past = nowMs >= then
  const gap = Math.abs(nowMs - then)
  if (gap < MINUTE || (!past && gap < CLOCK_SKEW)) return long ? 'just now' : 'Just now'
  if (gap < HOUR) return words(Math.floor(gap / MINUTE), 'min', past, long)
  if (gap < DAY) return words(Math.floor(gap / HOUR), 'hr', past, long)
  const { n, unit } = dayUnits(Math.floor(gap / DAY), long)
  return words(n, unit, past, long)
}

/**
 * How old something is as a bare, coarse duration: "<1h", "5h", "2d". It is for a column headed "Age" (a triage queue), where "5h ago" would say
 * "ago" on every row and minutes are noise: under an hour is "<1h", under a day is whole hours, then whole days. Rounds down. A moment in the
 * future (clock skew) is "<1h" too; a missing or unparseable value is "—". Anything that reads as a sentence wants `formatRelative`.
 */
export function formatAge(value: string | Date | null | undefined, { now = new Date() }: { now?: Date | number } = {}): string {
  if (value === null || value === undefined || value === '') return '—'
  const then = typeof value === 'string' ? parseApiDate(value).getTime() : value.getTime()
  const nowMs = typeof now === 'number' ? now : now.getTime()
  if (Number.isNaN(then) || Number.isNaN(nowMs)) return '—'
  const hours = Math.floor((nowMs - then) / HOUR)
  if (hours < 1) return '<1h'
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/**
 * "27/03/2026, 01:45 pm": an INSTANT as a date and time in the viewer's zone, en-AU; '—' for nothing. Intl-backed, so the space before "pm" follows the
 * ICU build, exactly as it did when this lived in the claim-batch pages. Read with parseApiDate, so a zone-less instant is UTC (a claim batch
 * created at 3 pm in Sydney printed "05:00 am" when it was read as local time).
 */
export function formatDateTimeAu(value: string | null | undefined): string {
  if (!value) return '—'
  return parseApiDate(value).toLocaleString('en-AU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** "8 Sept 2026, 7:30 pm": the medium date and short time of a shift note, in the viewer's own zone. Intl-backed, like formatDateTimeAu. */
export function formatNoteTimestamp(iso: string): string {
  return formatWithTimeZone(iso, undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
