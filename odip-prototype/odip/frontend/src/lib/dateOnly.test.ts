import { afterEach, describe, expect, it } from 'vitest'
import { calendarDaysUntil, dayNumberOf, isDateOnly, parseDateOnly } from './dateOnly'
import { restoreZone, setZone } from '@/test/timeZone'

// The gate runs in UTC and a developer machine in Sydney, so every zone-sensitive case sets the zone itself (src/test/timeZone.ts) and the
// suite proves the same answer in all of them. A zone this runtime will not switch to is skipped, never faked.
afterEach(restoreZone)

const day = (iso: string) => parseDateOnly(iso)!

describe('isDateOnly', () => {
  it.each([
    ['2026-08-14', true],
    ['2026-08-14T00:00:00', false],
    ['2026-08-14T00:00:00Z', false],
    ['2026-8-14', false],
    ['14/08/2026', false],
    ['', false],
  ])('%j -> %s', (value, expected) => {
    expect(isDateOnly(value)).toBe(expected)
  })
})

describe('parseDateOnly', () => {
  it('reads the calendar day as a whole number of days since 1970-01-01', () => {
    expect(parseDateOnly('1970-01-01')).toBe(0)
    expect(parseDateOnly('1970-01-02')).toBe(1)
    expect(parseDateOnly('1969-12-31')).toBe(-1)
    expect(Number.isInteger(parseDateOnly('2026-10-04'))).toBe(true)
  })

  it('ignores a time part after the date, the same rule as formatDateRange', () => {
    expect(parseDateOnly('2026-08-14T23:59:59Z')).toBe(parseDateOnly('2026-08-14'))
    expect(parseDateOnly('2026-08-14T00:00:00+10:00')).toBe(parseDateOnly('2026-08-14'))
  })

  it.each([
    ['a missing value', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['text', 'not-a-date'],
    ['a day-first date', '14/08/2026'],
    ['an impossible month', '2026-13-01'],
    ['month zero', '2026-00-10'],
    ['an impossible day', '2026-04-31'],
    ['February 30', '2026-02-30'],
    ['February 29 in a common year', '2027-02-29'],
    ['a fifth digit on the day', '2026-08-145'],
  ])('is null for %s', (_name, value) => {
    expect(parseDateOnly(value as string | null | undefined)).toBeNull()
  })

  it('accepts February 29 in a leap year and counts the leap day', () => {
    expect(parseDateOnly('2028-02-29')).not.toBeNull()
    expect(day('2028-03-01') - day('2028-02-28')).toBe(2)
    expect(day('2027-03-01') - day('2027-02-28')).toBe(1)
    expect(day('2100-03-01') - day('2100-02-28')).toBe(1) // 2100 is not a leap year
  })

  it('handles years below 100 without the Date.UTC two-digit-year rule', () => {
    expect(day('0099-01-01')).toBeLessThan(day('1900-01-01')) // Date.UTC(99, ...) would have read it as 1999
    expect(day('0099-01-02') - day('0099-01-01')).toBe(1)
  })
})

describe('dayNumberOf', () => {
  it('is the local calendar day of an instant, at both ends of the day', () => {
    expect(dayNumberOf(new Date(2026, 9, 1, 0, 0, 0, 0))).toBe(day('2026-10-01'))
    expect(dayNumberOf(new Date(2026, 9, 1, 12, 0))).toBe(day('2026-10-01'))
    expect(dayNumberOf(new Date(2026, 9, 1, 23, 59, 59, 999))).toBe(day('2026-10-01'))
    expect(dayNumberOf(new Date(2026, 9, 2, 0, 0, 0, 0))).toBe(day('2026-10-02'))
  })

  it('is null for an invalid Date', () => {
    expect(dayNumberOf(new Date('nope'))).toBeNull()
  })
})

describe('calendarDaysUntil', () => {
  const today = () => new Date(2026, 9, 1, 3, 40) // 1 Oct 2026, 03:40 local

  it.each([
    ['2026-10-01', 0],
    ['2026-10-02', 1],
    ['2026-09-30', -1],
    ['2026-10-11', 10],
    ['2026-11-01', 31],
    ['2027-10-01', 365],
    ['2026-09-01', -30],
    ['2025-10-01', -365],
  ])('%s is %i days from 1 Oct 2026', (target, expected) => {
    expect(calendarDaysUntil(target, today())).toBe(expected)
  })

  it('does not depend on the time of day of `today`', () => {
    for (const d of [new Date(2026, 9, 1, 0, 0, 0, 0), new Date(2026, 9, 1, 12, 0), new Date(2026, 9, 1, 23, 59, 59, 999)]) {
      expect(calendarDaysUntil('2026-10-02', d)).toBe(1)
      expect(calendarDaysUntil('2026-10-01', d)).toBe(0)
      expect(calendarDaysUntil('2026-09-30', d)).toBe(-1)
    }
  })

  it('crosses a month, a year and a leap day exactly', () => {
    expect(calendarDaysUntil('2027-01-01', new Date(2026, 11, 31, 23, 59))).toBe(1)
    expect(calendarDaysUntil('2028-03-01', new Date(2028, 1, 28, 9, 0))).toBe(2)
    expect(calendarDaysUntil('2027-03-01', new Date(2027, 1, 28, 9, 0))).toBe(1)
  })

  it('takes "today" as a YYYY-MM-DD string when the caller knows the provider\'s day', () => {
    expect(calendarDaysUntil('2026-10-11', '2026-10-01')).toBe(10)
    expect(calendarDaysUntil('2026-09-30', '2026-10-01')).toBe(-1)
  })

  it('is null when either side is not a usable date', () => {
    expect(calendarDaysUntil(null, today())).toBeNull()
    expect(calendarDaysUntil('', today())).toBeNull()
    expect(calendarDaysUntil('2026-02-30', today())).toBeNull()
    expect(calendarDaysUntil('2026-10-01', 'garbage')).toBeNull()
    expect(calendarDaysUntil('2026-10-01', new Date('nope'))).toBeNull()
  })

  it('defaults "today" to the current local day', () => {
    const now = new Date()
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(calendarDaysUntil(iso(now))).toBe(0)
  })
})

// [zone, local "today" (y, m0, d, h, min), target day, expected days, why this row is here]
const DST_ROWS: [string, [number, number, number, number, number], string, number, string][] = [
  ['Australia/Sydney', [2026, 9, 1, 3, 40], '2026-10-11', 10, 'the day-count that used to floor to 9 (clocks go forward on 4 Oct)'],
  ['Australia/Sydney', [2026, 9, 1, 3, 40], '2026-10-05', 4, 'first full day after the change'],
  ['Australia/Sydney', [2026, 9, 3, 23, 59], '2026-10-04', 1, 'the night before the change'],
  ['Australia/Sydney', [2026, 9, 4, 0, 30], '2026-10-05', 1, 'the 23-hour day: tomorrow used to read as "today"'],
  ['Australia/Sydney', [2026, 9, 4, 3, 30], '2026-10-04', 0, 'after the clocks moved (03:30 is 02:30 AEST)'],
  ['Australia/Sydney', [2026, 9, 4, 23, 59], '2026-10-03', -1, 'yesterday, from the end of the short day'],
  ['Australia/Sydney', [2027, 3, 3, 12, 0], '2027-04-10', 7, 'clocks go back on 4 Apr 2027'],
  ['Australia/Sydney', [2027, 3, 4, 12, 0], '2027-04-03', -1, 'yesterday across the 25-hour day'],
  ['Australia/Sydney', [2027, 3, 4, 12, 0], '2027-04-05', 1, 'tomorrow across the 25-hour day'],
  ['Australia/Lord_Howe', [2026, 9, 3, 12, 0], '2026-10-05', 2, 'a 30-minute change'],
  ['Pacific/Auckland', [2026, 8, 26, 12, 0], '2026-10-06', 10, 'clocks go forward on 27 Sep 2026'],
  ['America/New_York', [2026, 2, 7, 12, 0], '2026-03-17', 10, 'clocks go forward on 8 Mar 2026'],
  ['America/New_York', [2026, 9, 31, 12, 0], '2026-11-10', 10, 'clocks go back on 1 Nov 2026'],
  ['Europe/London', [2026, 2, 28, 12, 0], '2026-04-07', 10, 'clocks go forward on 29 Mar 2026'],
  ['Europe/London', [2026, 9, 24, 0, 30], '2026-10-26', 2, 'clocks go back on 25 Oct 2026'],
  ['Australia/Brisbane', [2026, 9, 1, 3, 40], '2026-10-11', 10, 'no daylight saving'],
  ['UTC', [2026, 9, 1, 3, 40], '2026-10-11', 10, 'the CI zone'],
]

describe('across daylight-saving changes and zones', () => {
  it.each(DST_ROWS)('%s %j -> %s is %i days (%s)', (zone, [y, m, d, h, min], target, expected) => {
    if (!setZone(zone)) return // this runtime cannot switch zones; the UTC gate still runs the other rows
    expect(calendarDaysUntil(target, new Date(y, m, d, h, min))).toBe(expected)
  })

  it('gives the same answer in every zone that can be switched to', () => {
    const answers = new Set<number | null>()
    for (const zone of ['UTC', 'Australia/Sydney', 'Australia/Brisbane', 'America/New_York', 'Europe/London', 'Pacific/Auckland', 'America/St_Johns']) {
      if (!setZone(zone)) continue
      answers.add(calendarDaysUntil('2026-10-11', new Date(2026, 9, 1, 3, 40)))
    }
    expect([...answers]).toEqual([10])
  })
})
