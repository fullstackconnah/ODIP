import { afterEach, describe, expect, it } from 'vitest'
import { restoreZone, setZone } from '@/test/timeZone'
import { defaultReportRange, MAX_REPORT_DAYS, reportRangeError } from './reportRange'

afterEach(restoreZone)

describe('defaultReportRange', () => {
  // 2026-10-25T13:30Z is Monday 00:30 in Sydney and still Sunday 13:30 in UTC, so the viewer's own calendar decides.
  const instant = new Date('2026-10-25T13:30:00Z')

  it.each([
    ['Australia/Sydney', '2026-09-28', '2026-10-25'],
    ['UTC', '2026-09-21', '2026-10-18'],
  ])('is the four Monday-to-Sunday weeks before today in %s', (zone, from, to) => {
    if (!setZone(zone)) return
    expect(defaultReportRange(instant)).toEqual({ from, to })
  })

  it('starts on a Monday and ends on a Sunday for every weekday', () => {
    for (let d = 0; d < 7; d++) {
      const { from, to } = defaultReportRange(new Date(2026, 9, 26 + d, 12))
      expect(new Date(`${from}T00:00:00Z`).getUTCDay()).toBe(1)
      expect(new Date(`${to}T00:00:00Z`).getUTCDay()).toBe(0)
    }
  })
})

describe('reportRangeError', () => {
  it('accepts a valid range, one day, and exactly 366 days', () => {
    expect(reportRangeError('2026-10-19', '2026-11-01')).toBeNull()
    expect(reportRangeError('2026-10-19', '2026-10-19')).toBeNull()
    expect(reportRangeError('2024-01-01', '2024-12-31')).toBeNull()
  })

  it('asks for a date when either is missing or not a date', () => {
    expect(reportRangeError('', '2026-11-01')).toBe('Pick a date.')
    expect(reportRangeError('2026-10-19', '')).toBe('Pick a date.')
  })

  it('refuses a To before the From', () => {
    expect(reportRangeError('2026-11-01', '2026-10-19')).toBe('The To date must be on or after the From date.')
  })

  it('refuses 367 days and says how long the range is', () => {
    expect(reportRangeError('2024-01-01', '2025-01-01')).toBe('Pick a range of 366 days or less. This one is 367 days.')
  })

  it.each(['Australia/Sydney', 'UTC'])('counts a range across the April clock change as whole days in %s', (zone) => {
    if (!setZone(zone)) return
    expect(reportRangeError('2025-04-05', '2026-04-05')).toBeNull()
    expect(reportRangeError('2025-04-04', '2026-04-05')).toBe('Pick a range of 366 days or less. This one is 367 days.')
  })

  it('exports the limit', () => {
    expect(MAX_REPORT_DAYS).toBe(366)
  })
})
