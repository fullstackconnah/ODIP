import { describe, expect, it } from 'vitest'
import type { PipelineDto, PipelineWeekDto } from '@/api/types'
import {
  PIPELINE_EMPTY, TABLE_COLUMNS, labelledWeeks, liveLine, pipelineSentence, readoutRows, rejectedLink, tableCaption, tableRows, undatedFootnote, weekShort,
} from './claimsPipeline'

const MONDAYS = ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']
const week = (weekStart: string, sent = 0, paid = 0, rejected = 0, rejectedLines = 0): PipelineWeekDto => ({ weekStart, sent, paid, rejected, rejectedLines })
const zeros = MONDAYS.map(m => week(m))
const make = (over: Partial<PipelineDto> = {}, weeks: PipelineWeekDto[] = zeros): PipelineDto => ({ today: '2026-10-30', weeks, withNdia: 0, acceptedUnpaid: 0, undatedPaid: 0, ...over })
const busy = make({}, MONDAYS.map((m, i) => (i === 9 ? week(m, 1234.56, 980, 120.5, 2) : i === 11 ? week(m, 0.1, 0.2) : week(m))))

describe('pipelineSentence', () => {
  it('both owed figures', () => {
    expect(pipelineSentence({ ...busy, withNdia: 500, acceptedUnpaid: 250.25 })).toBe(
      "$1,234.66 sent to the NDIA in the last 12 weeks and $980.20 paid. $500.00 is waiting on the NDIA's results and $250.25 is accepted but not paid yet.")
  })
  it('only waiting', () => {
    expect(pipelineSentence({ ...busy, withNdia: 500 })).toBe("$1,234.66 sent to the NDIA in the last 12 weeks and $980.20 paid. $500.00 is waiting on the NDIA's results.")
  })
  it('only accepted', () => {
    expect(pipelineSentence({ ...busy, acceptedUnpaid: 250.25 })).toBe('$1,234.66 sent to the NDIA in the last 12 weeks and $980.20 paid. $250.25 is accepted but not paid yet.')
  })
  it('neither', () => {
    expect(pipelineSentence(busy)).toBe('$1,234.66 sent to the NDIA in the last 12 weeks and $980.20 paid. Nothing is waiting on the NDIA.')
  })
  it('weeks all zero: the empty sentence, with the owed clause when something is owed', () => {
    expect(pipelineSentence(make())).toBe(`${PIPELINE_EMPTY} Nothing is waiting on the\u00A0NDIA.`)
    expect(pipelineSentence(make({ withNdia: 10, acceptedUnpaid: 5 }))).toBe(`${PIPELINE_EMPTY} $10.00 is waiting on the NDIA's results and $5.00 is accepted but not paid yet.`)
  })
})

describe('week labels', () => {
  it('names a Monday by calendar parts', () => {
    expect(weekShort('2026-10-26')).toBe('26 Oct')
    expect(weekShort('2026-08-10')).toBe('10 Aug')
  })
  it('labels every week when wide and every third from the current week when narrow', () => {
    expect(labelledWeeks(12, false)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(labelledWeeks(12, true)).toEqual([2, 5, 8, 11])
  })
})

describe('readout, live line and table', () => {
  it('readout rows for a week with rejections, the current week and an empty week', () => {
    expect(readoutRows(busy, 9)).toEqual({ header: 'Week of 12 October', empty: false, sent: '$1,234.56', paid: '$980.00', rejected: 'Rejected $120.50 (2 lines)' })
    expect(readoutRows(busy, 11).header).toBe('Week of 26 October (so far)')
    expect(readoutRows(busy, 11).rejected).toBe('Nothing rejected')
    expect(readoutRows(busy, 0)).toMatchObject({ header: 'Week of 10 August', empty: true })
  })
  it('one rejected line is singular', () => {
    expect(readoutRows(make({}, [week(MONDAYS[0], 1, 0, 5, 1)]), 0).rejected).toBe('Rejected $5.00 (1 line)')
  })
  it('live line', () => {
    expect(liveLine(busy, 9)).toBe('Week of 12 October: $1,234.56 sent, $980.00 paid, $120.50 rejected.')
  })
  it('table', () => {
    expect(TABLE_COLUMNS).toEqual(['Week', 'Sent', 'Paid', 'Rejected'])
    expect(tableCaption(busy)).toBe('Claims sent and paid by week, from the week of 10 August 2026')
    const rows = tableRows(busy)
    expect(rows).toHaveLength(12)
    expect(rows[9]).toEqual({ header: 'Week of 12 October', cells: ['$1,234.56', '$980.00', '$120.50'] })
    expect(rows[11].header).toBe('Week of 26 October (so far)')
  })
})

describe('side lines', () => {
  it('the rejected link counts lines', () => {
    expect(rejectedLink(1)).toBe('1 rejected line needs action')
    expect(rejectedLink(3)).toBe('3 rejected lines need action')
  })
  it('the undated footnote', () => {
    expect(undatedFootnote(1234.5)).toBe("$1,234.50 paid before payments were dated isn't shown in the weeks.")
  })
})
