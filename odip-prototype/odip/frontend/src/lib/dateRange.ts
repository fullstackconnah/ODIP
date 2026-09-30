// Fixed abbreviations, not Intl: `en-AU` renders September as "Sept" in some ICU builds and "Sep" in others, and a
// header string must not change with the browser.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const EN_DASH = '–'

type CalendarDate = { year: number; month: number; day: number }

/**
 * Reads the calendar date written at the front of an ISO string. Trip dates are `DateOnly` on the server, so
 * "2026-08-14" IS the date: going through `new Date()` would treat it as UTC midnight and show the wrong day in any
 * time zone west of UTC.
 */
function parseCalendarDate(iso: string | null | undefined): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!match) return null
  const month = Number(match[2]) - 1
  if (month < 0 || month > 11) return null
  return { year: Number(match[1]), month, day: Number(match[3]) }
}

const full = (d: CalendarDate) => `${d.day} ${MONTHS[d.month]} ${d.year}`

/**
 * A compact, always-dated range for a header meta row. The year is never dropped, and the shortest unambiguous
 * form is used:
 *
 *   same month      "14–17 Aug 2026"
 *   same year       "28 Aug – 2 Sep 2026"
 *   across years    "28 Dec 2026 – 2 Jan 2027"
 *   one day         "14 Aug 2026"
 *
 * A missing or unparseable end falls back to the start alone, and to '' when neither parses, so a caller can drop
 * the item instead of showing a placeholder.
 */
export function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  const a = parseCalendarDate(start)
  const b = parseCalendarDate(end)
  if (!a && !b) return ''
  if (!a || !b) return full((a ?? b)!)
  if (a.year === b.year && a.month === b.month) {
    return a.day === b.day ? full(a) : `${a.day}${EN_DASH}${b.day} ${MONTHS[a.month]} ${a.year}`
  }
  if (a.year === b.year) return `${a.day} ${MONTHS[a.month]} ${EN_DASH} ${b.day} ${MONTHS[b.month]} ${a.year}`
  return `${full(a)} ${EN_DASH} ${full(b)}`
}
