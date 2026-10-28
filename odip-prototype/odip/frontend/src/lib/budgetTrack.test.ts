import { describe, expect, it } from 'vitest'
import { budgetSeries, expectedOk, seriesScope } from '@/test/fixtures/budgetSeries'
import { money, unpricedShiftSentence } from './budgetLedger'
import { writtenDay } from './fundingPlan'
import { budgetTrackFootnotes, budgetTrackSentence, chartHeight, compactAud, liveLine, readoutHeader, readoutRows, xTicks, yTicks } from './budgetTrack'

// The budget graph's words (Funding tab). Every figure is the fixture's, standing in for the server's: these only decide how it is written.

const series = budgetSeries()
const plan = series.scopes[0]

describe('budgetTrackSentence', () => {
  it('the current-plan sentence carries used, limit, the gap to an even spread, pace, booked and expected', () => {
    const s = plan.summary
    expect(s.pace).toBeDefined()
    expect(s.bookedEnd).toBeDefined()
    expect(budgetTrackSentence(series, plan)).toBe(
      `The whole plan: used ${money(s.used)} of ${money(plan.limit)} so far, ${money(Math.abs(s.aheadOfEven))} less than an even spread by 4 Oct. `
      + `At this rate it reaches ${money(s.pace!)} by ${writtenDay('2027-06-30')}, ${money(Math.abs(s.paceGapAtEnd!))} under the budget. `
      + `Booked shifts take it to ${money(s.bookedEnd!)}. The agreement expects ${money(s.expectedEnd!)} by ${writtenDay('2027-06-30')}.`,
    )
  })

  it('says "in step" when the gap rounds to $0, and "more" when ahead', () => {
    const inStep = { ...plan, summary: { ...plan.summary, aheadOfEven: 0.004 } }
    expect(budgetTrackSentence(series, inStep)).toContain('so far, in step with an even spread by 4 Oct.')
    const ahead = { ...plan, summary: { ...plan.summary, aheadOfEven: 120 } }
    expect(budgetTrackSentence(series, ahead)).toContain('so far, $120 more than an even spread by 4 Oct.')
  })

  it('leaves out "At this rate" while pace is null', () => {
    const early = { ...plan, summary: { ...plan.summary, pace: undefined, paceGapAtEnd: undefined } }
    expect(budgetTrackSentence(series, early)).not.toContain('At this rate')
  })

  it('leaves out the booked clause when bookedEnd is null, and the agreement clause unless the status is Ok', () => {
    const nothingBooked = { ...plan, summary: { ...plan.summary, bookedEnd: undefined } }
    expect(budgetTrackSentence(series, nothingBooked)).not.toContain('Booked shifts')
    for (const status of ['NoAgreement', 'Unavailable'] as const)
      expect(budgetTrackSentence({ ...series, expected: expectedOk({ status }) }, plan)).not.toContain('The agreement expects')
  })

  it('the ended sentence says what was left unused, or how far over', () => {
    const ended = budgetSeries({}, { today: '2027-08-01' })
    const scope = ended.scopes[0]
    expect(budgetTrackSentence(ended, scope)).toBe(
      `The whole plan: used ${money(scope.summary.used)} of $12,000 over the plan, which ended on 30 Jun. ${money(scope.summary.leftAtEnd!)} was left unused. The agreement expected ${money(scope.summary.expectedEnd!)}.`,
    )
    const over = { ...scope, summary: { ...scope.summary, used: 12300, leftAtEnd: -300 } }
    expect(budgetTrackSentence({ ...ended, expected: expectedOk({ status: 'NoAgreement' }) }, over)).toBe(
      'The whole plan: used $12,300 of $12,000 over the plan, which ended on 30 Jun. It finished $300 over the budget.',
    )
  })

  it('the no-spend sentence uses evenToDate', () => {
    const idle = seriesScope({ name: 'Core' }, { usedPerWeek: 0, bookedPerWeek: 0 })
    expect(budgetTrackSentence(series, idle)).toBe(`Core: nothing used yet of $12,000. An even spread would have used ${money(idle.summary.evenToDate)} by 4 Oct.`)
  })

  it('uses writtenDay across a year boundary and formatDayMonth inside the year', () => {
    const sentence = budgetTrackSentence(series, plan)
    expect(sentence).toContain(`by ${writtenDay('2027-06-30')}`)
    expect(sentence).toContain('by 4 Oct.')
  })
})

