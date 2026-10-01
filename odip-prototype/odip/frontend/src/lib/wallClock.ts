// Provider-local WALL-CLOCK values: a clock reading somebody typed or a schedule slot, not a moment in time. Pure and JSX-free.
//
// The API sends an INSTANT (created, logged in, dose given) as UTC with a trailing Z; read it with `parseApiDate` and show it in a zone
// (`formatWithTimeZone`, `formatRelative`). It sends a WALL-CLOCK value with NO zone: "2026-10-03T08:00:00" is 8 o'clock on the 3rd for the
// provider, the incident time the reporter typed, the dose slot on the MAR. Its digits ARE the answer, so it must never be turned into an
// instant and shifted into the viewer's zone (that read "3 Oct 2026, 6:00 pm" for an incident typed as 08:00 in Sydney, and "4:00 am" in
// New York). The lists of which fields are which: DESIGN.md "Time on the wire", and the server's DateTimeWireInventoryTests.
//
// The helpers print or copy the digits exactly. They build the Date from UTC fields and format it in UTC, so the answer cannot depend on the
// viewer's zone or on a daylight-saving gap (02:30 on 2026-10-04 does not exist in Sydney and still prints as 2:30).

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/

interface Parts { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** The digits at the front of a wall-clock string; any fraction or zone suffix is ignored. null for a missing, malformed or impossible value. */
function readParts(value: string | null | undefined): Parts | null {
  const m = WALL_CLOCK.exec(value ?? '')
  if (!m) return null
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number)
  const t = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  const real = t.getUTCFullYear() === year && t.getUTCMonth() === month - 1 && t.getUTCDate() === day
    && t.getUTCHours() === hour && t.getUTCMinutes() === minute && t.getUTCSeconds() === second
  return real ? { year, month, day, hour, minute, second } : null
}

/**
 * A wall-clock value printed as written, in `locale` (en-AU unless told otherwise), with Intl `options`: `{ dateStyle: 'medium', timeStyle: 'short' }`
 * reads "3 Oct 2026, 8:00 am" for "2026-10-03T08:00:00" in every viewer zone. '—' for nothing or for a value that is not a date and time.
 */
export function formatWallClock(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
  locale: string | undefined = 'en-AU',
): string {
  const p = readParts(value)
  if (!p) return '—'
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)).toLocaleString(locale, { ...options, timeZone: 'UTC' })
}

const two = (n: number) => String(n).padStart(2, '0')

/** What a `<input type="datetime-local">` takes for a stored wall-clock value: "2026-10-03T08:00" (the same digits). '' when there is nothing usable. */
export function toDatetimeInputValue(value: string | null | undefined): string {
  const p = readParts(value)
  return p ? `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}` : ''
}

/** The viewer's own wall clock right now as a datetime-local value. NOT `new Date().toISOString().slice(0, 16)`, which is the UTC clock. */
export function datetimeInputNow(now: Date = new Date()): string {
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}T${two(now.getHours())}:${two(now.getMinutes())}`
}
