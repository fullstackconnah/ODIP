import { formatDayNumber, parseDateOnly } from '@/lib/dateOnly'

/** The longest range a report accepts, in days counting both ends. The server enforces the same figure. */
export const MAX_REPORT_DAYS = 366

/** The four Monday-to-Sunday weeks before today, by the viewer's own calendar: To is the latest Sunday before today. */
export function defaultReportRange(now: Date = new Date()): { from: string; to: string } {
  const today = parseDateOnly(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)!
  const weekday = (today + 4) % 7 // day 0 (1970-01-01) was a Thursday; 0 is Sunday
  const to = today - (weekday === 0 ? 7 : weekday)
  return { from: formatDayNumber(to - 27), to: formatDayNumber(to) }
}

/** The sentence for an unusable range, or null when it is fine. Day numbers, so a clock change never shifts the count. */
export function reportRangeError(from: string, to: string): string | null {
  const f = parseDateOnly(from)
  const t = parseDateOnly(to)
  if (f === null || t === null) return 'Pick a date.'
  if (t < f) return 'The To date must be on or after the From date.'
  const days = t - f + 1
  return days > MAX_REPORT_DAYS ? `Pick a range of ${MAX_REPORT_DAYS} days or less. This one is ${days} days.` : null
}
