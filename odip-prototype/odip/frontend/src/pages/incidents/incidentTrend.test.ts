import { describe, expect, it } from 'vitest'
import type { IncidentTrendDto } from '@/api/types'
import { liveLine, monthShort, readoutRows, rpPart, tableCaption, tableRows, trendSentence } from './incidentTrend'

// Months are given as [incidents, rpUses] pairs, oldest first; the last is the current (partial) month.
function trend(today: string, first: string, counts: Array<[number, number]>): IncidentTrendDto {
  const [fy, fm] = first.split('-').map(Number)
  return {
    today,
    months: counts.map(([incidents, rpUses], i) => {
      const n = fm - 1 + i
      return { month: `${fy + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`, incidents, rpUses, otherIncidents: incidents - rpUses }
    }),
  }
}
const ZERO: Array<[number, number]> = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]

describe('rpPart', () => {
  it.each([
    [1, 0, ', not a restrictive practice use'],
    [4, 0, ', none of them restrictive practice uses'],
    [1, 1, ', a restrictive practice use'],
    [5, 5, ', all of them restrictive practice uses'],
    [5, 1, ', 1 of them a restrictive practice use'],
    [1240, 700, ', 700 of them restrictive practice uses'],
  ])('t=%i r=%i', (t, r, text) => expect(rpPart(t, r)).toBe(text))
})

describe('trendSentence', () => {
  it('names no incidents in the window', () => {
    expect(trendSentence(trend('2026-10-15', '2026-05', ZERO))).toBe('No incidents have been reported since May.')
  })

  it('one incident in one month', () => {
    expect(trendSentence(trend('2026-10-15', '2026-05', [[0, 0], [0, 0], [1, 0], [0, 0], [0, 0], [0, 0]])))
      .toBe('1 incident since May, in July, not a restrictive practice use.')
  })

  it('several incidents all in one month', () => {
    const s = trendSentence(trend('2026-10-15', '2026-05', [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [3, 3]]))
    expect(s).toBe('3 incidents since May, all in October, all of them restrictive practice uses.')
  })

  it('the SHAPE example: up, and restrictive practice uses from none to 1', () => {
    expect(trendSentence(trend('2026-10-15', '2026-05', [[2, 0], [1, 0], [3, 0], [2, 0], [4, 1], [2, 2]])))
      .toBe('14 incidents since May, 3 of them restrictive practice uses. September had 4, up from 2 in August. Restrictive practice uses went from none to 1.')
  })

  it('down, and the year appears when the first month is in an earlier year', () => {
    expect(trendSentence(trend('2026-04-15', '2025-11', [[400, 300], [0, 0], [300, 180], [260, 120], [240, 100], [40, 0]])))
      .toBe('1,240 incidents since November 2025, 700 of them restrictive practice uses. March had 240, down from 260 in February. Restrictive practice uses went from 120 to 100.')
  })

  it('same as, with clause 3 left out when restrictive practice uses are level', () => {
    expect(trendSentence(trend('2026-10-15', '2026-05', [[1, 0], [0, 0], [0, 0], [5, 2], [5, 2], [0, 0]])))
      .toBe('11 incidents since May, 4 of them restrictive practice uses. September had 5, the same as August.')
  })

  it('omits clause 2 when the last two complete months are both empty, and reads a zero as none', () => {
    expect(trendSentence(trend('2026-10-15', '2026-05', [[3, 1], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]])))
      .toBe('3 incidents since May, all in May, 1 of them a restrictive practice use.')
    expect(trendSentence(trend('2026-10-15', '2026-05', [[1, 0], [1, 0], [1, 0], [0, 0], [2, 0], [0, 0]])))
      .toContain('September had 2, up from none in August.')
  })

  it('never compares the current month', () => {
    const quiet = trend('2026-10-15', '2026-05', [[2, 0], [1, 0], [3, 0], [2, 0], [4, 1], [0, 0]])
    const loud = trend('2026-10-15', '2026-05', [[2, 0], [1, 0], [3, 0], [2, 0], [4, 1], [999, 999]])
    expect(trendSentence(loud).split(' September')[1]).toBe(trendSentence(quiet).split(' September')[1])
  })
})

describe('live line, readout and table', () => {
  const data = trend('2026-10-15', '2026-05', [[2, 0], [0, 0], [1, 1], [1240, 700], [4, 1], [2, 2]])

  it('live line', () => {
    expect(liveLine(data, 4)).toBe('September 2026: 4 incidents, 1 of them a restrictive practice use.')
    expect(liveLine(data, 2)).toBe('July 2026: 1 incident, a restrictive practice use.')
    expect(liveLine(data, 3)).toBe('August 2026: 1,240 incidents, 700 of them restrictive practice uses.')
    expect(liveLine(data, 5)).toBe('October 2026 so far: 2 incidents, all of them restrictive practice uses.')
    expect(liveLine(data, 1)).toBe('June 2026: no incidents.')
  })

  it('readout rows, with the singular forms and the empty month', () => {
    expect(readoutRows(data, 2)).toEqual({ header: 'July 2026', empty: false, rp: '1', rpText: 'restrictive practice use', other: '0', otherText: 'other incidents', last: '1 in all' })
    expect(readoutRows(data, 4)).toMatchObject({ rp: '1', other: '3', last: '4 in all' })
    expect(readoutRows(data, 3)).toMatchObject({ rp: '700', other: '540', last: '1,240 in all' })
    expect(readoutRows(data, 5).header).toBe('October 2026 so far')
    expect(readoutRows(data, 1)).toMatchObject({ header: 'June 2026', empty: true })
  })

  it('table', () => {
    expect(tableCaption(data)).toBe('Incidents by month, from May 2026')
    const rows = tableRows(data)
    expect(rows[1]).toEqual({ header: 'June 2026', cells: ['0', '0', '0'] })
    expect(rows[3].cells).toEqual(['1,240', '700', '540'])
    expect(rows[5].header).toBe('October 2026 (so far)')
  })

  it('short month', () => expect(monthShort('2026-09')).toBe('Sep'))
})
