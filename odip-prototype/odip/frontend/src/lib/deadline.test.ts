import { afterEach, describe, expect, it } from 'vitest'
import { DEADLINE_TONE, deadlineLabel, deadlineState, isDeadlineIssue, type DeadlineState, type DeadlineStatus } from './deadline'
import { TONE } from './tone'
import { restoreZone, setZone } from '@/test/timeZone'

// Sydney's clocks go forward on Sun 4 Oct 2026: from 1 Oct, local midnight on the 11th is only 239 hours away, so `floor(ms / 86 400 000)`
// says 9. The zone is set here (src/test/timeZone.ts), so the suite proves the fix whatever zone the gate runs in.
afterEach(restoreZone)

const today = () => new Date(2026, 9, 1, 3, 40) // 1 Oct 2026, 03:40 local
const at = (iso: string | null | undefined, warnDays = 30, from: Date | string = today()) => deadlineState(iso, { warnDays, today: from })

describe('deadlineState', () => {
  // [date, warnDays, status, days]
  it.each<[string | null | undefined, number, DeadlineStatus, number | null]>([
    [null, 30, 'none', null],
    [undefined, 30, 'none', null],
    ['', 30, 'none', null],
    ['not-a-date', 30, 'none', null],
    ['2026-02-30', 30, 'none', null],
    ['2026-09-01', 30, 'overdue', -30],
    ['2026-09-30', 30, 'overdue', -1],
    ['2026-10-01', 30, 'today', 0],
    ['2026-10-01', 0, 'today', 0],
    ['2026-10-02', 30, 'soon', 1],
    ['2026-10-02', 0, 'ok', 1],
    ['2026-10-11', 30, 'soon', 10],
    ['2026-10-31', 30, 'soon', 30], // the last day of the window is still "soon"
    ['2026-11-01', 30, 'ok', 31], // the next day is fine
    ['2027-10-01', 30, 'ok', 365],
    ['2026-10-01', 60, 'today', 0],
    ['2026-11-30', 60, 'soon', 60],
    ['2026-12-01', 60, 'ok', 61],
  ])('%j with a %i-day window is %s (%s days)', (date, warnDays, status, days) => {
    expect(at(date, warnDays)).toEqual({ status, days })
  })

  it('reads the date, not the clock: any time on the same day gives the same state', () => {
    for (const from of [new Date(2026, 9, 1, 0, 0, 0, 0), new Date(2026, 9, 1, 12, 0), new Date(2026, 9, 1, 23, 59, 59, 999)]) {
      expect(at('2026-10-01', 30, from)).toEqual({ status: 'today', days: 0 })
      expect(at('2026-10-02', 30, from)).toEqual({ status: 'soon', days: 1 })
      expect(at('2026-09-30', 30, from)).toEqual({ status: 'overdue', days: -1 })
    }
  })

  it('accepts a "YYYY-MM-DD" string for today, for a caller that knows the provider\'s day', () => {
    expect(at('2026-10-11', 30, '2026-10-01')).toEqual({ status: 'soon', days: 10 })
    expect(at('2026-09-30', 30, '2026-10-01')).toEqual({ status: 'overdue', days: -1 })
  })

  it('defaults today to the current day', () => {
    const now = new Date()
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(deadlineState(iso, { warnDays: 30 })).toEqual({ status: 'today', days: 0 })
  })

  it('ignores a time part on the date, like every other calendar date in the app', () => {
    expect(at('2026-10-11T00:00:00', 30)).toEqual({ status: 'soon', days: 10 })
  })

  // [zone, today (y, m0, d, h, min), date, status, days]
  it.each<[string, [number, number, number, number, number], string, DeadlineStatus, number]>([
    ['Australia/Sydney', [2026, 9, 1, 3, 40], '2026-10-11', 'soon', 10], // the regression: 9 before
    ['Australia/Sydney', [2026, 9, 3, 12, 0], '2026-10-04', 'soon', 1],
    ['Australia/Sydney', [2026, 9, 4, 0, 30], '2026-10-05', 'soon', 1], // tomorrow used to read "Expires today" on the 23-hour day
    ['Australia/Sydney', [2026, 9, 4, 12, 0], '2026-10-04', 'today', 0],
    ['Australia/Sydney', [2026, 9, 4, 12, 0], '2026-10-03', 'overdue', -1],
    ['Australia/Sydney', [2027, 3, 4, 12, 0], '2027-04-05', 'soon', 1],
    ['Australia/Sydney', [2027, 3, 4, 12, 0], '2027-04-03', 'overdue', -1],
    ['America/New_York', [2026, 2, 7, 12, 0], '2026-03-17', 'soon', 10],
    ['Europe/London', [2026, 9, 24, 0, 30], '2026-10-26', 'soon', 2],
    ['Pacific/Auckland', [2026, 8, 26, 12, 0], '2026-10-06', 'soon', 10],
    ['UTC', [2026, 9, 1, 3, 40], '2026-10-11', 'soon', 10],
  ])('in %s, from %j, %s is %s (%i days)', (zone, [y, m, d, h, min], date, status, days) => {
    if (!setZone(zone)) return // this runtime cannot switch zones
    expect(deadlineState(date, { warnDays: 30, today: new Date(y, m, d, h, min) })).toEqual({ status, days })
  })
})