describe('budgetTrackFootnotes', () => {
  it('one per state, in order, with the unpriced shifts in the warning tone', () => {
    const revised = budgetSeries({ expected: expectedOk({ revisionChanges: ['2026-12-01', '2027-03-01'], startsOn: '2026-08-03', endsOn: '2027-05-31', unpricedLineCount: 2 }) })
    const scope = { ...revised.scopes[0], unpricedShiftCount: 3, unpricedShiftReasons: ['no catalogue item'] }
    expect(budgetTrackFootnotes(revised, scope)).toEqual([
      { text: `The agreement changed on ${writtenDay('2026-12-01')}; the expected line follows each version for its own dates.`, tone: 'muted' },
      { text: `The agreement changed on ${writtenDay('2027-03-01')}; the expected line follows each version for its own dates.`, tone: 'muted' },
      { text: `The agreement starts on ${writtenDay('2026-08-03')}, so the expected line starts there.`, tone: 'muted' },
      { text: `The agreement ends on ${writtenDay('2027-05-31')}, so the expected line stops there.`, tone: 'muted' },
      { text: "2 lines of the agreement have no price on the NDIS price list for each date, so the expected line leaves them out.", tone: 'muted' },
      { text: unpricedShiftSentence(3, ['no catalogue item']), tone: 'warning' },
      { text: "Expected re-prices the current agreement on the NDIS price list for each date, so it can differ from the total that was approved.", tone: 'muted' },
    ])
  })

  it('says one line in the singular', () => {
    const one = budgetSeries({ expected: expectedOk({ unpricedLineCount: 1 }) })
    expect(budgetTrackFootnotes(one, one.scopes[0])[0].text).toBe("1 line of the agreement has no price on the NDIS price list for each date, so the expected line leaves it out.")
  })

  it('no agreement and unavailable have their own line and no estimate note', () => {
    const none = budgetSeries({ expected: expectedOk({ status: 'NoAgreement' }) })
    expect(budgetTrackFootnotes(none, none.scopes[0])).toEqual([{ text: "No approved service agreement with a weekly routine covers this plan, so there's no expected line.", tone: 'muted' }])
    const busy = budgetSeries({ expected: expectedOk({ status: 'Unavailable' }) })
    expect(budgetTrackFootnotes(busy, busy.scopes[0])).toEqual([{ text: "The expected line couldn't be worked out just now. It will show the next time this tab loads.", tone: 'muted' }])
  })
})

