import { describe, expect, it } from 'vitest'
import { addMonths } from './planQuote'
import { offeredKinds, periodAt, periodCount, type PeriodKind } from './agreementPeriods'

const FAR = '2040-12-31'

describe('period boundaries are worked out from the agreement start, on the calendar', () => {
  const table: Array<[string, PeriodKind, number, string, string]> = [
    ['2027-01-31', 'month', 0, '2027-01-31', '2027-02-27'],
    ['2027-01-31', 'month', 1, '2027-02-28', '2027-03-30'],
    ['2027-01-31', 'month', 2, '2027-03-31', '2027-04-29'],
    ['2027-01-31', 'month', 3, '2027-04-30', '2027-05-30'],
    ['2028-01-31', 'month', 0, '2028-01-31', '2028-02-28'],
    ['2028-01-31', 'month', 1, '2028-02-29', '2028-03-30'],
    ['2027-11-30', 'quarter', 0, '2027-11-30', '2028-02-28'],
    ['2027-11-30', 'quarter', 1, '2028-02-29', '2028-05-29'],
    ['2028-02-29', 'year', 0, '2028-02-29', '2029-02-27'],
    ['2028-02-29', 'year', 1, '2029-02-28', '2030-02-27'],
    ['2028-02-29', 'year', 4, '2032-02-29', '2033-02-27'],
    ['2027-02-22', 'fortnight', 0, '2027-02-22', '2027-03-07'],
    ['2028-02-22', 'fortnight', 0, '2028-02-22', '2028-03-06'],
  ]
  it.each(table)('%s %s %i runs %s to %s', (start, kind, k, from, to) => {
    expect(periodAt(kind, start, FAR, k)).toEqual({ from, to, part: false })
  })

  it('adds months with the missing day clamped to the month end, as date-fns and .NET do', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28')
    expect(addMonths('2028-02-29', 48)).toBe('2032-02-29')
  })
})

describe('the end of the agreement', () => {
  it('clamps the last period to the agreement end and marks it as a part period', () => {
    expect(periodCount('month', '2027-07-01', '2027-08-10')).toBe(2)
    expect(periodAt('month', '2027-07-01', '2027-08-10', 0)).toEqual({ from: '2027-07-01', to: '2027-07-31', part: false })
    expect(periodAt('month', '2027-07-01', '2027-08-10', 1)).toEqual({ from: '2027-08-01', to: '2027-08-10', part: true })
  })

  it('marks a last period that ends exactly on the agreement end as a whole period', () => {
    expect(periodCount('month', '2027-01-01', '2027-02-28')).toBe(2)
    expect(periodAt('month', '2027-01-01', '2027-02-28', 1)).toEqual({ from: '2027-02-01', to: '2027-02-28', part: false })
    expect(periodCount('fortnight', '2027-01-01', '2027-01-28')).toBe(2)
    expect(periodAt('fortnight', '2027-01-01', '2027-01-28', 1)).toEqual({ from: '2027-01-15', to: '2027-01-28', part: false })
  })

  it('counts a period that starts on the agreement end day, and not one that starts after it', () => {
    expect(periodCount('fortnight', '2027-01-01', '2027-01-15')).toBe(2)
    expect(periodCount('fortnight', '2027-01-01', '2027-01-14')).toBe(1)
  })

  it('offers only the kinds that cut the agreement into two or more periods', () => {
    expect(offeredKinds('2027-01-01', '2027-12-31')).toEqual(['fortnight', 'month', 'quarter'])
    expect(offeredKinds('2027-01-01', '2028-01-01')).toEqual(['fortnight', 'month', 'quarter', 'year'])
    expect(offeredKinds('2027-01-01', '2027-01-20')).toEqual(['fortnight'])
  })

  it('offers nothing for an agreement of 14 days or less', () => {
    expect(offeredKinds('2027-01-01', '2027-01-14')).toEqual([])
    expect(offeredKinds('2027-01-01', '2027-01-01')).toEqual([])
  })
})
