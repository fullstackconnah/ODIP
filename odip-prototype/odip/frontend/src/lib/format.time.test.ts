import { afterEach, describe, expect, it } from 'vitest'
import { formatAge, formatDateTimeAu, formatRelative } from './format'
import { restoreZone, setZone } from '@/test/timeZone'

// L4-01 / L4-02: an INSTANT must read the same in every browser zone. The API now writes instants as UTC with a Z, but an older response, a
// cached one or a hand-built fixture can still arrive zone-less; the helpers read a zone-less instant as UTC, never as the viewer's local
// time, which in Sydney is 10-11 hours wrong ("Last dose 10 hrs ago" for a dose given 10 minutes ago).
afterEach(restoreZone)

const ZONES = ['UTC', 'Australia/Sydney', 'America/New_York'] as const
// The same instant (2026-10-03 05:00 UTC, i.e. 15:00 Sydney) in every shape the app can meet it in.
const SHAPES = [
  ['with Z', '2026-10-03T05:00:00Z'],
  ['zone-less (the old wire shape)', '2026-10-03T05:00:00'],
  ['zone-less with 7 fraction digits (what .NET writes)', '2026-10-03T05:00:00.1234567'],
  ['with an offset', '2026-10-03T15:00:00+10:00'],
] as const
const NOW = new Date('2026-10-03T05:10:30Z') // ten and a half minutes after the instant (the fraction digits of the wire shape must not tip it under ten)

describe.each(ZONES)('instant formatters in %s', zone => {
  it.each(SHAPES)('formatRelative reads an instant %s as 10 minutes ago', (_label, value) => {
    if (!setZone(zone)) return
    expect(formatRelative(value, { style: 'long', now: NOW })).toBe('10 min ago')
    expect(formatRelative(value, { style: 'compact', now: NOW })).toBe('10m ago')
  })

  it.each(SHAPES)('formatAge reads an instant %s as under an hour old', (_label, value) => {
    if (!setZone(zone)) return
    expect(formatAge(value, { now: NOW })).toBe('<1h')
  })

  it.each(SHAPES)('formatDateTimeAu prints an instant %s as the same moment in the viewer zone', (_label, value) => {
    if (!setZone(zone)) return
    const expected = new Date('2026-10-03T05:00:00Z').toLocaleString('en-AU', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    expect(formatDateTimeAu(value)).toBe(expected)
  })
})

describe('a date-only value is still a calendar day', () => {
  it('counts calendar days, not 24-hour blocks, across the Sydney clock change', () => {
    if (!setZone('Australia/Sydney')) return
    expect(formatRelative('2026-10-04', { style: 'long', now: new Date(2026, 9, 3, 23, 30) })).toBe('in 1 day')
  })
})
