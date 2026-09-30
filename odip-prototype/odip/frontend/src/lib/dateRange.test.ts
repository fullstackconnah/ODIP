import { describe, it, expect } from 'vitest'
import { formatDateRange } from './dateRange'

// The en dash is U+2013; spelled out so a copy/paste to a hyphen fails the test.
const DASH = '–'

describe('formatDateRange', () => {
  it('collapses a same-month range to "14–17 Aug 2026" and keeps the year', () => {
    expect(formatDateRange('2026-08-14', '2026-08-17')).toBe(`14${DASH}17 Aug 2026`)
  })

  it('does not zero-pad the day', () => {
    expect(formatDateRange('2026-10-01', '2026-10-05')).toBe(`1${DASH}5 Oct 2026`)
  })

  it('names both months when a range crosses a month within a year', () => {
    expect(formatDateRange('2026-08-28', '2026-09-02')).toBe(`28 Aug ${DASH} 2 Sep 2026`)
  })

  it('names both years when a range crosses New Year', () => {
    expect(formatDateRange('2026-12-28', '2027-01-02')).toBe(`28 Dec 2026 ${DASH} 2 Jan 2027`)
  })

  it('shows a one-day range as a single date', () => {
    expect(formatDateRange('2026-08-14', '2026-08-14')).toBe('14 Aug 2026')
  })

  it('always spells September "Sep", whatever the ICU build says for en-AU', () => {
    expect(formatDateRange('2026-09-05', '2026-09-07')).toBe(`5${DASH}7 Sep 2026`)
  })

  it('falls back to the start alone when the end is missing or unparseable, and vice versa', () => {
    expect(formatDateRange('2026-08-14', undefined)).toBe('14 Aug 2026')
    expect(formatDateRange('2026-08-14', 'not-a-date')).toBe('14 Aug 2026')
    expect(formatDateRange(null, '2026-08-17')).toBe('17 Aug 2026')
  })

  it('returns an empty string when neither end parses, so the caller can drop the item', () => {
    expect(formatDateRange(undefined, undefined)).toBe('')
    expect(formatDateRange('', null)).toBe('')
    expect(formatDateRange('garbage', '2026-13-40x')).toBe('')
  })

  it('reads the written calendar date, not a timezone-shifted instant', () => {
    // A DateOnly is "2026-08-14" in every zone; parsing it as UTC midnight would show the 13th west of UTC.
    // The time-of-day and any offset after the date are ignored on purpose.
    expect(formatDateRange('2026-08-14T00:00:00', '2026-08-17T00:00:00')).toBe(`14${DASH}17 Aug 2026`)
    expect(formatDateRange('2026-08-14T23:59:59Z', '2026-08-14T00:00:00Z')).toBe('14 Aug 2026')
  })

  it('rejects an impossible month rather than printing "undefined"', () => {
    expect(formatDateRange('2026-00-10', '2026-13-10')).toBe('')
  })
})
