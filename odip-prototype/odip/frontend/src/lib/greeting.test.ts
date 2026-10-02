import { afterEach, describe, expect, it } from 'vitest'
import { dayPartOf, firstNameOf, formatToday, greetingFor } from './greeting'
import { restoreZone, setZone } from '@/test/timeZone'

afterEach(restoreZone)

// Local wall-clock times (the Date constructor reads its fields in the zone the test process runs in), so these hold in every zone.
const at = (hour: number, minute = 0) => new Date(2026, 9, 2, hour, minute)

describe('dayPartOf', () => {
  it.each([
    [0, 'morning'],
    [5, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [23, 'evening'],
  ] as const)('reads %i:00 as the %s', (hour, expected) => {
    expect(dayPartOf(at(hour))).toBe(expected)
  })

  it('turns over on the hour, not a minute early or late', () => {
    expect(dayPartOf(at(11, 59))).toBe('morning')
    expect(dayPartOf(at(12, 0))).toBe('afternoon')
    expect(dayPartOf(at(17, 59))).toBe('afternoon')
    expect(dayPartOf(at(18, 0))).toBe('evening')
  })
})

describe('firstNameOf', () => {
  it.each([
    ['Sarah Mitchell', 'Sarah'],
    ['  Sarah   Mitchell  ', 'Sarah'],
    ['Sarah', 'Sarah'],
    ['Mary Jane Smith', 'Mary'],
    ['', ''],
    ['   ', ''],
    [null, ''],
    [undefined, ''],
  ] as const)('takes %j as "%s"', (fullName, expected) => {
    expect(firstNameOf(fullName)).toBe(expected)
  })
})

describe('greetingFor', () => {
  it('greets by time of day and first name', () => {
    expect(greetingFor(at(9, 30), 'Sarah Mitchell')).toBe('Good morning, Sarah')
    expect(greetingFor(at(14), 'Sarah Mitchell')).toBe('Good afternoon, Sarah')
    expect(greetingFor(at(19), 'Sarah Mitchell')).toBe('Good evening, Sarah')
  })

  it('greets without a name rather than inventing one or leaving a dangling comma', () => {
    expect(greetingFor(at(9))).toBe('Good morning')
    expect(greetingFor(at(9), null)).toBe('Good morning')
    expect(greetingFor(at(9), '  ')).toBe('Good morning')
  })
})

describe('formatToday', () => {
  it.each([
    [new Date(2026, 9, 2, 9, 30), 'Friday 2 October'],
    [new Date(2026, 0, 1, 0, 0), 'Thursday 1 January'],
    [new Date(2026, 11, 31, 23, 59), 'Thursday 31 December'],
    [new Date(2028, 1, 29, 12, 0), 'Tuesday 29 February'], // a leap day
    [new Date(2026, 8, 5, 12, 0), 'Saturday 5 September'], // spelled out, never "Sept" or "Sep"
  ] as const)('names %s "%s"', (when, expected) => {
    expect(formatToday(when)).toBe(expected)
  })

  it('gives nothing for an invalid Date, so the caller can drop it', () => {
    expect(formatToday(new Date('nonsense'))).toBe('')
  })
})

// The same instant is a different morning in different places: 2026-10-01 23:30 UTC is Friday 9:30 am in Sydney (UTC+10) but still Thursday evening in
// UTC and in New York. The greeting and the date follow the viewer's wall clock, and they follow it TOGETHER: never "Good morning" over yesterday's date.
describe('the greeting and the date follow the viewer zone', () => {
  const INSTANT = new Date('2026-10-01T23:30:00Z')

  it.each([
    ['Australia/Sydney', 'Good morning, Sarah', 'Friday 2 October'],
    ['UTC', 'Good evening, Sarah', 'Thursday 1 October'],
    ['America/New_York', 'Good evening, Sarah', 'Thursday 1 October'],
    ['Pacific/Auckland', 'Good afternoon, Sarah', 'Friday 2 October'], // UTC+13 in daylight time: 12:30
  ] as const)('reads that instant in %s as "%s", %s', (zone, greeting, date) => {
    if (!setZone(zone)) return
    expect(greetingFor(INSTANT, 'Sarah Mitchell')).toBe(greeting)
    expect(formatToday(INSTANT)).toBe(date)
  })

  it('keeps the date across the Sydney clock change (Sunday 4 October 2026, 02:00 becomes 03:00)', () => {
    if (!setZone('Australia/Sydney')) return
    expect(formatToday(new Date('2026-10-03T15:59:00Z'))).toBe('Sunday 4 October') // 01:59, an hour before the change
    expect(formatToday(new Date('2026-10-03T16:30:00Z'))).toBe('Sunday 4 October') // 03:30, after it
    expect(formatToday(new Date('2026-10-04T12:59:00Z'))).toBe('Sunday 4 October') // 23:59 the same day
    expect(formatToday(new Date('2026-10-04T13:00:00Z'))).toBe('Monday 5 October') // midnight
    expect(greetingFor(new Date('2026-10-03T16:30:00Z'), 'Sarah Mitchell')).toBe('Good morning, Sarah')
  })
})
