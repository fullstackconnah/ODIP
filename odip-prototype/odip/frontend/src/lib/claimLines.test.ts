import { describe, it, expect } from 'vitest'
import { dayTypeLabel, hasPartlyRejectedShift, isSleepoverLine, lineKindLabel, lineQuantity } from './claimLines'

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

describe('provider travel lines (travel plan T31)', () => {
  const km = { unit: 'E', shiftId: 's', hours: 12.87, supportItemCode: '04_799_0125_6_1' }
  it('reads the kilometre line as dollars, not nights, and is not a sleepover', () => {
    expect(isSleepoverLine(km)).toBe(false)
    expect(lineQuantity(km)).toBe('$12.87')
  })
  it('keeps a real sleepover line in nights', () => {
    expect(lineQuantity({ unit: 'E', shiftId: 's', hours: 1, supportItemCode: '04_103_0125_6_1' })).toBe('1 night')
  })
  it('labels the time line and the kilometre line', () => {
    expect(lineKindLabel({ ...km, claimType: 'ProviderTravel', dayType: 'Weekday' })).toBe('Provider travel')
    expect(lineKindLabel({ ...km, claimType: 'Standard', dayType: 'Weekday' })).toBe('Provider travel costs')
    expect(lineKindLabel({ unit: 'H', shiftId: 's', hours: 8, supportItemCode: '04_104_0125_6_1', claimType: 'Standard', dayType: 'Weekday' })).toBe('Weekday')
    expect(lineKindLabel({ unit: 'E', shiftId: 's', hours: 1, supportItemCode: '04_103_0125_6_1', claimType: 'Standard', dayType: 'Weekday' })).toBe('Sleepover')
  })
})
