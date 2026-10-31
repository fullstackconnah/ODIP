import { describe, expect, it } from 'vitest'
import type { RosterFillDto, RosterFillWeekDto } from '@/api/types'
import { detailLine, fillSentence, hoursText, isFirstWeek, liveLine, readoutRows, tableRows, weekLabel, yearBreakIndex } from './rosterFill'

const week = (weekStart: string, shifts = 0, open = 0, draft = 0): RosterFillWeekDto =>
  ({ weekStart, shifts, filled: shifts - open, open, hoursFilled: (shifts - open) * 8, hoursOpen: open * 8, draft })
const mondays = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21']
const data = (weeks: RosterFillWeekDto[]): RosterFillDto => ({ today: '2026-11-04', weeks })
const sparse = (over: Record<number, RosterFillWeekDto>) => mondays.map((m, i) => over[i] ?? week(m))

describe('fillSentence', () => {
  it('says so when nothing is rostered', () => {
    expect(fillSentence(data(mondays.map(m => week(m))))).toBe('Nothing is rostered for the next 8 weeks yet.')
  })
  it('names the one rostered week, filled and open', () => {
    expect(fillSentence(data(sparse({ 2: week(mondays[2], 24, 6) })))).toBe('Only the week of 16 Nov has shifts so far: 18 of 24 filled, 6 open.')
  })
  it('one rostered week, all filled: plural and one-shift forms', () => {
    expect(fillSentence(data(sparse({ 0: week(mondays[0], 5) })))).toBe('Only the week of 2 Nov has shifts so far, and all 5 are filled.')
    expect(fillSentence(data(sparse({ 0: week(mondays[0], 1) })))).toBe('Only the week of 2 Nov has shifts so far, and its one shift is filled.')
  })
  it('all filled across several weeks', () => {
    expect(fillSentence(data(mondays.map(m => week(m, 4))))).toBe('All 32 shifts in the next 8 weeks are filled.')
  })
  it('one open shift, then the most-open week with a tie going to the earliest', () => {
    expect(fillSentence(data(sparse({ 0: week(mondays[0], 4), 1: week(mondays[1], 4, 1) })))).toContain('1 of the 8 shifts in the next 8 weeks is open, in the week of 9 Nov.')
    const s = fillSentence(data(sparse({ 0: week(mondays[0], 4, 2), 1: week(mondays[1], 4, 2) })))
    expect(s).toContain('4 of the 8 shifts in the next 8 weeks are open. The week of 2 Nov has the most: 2 of its 4.')
  })
  it('all open shifts in one week', () => {
    expect(fillSentence(data(sparse({ 0: week(mondays[0], 4), 1: week(mondays[1], 4, 3) })))).toContain('3 of the 8 shifts in the next 8 weeks are open, all in the week of 9 Nov.')
  })
  it('draft clause forms', () => {
    const base = (d: number, other = 3) => fillSentence(data(sparse({ 0: week(mondays[0], 4, 0, d), 1: week(mondays[1], 4, 0, other) })))
    expect(fillSentence(data(sparse({ 0: week(mondays[0], 4, 0, 1), 1: week(mondays[1], 4) })))).toContain('1 of the 8 is still a draft.')
    expect(base(2, 1)).toContain('3 of the 8 are still drafts.')
    expect(fillSentence(data(sparse({ 0: week(mondays[0], 4, 0, 4), 1: week(mondays[1], 4, 0, 4) })))).toContain('All of them are still drafts.')
  })
  it('unrostered clause: one, two, three or more; skipped when one week only', () => {
    expect(fillSentence(data(mondays.map((m, i) => week(m, i === 3 ? 0 : 2))))).toContain('The week of 23 Nov has nothing rostered yet.')
    expect(fillSentence(data(mondays.map((m, i) => week(m, i < 2 ? 0 : 2))))).toContain('The weeks of 2 Nov and 9 Nov have nothing rostered yet.')
    expect(fillSentence(data(mondays.map((m, i) => week(m, i < 3 ? 0 : 2))))).toContain('3 of the weeks have nothing rostered yet.')
    expect(fillSentence(data(sparse({ 0: week(mondays[0], 4, 1) })))).not.toContain('nothing rostered')
  })
  it('adds the year to a date in a later year', () => {
    const weeks = ['2026-12-28', '2027-01-04'].map((m, i) => week(m, 4, i === 1 ? 2 : 0))
    expect(fillSentence({ today: '2026-12-30', weeks })).toContain('week of 4 Jan 2027')
  })
})

