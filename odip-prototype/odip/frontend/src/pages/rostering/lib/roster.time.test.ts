import { afterEach, describe, expect, it } from 'vitest'
import { formatElapsedSince } from './roster'
import { restoreZone, setZone } from '@/test/timeZone'

afterEach(restoreZone)

// L4-02: "In progress, started Xh Ym ago" on the worker's shift card. ShiftCompletion.ActualStart is a UTC instant. A worker who started 10
// minutes ago and reloaded in Sydney saw "10h 10m", because the zone-less instant was read as local time. The API sends the Z now; the
// helper must be right for it and for the old zone-less shape, in every zone.
describe.each(['Australia/Sydney', 'UTC', 'America/New_York'])('formatElapsedSince in %s', zone => {
  const NOW = new Date('2026-10-03T05:10:30Z')

  it.each([
    ['with Z', '2026-10-03T05:00:00.1234567Z'],
    ['zone-less (the old wire shape)', '2026-10-03T05:00:00.1234567'],
    ['with an offset', '2026-10-03T15:00:00+10:00'],
  ])('reads a start %s ten minutes ago as 10 min', (_label, actualStart) => {
    if (!setZone(zone)) return
    expect(formatElapsedSince(actualStart, NOW)).toBe('10 min')
  })

  it('reads a start 1h 5m ago as 1h 5m', () => {
    if (!setZone(zone)) return
    expect(formatElapsedSince('2026-10-03T04:05:00', NOW)).toBe('1h 5m')
  })
})