describe('deadlineLabel', () => {
  const state = (status: DeadlineStatus, days: number | null): DeadlineState => ({ status, days })

  // [state, long, compact]
  it.each<[DeadlineState, string, string]>([
    [state('overdue', -3), 'Expired', 'Expired'],
    [state('today', 0), 'Expires today', 'Expires today'],
    [state('soon', 1), 'Expires in 1 day', '1 day'],
    [state('soon', 2), 'Expires in 2 days', '2 days'],
    [state('soon', 12), 'Expires in 12 days', '12 days'],
    [state('soon', 30), 'Expires in 30 days', '30 days'],
    [state('ok', 200), 'Current', 'Current'],
    [state('none', null), 'No date set', 'No date set'],
  ])('%j reads "%s" (long) and "%s" (compact)', (s, long, compact) => {
    expect(deadlineLabel(s, 'long')).toBe(long)
    expect(deadlineLabel(s, 'compact')).toBe(compact)
  })

  it('defaults to the long form', () => {
    expect(deadlineLabel(state('soon', 12))).toBe('Expires in 12 days')
  })

  it('uses human capitalisation: "Expired", never "EXPIRED"', () => {
    for (const style of ['long', 'compact'] as const) {
      expect(deadlineLabel(state('overdue', -1), style)).not.toMatch(/^[A-Z]+$/)
    }
  })

  it('labels the state deadlineState returns, end to end', () => {
    expect(deadlineLabel(at('2026-10-11'))).toBe('Expires in 10 days')
    expect(deadlineLabel(at('2026-10-01'))).toBe('Expires today')
    expect(deadlineLabel(at('2026-09-30'))).toBe('Expired')
    expect(deadlineLabel(at('2027-01-01'))).toBe('Current')
    expect(deadlineLabel(at(null))).toBe('No date set')
  })
})

describe('DEADLINE_TONE', () => {
  it('maps overdue to danger, today and soon to warning, ok to success, none to neutral', () => {
    expect(DEADLINE_TONE).toEqual({ overdue: 'danger', today: 'warning', soon: 'warning', ok: 'success', none: 'neutral' })
  })

  it('names only tones that exist in the tone table', () => {
    for (const tone of Object.values(DEADLINE_TONE)) expect(TONE[tone]).toBeDefined()
  })
})

describe('isDeadlineIssue', () => {
  it.each<[DeadlineStatus, boolean]>([
    ['overdue', true],
    ['today', true],
    ['soon', true],
    ['none', true],
    ['ok', false],
  ])('%s -> %s', (status, expected) => {
    expect(isDeadlineIssue({ status, days: null })).toBe(expected)
  })
})
