import { describe, it, expect } from 'vitest'
import { dayTypeLabel, hasPartlyRejectedShift, lineQuantity } from './claimLines'

describe('lineQuantity', () => {
  it('reads a sleepover shift line in nights', () => {
    expect(lineQuantity({ unit: 'E', shiftId: 's', hours: 1 })).toBe('1 night')
    expect(lineQuantity({ unit: 'E', shiftId: 's', hours: 2 })).toBe('2 nights')
  })
  it('reads anything else in hours', () => {
    expect(lineQuantity({ unit: 'E', shiftId: undefined, hours: 1 })).toBe('1h')
    expect(lineQuantity({ unit: 'H', shiftId: 's', hours: 8 })).toBe('8h')
    expect(lineQuantity({ hours: 8 })).toBe('8h')
  })
})

describe('dayTypeLabel', () => {
  it('spaces the day types', () => {
    expect(dayTypeLabel('WeekdayNight')).toBe('Weekday Night')
    expect(dayTypeLabel('Other')).toBe('Other')
  })
})

describe('hasPartlyRejectedShift', () => {
  const line = (shiftId: string | undefined, status: string) => ({ shiftId, status }) as Parameters<typeof hasPartlyRejectedShift>[0][number]
  it('is true when one line of a shift is rejected and another is not', () => {
    expect(hasPartlyRejectedShift([line('a', 'Rejected'), line('a', 'Submitted')])).toBe(true)
  })
  it('is false when the whole shift is rejected, or the rejected line is another shift or a trip', () => {
    expect(hasPartlyRejectedShift([line('a', 'Rejected'), line('a', 'Rejected')])).toBe(false)
    expect(hasPartlyRejectedShift([line('a', 'Rejected'), line('b', 'Submitted'), line(undefined, 'Submitted')])).toBe(false)
  })
})
