import { describe, it, expect } from 'vitest'
import { seriesDates, seriesCadence, seriesSummary, seriesOverviewLine, seriesLastDay } from './groupActivitySeries'

describe('seriesDates mirrors the server', () => {
  it('weekly, fortnightly and monthly from Tue 2026-11-17 to 2027-03-09 make 17, 9 and 4', () => {
    expect(seriesDates('Weekly', '2026-11-17', '2027-03-09')).toHaveLength(17)
    expect(seriesDates('Fortnightly', '2026-11-17', '2027-03-09')).toHaveLength(9)
    expect(seriesDates('Monthly', '2026-11-17', '2027-03-09')).toEqual(['2026-11-17', '2026-12-15', '2027-01-19', '2027-02-16'])
  })
  it('weekly steps 7 days and fortnightly 14 from the start; the end date counts', () => {
    expect(seriesDates('Weekly', '2026-11-17', '2026-12-01')).toEqual(['2026-11-17', '2026-11-24', '2026-12-01'])
    expect(seriesDates('Fortnightly', '2026-11-17', '2026-12-01')).toEqual(['2026-11-17', '2026-12-01'])
    expect(seriesDates('Weekly', '2026-11-17', '2026-11-30')).toHaveLength(2)
  })
  it('a 5th-weekday start gives the last such weekday of each month', () => {
    expect(seriesDates('Monthly', '2026-10-30', '2027-03-09')).toEqual(['2026-10-30', '2026-11-27', '2026-12-25', '2027-01-29', '2027-02-26'])
  })
  it('crosses the Sydney clock change without shifting a day', () => {
    expect(seriesDates('Weekly', '2026-09-29', '2026-10-13')).toEqual(['2026-09-29', '2026-10-06', '2026-10-13'])
  })
  it('an end before the start, or a bad date, gives none', () => {
    expect(seriesDates('Weekly', '2026-11-17', '2026-11-16')).toEqual([])
    expect(seriesDates('Weekly', '', '2026-11-16')).toEqual([])
    expect(seriesDates('Weekly', '2026-11-17', '')).toEqual([])
  })
})

describe('series wording', () => {
  it('names the cadence from the start date', () => {
    expect(seriesCadence('Weekly', '2026-11-17')).toBe('Every Tuesday')
    expect(seriesCadence('Fortnightly', '2026-11-17')).toBe('Every second Tuesday')
    expect(seriesCadence('Monthly', '2026-11-17')).toBe('3rd Tuesday of each month')
    expect(seriesCadence('Monthly', '2026-10-30')).toBe('Last Friday of each month')
  })
  it('summary and overview lines', () => {
    expect(seriesSummary('Weekly', '2026-11-17', '2027-03-09')).toBe('Every Tuesday until 9 Mar 2027 · 17 activities')
    expect(seriesSummary('Monthly', '2026-11-17', '2026-11-20')).toBe('3rd Tuesday of each month until 20 Nov 2026 · 1 activity')
    expect(seriesOverviewLine({ interval: 'Weekly', startDate: '2026-11-17', endDate: '2027-03-09' })).toBe('Repeats every Tuesday until 9 Mar 2027')
    expect(seriesOverviewLine({ interval: 'Fortnightly', startDate: '2026-11-17', endDate: '2027-03-09' })).toBe('Repeats every second Tuesday until 9 Mar 2027')
    expect(seriesOverviewLine({ interval: 'Monthly', startDate: '2026-10-30', endDate: '2027-03-09' })).toBe('Repeats on the last Friday of each month until 9 Mar 2027')
  })
  it('the last day a series can reach is the date plus 400 days', () => {
    expect(seriesLastDay('2026-11-17')).toBe('2027-12-22')
  })
})
