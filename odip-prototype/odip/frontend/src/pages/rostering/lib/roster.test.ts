import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  countPatternOccurrences,
  weekStartOf,
  shiftWeek,
  daysOfWeek,
  isToday,
  formatShiftRange,
  formatShiftTimeRange,
} from './roster'

describe('countPatternOccurrences', () => {
  // Hand-synced client port of the backend ShiftPatternExpander — the most drift-prone code in
  // the rostering module, so its edge cases are worth pinning down explicitly.
  const basePattern = {
    dayOfWeek: 'Monday',
    effectiveFrom: '2026-01-01',
    effectiveTo: null as string | null,
    isActive: true,
  }

  it('returns 0 for an inactive pattern regardless of range', () => {
    const count = countPatternOccurrences({ ...basePattern, isActive: false }, '2026-01-01', '2026-03-01')
    expect(count).toBe(0)
  })

  it('treats effectiveTo as inclusive', () => {
    // Monday 2026-01-05 is the only Monday in [2026-01-01, 2026-01-05]. effectiveTo lands
    // exactly on that Monday — it must still be counted, not excluded as an exclusive bound.
    const count = countPatternOccurrences(
      { ...basePattern, effectiveFrom: '2026-01-01', effectiveTo: '2026-01-05' },
      '2026-01-01',
      '2026-01-31',
    )
    expect(count).toBe(1)
  })

  it('excludes the day immediately after effectiveTo', () => {
    // Same pattern, but effectiveTo is one day short of the next Monday — count must drop to 0.
    const count = countPatternOccurrences(
      { ...basePattern, effectiveFrom: '2026-01-01', effectiveTo: '2026-01-04' },
      '2026-01-01',
      '2026-01-31',
    )
    expect(count).toBe(0)
  })

  it('only counts the matching day-of-week, not every day in range', () => {
    // A full 4-week range contains 28 days but only 4 Mondays.
    const count = countPatternOccurrences(basePattern, '2026-01-01', '2026-01-28')
    expect(count).toBe(4)
  })

  it('counts a different day-of-week correctly within the same range', () => {
    // 2026-01-01 is a Thursday; the same 4-week range should also contain exactly 4 Thursdays.
    const count = countPatternOccurrences({ ...basePattern, dayOfWeek: 'Thursday' }, '2026-01-01', '2026-01-28')
    expect(count).toBe(4)
  })

  it('returns 0 when the query range is entirely before effectiveFrom', () => {
    const count = countPatternOccurrences(
      { ...basePattern, effectiveFrom: '2026-06-01' },
      '2026-01-01',
      '2026-01-31',
    )
    expect(count).toBe(0)
  })

  it('returns 0 when from is after to', () => {
    const count = countPatternOccurrences(basePattern, '2026-03-01', '2026-01-01')
    expect(count).toBe(0)
  })
})

describe('week/date helpers', () => {
  it('weekStartOf resolves to the Monday of the containing week', () => {
    // 2026-08-20 is a Thursday; the Monday of that week is 2026-08-17.
    expect(weekStartOf(new Date('2026-08-20T12:00:00'))).toBe('2026-08-17')
  })

  it('weekStartOf pins to the same Monday when already on it', () => {
    expect(weekStartOf(new Date('2026-08-17T00:00:00'))).toBe('2026-08-17')
  })

  it('shiftWeek moves forward and backward by whole weeks', () => {
    expect(shiftWeek('2026-08-17', 1)).toBe('2026-08-24')
    expect(shiftWeek('2026-08-17', -1)).toBe('2026-08-10')
  })

  it('daysOfWeek returns the 7 consecutive ISO dates starting Monday', () => {
    expect(daysOfWeek('2026-08-17')).toEqual([
      '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20',
      '2026-08-21', '2026-08-22', '2026-08-23',
    ])
  })

  describe('isToday', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('is true for the current date', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-20T09:00:00'))
      expect(isToday('2026-08-20')).toBe(true)
    })

    it('is false for a different date', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-20T09:00:00'))
      expect(isToday('2026-08-21')).toBe(false)
    })
  })
})

describe('formatShiftRange / formatShiftTimeRange', () => {
  it('formats a same-day range without a suffix', () => {
    expect(formatShiftTimeRange('09:00:00', '17:00:00')).toBe('9am–5pm')
    expect(formatShiftRange('09:00:00', '17:00:00', false)).toBe('9am–5pm')
  })

  it('appends the +1 suffix only via formatShiftRange, for an overnight shift', () => {
    expect(formatShiftRange('22:00:00', '06:00:00', true)).toBe('10pm–6am +1')
    // The compact variant deliberately omits the suffix — callers render their own indicator.
    expect(formatShiftTimeRange('22:00:00', '06:00:00')).toBe('10pm–6am')
  })

  it('renders on-the-hour minutes without :00 padding', () => {
    expect(formatShiftTimeRange('13:30:00', '15:00:00')).toBe('1:30pm–3pm')
  })
})
