// Instants for the shift screen. A datetime-local control holds a provider-local wall clock ("2026-10-05T09:00"); the API wants an INSTANT,
// UTC with a trailing Z (DESIGN.md, "Time on the wire"; the API reads a zone-less instant as UTC). These convert between the two with the
// PROVIDER's zone (`PortalShiftDetailDto.timeZoneId`), never the browser's. Pure and JSX-free.
import { parseApiDate } from '@/lib/utils'

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** The offset of `zone` from UTC, in minutes, at the instant `ms`. */
function zoneOffsetMinutes(zone: string, ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms))
  const n = (type: string) => Number(parts.find(p => p.type === type)?.value)
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000)
}

const two = (n: number) => String(n).padStart(2, '0')

/** "2026-10-05T09:00" read in `zone`, as "2026-10-04T22:00:00Z". null for an empty or malformed value. */
export function providerLocalToUtcInstant(local: string, zone: string): string | null {
  const m = LOCAL.exec(local)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  let ms = guess - zoneOffsetMinutes(zone, guess) * 60_000
  // Across a daylight-saving change the offset at the guess can differ from the offset at the answer; take the answer's.
  ms = guess - zoneOffsetMinutes(zone, ms) * 60_000
  const t = new Date(ms)
  return `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())}T${two(t.getUTCHours())}:${two(t.getUTCMinutes())}:00Z`
}

/** A UTC instant as the datetime-local value its provider-zone wall clock shows: "2026-07-01T09:00". */
export function utcInstantToProviderLocal(iso: string, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(parseApiDate(iso))
  const v = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`
}

/** Whole minutes from `fromIso` to `toIso` (both instants), never negative. */
export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((parseApiDate(toIso).getTime() - parseApiDate(fromIso).getTime()) / 60_000))
}