describe('the chart\'s scales and readout', () => {
  it('compactAud', () => {
    expect([0, 10000, 12500, 1_200_000].map(compactAud)).toEqual(['$0', '$10K', '$12.5K', '$1.2M'])
  })

  it('yTicks: 3 below a 200px plot, else 5; evenly stepped from $0; the top tick covers the max', () => {
    const small = yTicks(12340, 172)
    expect(small).toHaveLength(3)
    expect(small[0]).toBe(0)
    expect(small.at(-1)!).toBeGreaterThanOrEqual(12340)
    const tall = yTicks(12340, 312)
    expect(tall).toEqual([0, 1, 2, 3, 4].map(i => i * tall[1]))
    expect(tall.at(-1)!).toBeGreaterThanOrEqual(12340)
    expect(yTicks(0, 312).at(-1)!).toBeGreaterThan(0)
  })

  it("yTicks: the top tick stays under 1.5 times the max, so the lines don't sit in the lower half", () => {
    for (const max of [1.2, 3100, 12340, 40800, 52000, 24000, 61000, 99999, 1_000_001])
      for (const h of [172, 312]) {
        const top = yTicks(max, h).at(-1)!
        expect(top).toBeGreaterThanOrEqual(max)
        expect(top).toBeLessThan(1.5 * max)
      }
    expect(yTicks(40800, 312).at(-1)).toBe(60000)
    expect(yTicks(52000, 172).at(-1)).toBe(60000)
    expect(yTicks(24000, 172).at(-1)).toBe(30000)
    expect(yTicks(3750, 312).map(compactAud)).toEqual(['$0', '$1K', '$2K', '$3K', '$4K'])
  })

  it('xTicks: an 800-day plan at plotW 900 steps to 2 months, with the year on January and on the first tick', () => {
    const ticks = xTicks('2026-07-01', '2028-09-08', 900)
    expect(ticks.length).toBeLessThanOrEqual(Math.floor(900 / 64))
    expect(ticks.map(t => t.date).slice(0, 4)).toEqual(['2026-07-01', '2026-09-01', '2026-11-01', '2027-01-01'])
    expect(ticks.map(t => t.label).slice(0, 4)).toEqual(['Jul 2026', 'Sep', 'Nov', 'Jan 2027'])
    expect(xTicks('2026-07-01', '2027-06-30', 900).map(t => t.date)).toHaveLength(12)
  })

  it('readoutHeader: plan start, today and week', () => {
    const [first] = plan.points
    expect(readoutHeader(first, series)).toBe(`Plan start, ${writtenDay('2026-07-01')}`)
    expect(readoutHeader(plan.points.find(p => p.date === '2026-10-04')!, series)).toBe('Today, 4 Oct')
    expect(readoutHeader(plan.points.find(p => p.date === '2027-01-12')!, series)).toBe(`Week to ${writtenDay('2027-01-12')}`)
  })

  it('readoutHeader: the plan end reads "Plan end", not "Week to"; today wins when the plan ends today', () => {
    const end = plan.points.find(p => p.date === '2027-06-30')!
    expect(readoutHeader(end, series)).toBe(`Plan end, ${writtenDay('2027-06-30')}`)
    const last = budgetSeries({ today: '2027-06-30' })
    expect(readoutHeader(last.scopes[0].points.find(p => p.date === '2027-06-30')!, last)).toBe('Today, 30 Jun')
  })

  it('readoutRows and liveLine: used up to today, used and booked after, expected or not covered, and the revision week', () => {
    const revised = budgetSeries({ expected: expectedOk({ revisionChanges: ['2026-12-01'] }) })
    const points = revised.scopes[0].points.filter(p => !p.isEdge)
    const i = points.findIndex(p => p.date === '2026-12-01')
    const rows = readoutRows(points, i, revised)
    expect(rows.rows.map(r => r.label)).toEqual(['Budget, spread evenly', 'Used and booked', 'Expected'])
    expect(rows.note).toBe('Agreement revised 1 Dec')
    expect(readoutRows(points, i - 1, revised).note).toBeUndefined()
    const past = points.findIndex(p => p.date === '2026-09-01')
    expect(readoutRows(points, past, revised).rows.map(r => r.label)).toEqual(['Budget, spread evenly', 'Used', 'Expected'])
    const p = points[past]
    expect(liveLine(points, past, revised)).toBe(`Week to ${writtenDay('2026-09-01')}: budget ${money(p.budget)}, used ${money(p.used!)}, expected ${money(p.expected!)}.`)
    const gap = { ...p, expected: undefined }
    expect(readoutRows([gap], 0, revised).rows[2].value).toBe('Not covered')
    expect(readoutRows([gap], 0, budgetSeries({ expected: expectedOk({ status: 'NoAgreement' }) })).rows).toHaveLength(2)
  })

  it('chartHeight', () => {
    expect([326, 600, 1000].map(chartHeight)).toEqual([220, 300, 360])
  })
})
