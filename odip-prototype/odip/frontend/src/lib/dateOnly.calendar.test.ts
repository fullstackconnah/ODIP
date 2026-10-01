import { afterEach, describe, expect, it } from 'vitest'
import { eachDay, formatDayNumber, localIsoDate, parseDateOnly } from './dateOnly'
import { restoreZone, setZone } from '@/test/timeZone'

// L4-05 (the date a task was completed) and L4-03 (nights across the clock change) both need a calendar date that is never read through
// toISOString(), which is the UTC date: before 10:00 (11:00 in daylight time) in Sydney that is yesterday.
afterEach(restoreZone)

describe('localIsoDate', () => {
  // Components, not Dates: a Date built here would be created in the zone the process started in, before setZone runs.
  it.each([
    ['Australia/Sydney', [2026, 9, 3, 8, 0], '2026-10-03'],  // 22:00Z on the 2nd
    ['Australia/Sydney', [2026, 9, 5, 8, 0], '2026-10-05'],  // 21:00Z on the 4th (daylight time)
    ['Australia/Sydney', [2026, 9, 3, 0, 5], '2026-10-03'],
    ['Australia/Sydney', [2026, 9, 3, 23, 55], '2026-10-03'],
    ['UTC', [2026, 9, 3, 8, 0], '2026-10-03'],
    ['America/New_York', [2026, 9, 3, 22, 0], '2026-10-03'], // 02:00Z on the 4th
  ] as const)('%s %j is %s', (zone, [y, m, d, h, min], expected) => {
    if (!setZone(zone)) return
    expect(localIsoDate(new Date(y, m, d, h, min))).toBe(expected)
  })
})

describe('formatDayNumber', () => {
  it('is the inverse of parseDateOnly', () => {
    for (const iso of ['2026-10-03', '2026-10-04', '2027-04-04', '2026-02-28', '2028-02-29']) {
      expect(formatDayNumber(parseDateOnly(iso)!)).toBe(iso)
    }
  })
})

describe('eachDay', () => {
  it.each(['UTC', 'Australia/Sydney', 'Australia/Lord_Howe', 'America/New_York'])('lists the days from 1 to 7 Oct 2026 in %s, the clock change included', zone => {
    if (!setZone(zone)) return
    expect(eachDay('2026-10-01', '2026-10-08')).toEqual([
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
    ])
  })

  it('excludes the end day, is empty for an empty or backwards range, and for an unusable date', () => {
    expect(eachDay('2026-10-03', '2026-10-03')).toEqual([])
    expect(eachDay('2026-10-05', '2026-10-03')).toEqual([])
    expect(eachDay('', '2026-10-03')).toEqual([])
    expect(eachDay('2026-10-03', 'nonsense')).toEqual([])
  })

  it('reads the day at the front of a date-time string (a DateTime? that holds a date)', () => {
    expect(eachDay('2026-10-01T00:00:00', '2026-10-03T00:00:00')).toEqual(['2026-10-01', '2026-10-02'])
  })
})
