// Date-only math: a calendar day is a whole number, never an instant.
//
// A `DateOnly` from the API ("2026-08-14": an expiry, a due date, a plan end) names a day. Parsing it with `new Date("2026-08-14")` reads it as
// UTC midnight, and building local midnights and dividing the gap by 86 400 000 ms is wrong twice a year: on the day the clocks go forward a
// day is 23 hours long (Sydney, 2026-10-04), so "ten days from now" comes out as 9.96 and floors to 9. Here a day is the integer
// `Date.UTC(year, month, day) / 86 400 000`, so a difference between two days is exact in every time zone, on every day of the year.
//
// "Today" is the local calendar day of the `Date` you pass (the viewer's own day), or a "YYYY-MM-DD" string when the caller knows the
// provider's day. Nothing here reads the clock unless you leave `today` out.

const MS_PER_DAY = 86_400_000
const DATE_PART = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** True for exactly "YYYY-MM-DD" (a day), false for anything with a time part (an instant). */
export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value)
}

/** A calendar day as days since 1970-01-01, or null when year, month and day are not a real date ("2026-02-30"). */
function dayNumber(year: number, month: number, day: number): number | null {
  const t = new Date(0)
  t.setUTCFullYear(year, month - 1, day)
  if (t.getUTCFullYear() !== year || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) return null
  return t.getTime() / MS_PER_DAY
}

/**
 * The day written at the front of "YYYY-MM-DD" (any time part after it is ignored, the same rule as formatDateRange), as a day number.
 * null for a missing, malformed or impossible date.
 */
export function parseDateOnly(value: string | null | undefined): number | null {
  const m = DATE_PART.exec(value ?? '')
  return m ? dayNumber(Number(m[1]), Number(m[2]), Number(m[3])) : null
}

/** The local calendar day of an instant (what the viewer's wall calendar shows), as a day number. null for an invalid Date. */
export function dayNumberOf(when: Date): number | null {
  return Number.isNaN(when.getTime()) ? null : dayNumber(when.getFullYear(), when.getMonth() + 1, when.getDate())
}

/** "YYYY-MM-DD" for a day number (the inverse of parseDateOnly). Exact in every zone: it never goes through a local midnight. */
export function formatDayNumber(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10)
}

/**
 * The viewer's local calendar date as "YYYY-MM-DD": what their wall calendar shows right now. This is the date to SAVE for "today" (a task's
 * completed date). `new Date().toISOString().split('T')[0]` is the UTC date, which is still yesterday before 10:00 (11:00 in daylight time)
 * in Sydney. '' for an invalid Date.
 */
export function localIsoDate(when: Date = new Date()): string {
  const day = dayNumberOf(when)
  return day === null ? '' : formatDayNumber(day)
}

/**
 * Every day from `from` up to but NOT including `to`, as "YYYY-MM-DD" (the nights of a stay that checks in on `from` and out on `to`).
 * Whole-day maths on day numbers, so it is the same in every zone and across a clock change. Empty for an empty or backwards range or an
 * unusable date; a time part after the date is ignored.
 */
export function eachDay(from: string | null | undefined, to: string | null | undefined): string[] {
  const start = parseDateOnly(from)
  const end = parseDateOnly(to)
  if (start === null || end === null || end <= start) return []
  const days: string[] = []
  for (let d = start; d < end; d++) days.push(formatDayNumber(d))
  return days
}

/**
 * Whole calendar days from `today` to `target`: positive in the future, 0 today, negative once it has passed. null when either side is
 * not a usable date. `today` defaults to the viewer's current local day.
 */
export function calendarDaysUntil(target: string | null | undefined, today: Date | string = new Date()): number | null {
  const to = parseDateOnly(target)
  const from = typeof today === 'string' ? parseDateOnly(today) : dayNumberOf(today)
  return to === null || from === null ? null : to - from
}