describe('labels and helpers', () => {
  it('weekLabel and yearBreakIndex', () => {
    expect(weekLabel('2026-11-03')).toBe('3 Nov')
    expect(yearBreakIndex(['2026-12-21', '2026-12-28', '2027-01-04'].map(m => week(m)))).toBe(2)
    expect(yearBreakIndex(mondays.map(m => week(m)))).toBe(-1)
  })
  it('hoursText drops a trailing .0 and keeps one decimal', () => {
    expect(hoursText(72)).toBe('72')
    expect(hoursText(3.5)).toBe('3.5')
    expect(hoursText(1240.04)).toBe('1,240')
  })
  it('isFirstWeek compares with the Monday of today', () => {
    expect(isFirstWeek(week('2026-11-02'), '2026-11-08')).toBe(true)
    expect(isFirstWeek(week('2026-11-09'), '2026-11-08')).toBe(false)
  })
  it('readoutRows: header, closing line for mouse, touch and the board week', () => {
    const w = week('2026-11-16', 24, 6, 3)
    const o = { today: '2026-11-04', boardWeek: undefined, touch: false }
    expect(readoutRows(w, o)).toMatchObject({ header: 'Week of 16 Nov', filled: '18 of 24', open: '6', hours: '144 hours filled, 48 open', draft: '3 still drafts', last: 'Select to show it on the board' })
    expect(readoutRows(w, { ...o, touch: true }).last).toBe('Tap again to show it on the board')
    expect(readoutRows(w, { ...o, boardWeek: '2026-11-16' }).last).toBe('On the board now')
    expect(readoutRows(week('2026-11-02', 2), o).header).toBe('This week, from 2 Nov')
    expect(readoutRows(week('2026-11-16', 2, 0, 1), o).draft).toBe('1 still a draft')
  })
  it('detailLine and liveLine', () => {
    const o = { today: '2026-11-04', boardWeek: '2026-11-09', touch: true }
    expect(detailLine(undefined, o)).toBe('')
    expect(detailLine(week('2026-11-16', 24, 6, 3), o)).toBe('Week of 16 Nov: 144 hours filled, 48 open. 3 still drafts. Tap again to show it on the board.')
    expect(detailLine(week('2026-11-23'), o)).toBe('Week of 23 Nov: not rostered yet. Tap again to show it on the board.')
    expect(liveLine(week('2026-11-16', 24, 6, 1), o)).toBe('Week of 16 Nov: 18 of 24 filled, 6 open. 1 still a draft. Press Enter to show it on the board.')
    expect(liveLine(week('2026-11-09', 4), o)).toBe('Week of 9 Nov: 4 of 4 filled, 0 open. On the board now.')
    expect(liveLine(week('2026-11-23'), o)).toBe('Week of 23 Nov: not rostered yet. Press Enter to show it on the board.')
  })
  it('tableRows marks the board week and fills a not-rostered row with "none"', () => {
    const rows = tableRows(data([week('2026-11-02', 4, 1), week('2026-11-09')]), '2026-11-02')
    expect(rows[0].header).toBe('2 Nov (on the board)')
    expect(rows[0].cells).toEqual(['4', '3', '1', '24', '8', '0'])
    expect(rows[1].cells).toEqual(['Not rostered yet', 'none', 'none', 'none', 'none', 'none'])
  })
})
