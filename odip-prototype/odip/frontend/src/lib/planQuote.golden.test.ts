import { describe, expect, it } from 'vitest'
import { golden } from '@/test/fixtures/planPricing'
import { groupByReason, groupIssues, groupLines, referenceWeek, shiftsNotPriced, totalsCaption } from './planQuote'

// What the screen's helpers do with a quote the engine wrote (see test/fixtures/planPricing.ts: the C# tests keep these files equal to what the engine says today). They were written against
// hand-made quotes that had one issue for every date; the engine has one for each block, reason and message, counting the shifts, and its messages never hold a date (review F11).
describe('the premise: what the engine writes in an issue', () => {
  it('never puts a date in an issue message, so one gap in fifty weeks is one issue', () => {
    for (const quote of Object.values(golden)) {
      for (const issue of quote.issues) expect(issue.message, issue.reason).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    }
  })

  it('counts shifts in an issue, not lines: ten shifts each missing the same part are one issue with a count of 10, and ten lines with no price', () => {
    const quote = golden.noItemDawn
    expect(quote.issues).toHaveLength(1)
    expect(quote.issues[0]).toMatchObject({ blockId: 'b1', reason: 'NoItem', count: 10, firstDate: '2026-10-05' })
    expect(quote.lines.filter(line => line.unpriced === 'NoItem')).toHaveLength(10)
    expect(quote.totals.unpricedLines).toBe(10)
  })

  it('has one issue for each thing a block cannot be priced for, each counting the same shifts', () => {
    expect(golden.twoIssuesSameShifts.issues.map(issue => [issue.reason, issue.count])).toEqual([['TransportNotAvailable', 10], ['AccommodationNotAvailable', 10]])
  })
})

describe("grouping and counting issues from the engine's own quotes", () => {
  it('reads two issues that count the same ten shifts as two things, in ten shifts: never twenty', () => {
    const { issues } = golden.twoIssuesSameShifts

    expect(groupIssues(issues).map(issue => [issue.reason, issue.count])).toEqual([['TransportNotAvailable', 10], ['AccommodationNotAvailable', 10]])
    expect(groupByReason(issues)).toHaveLength(2)
    expect(shiftsNotPriced(issues)).toBe(10)
    expect(totalsCaption(golden.twoIssuesSameShifts)).toEqual({ text: '10 shifts with a part not priced', notFullyPriced: true })
  })

  it('says the dawn block has ten shifts with a part not priced, and that its transport rests on a provisional rate', () => {
    expect(shiftsNotPriced(golden.noItemDawn.issues)).toBe(10)
    expect(totalsCaption(golden.noItemDawn)).toEqual({ text: '10 shifts with a part not priced · some lines use provisional rates', notFullyPriced: true })
  })

  it('says a priced plan with a public holiday to decide is not short of a price: the decision is a thing to do, not work left out', () => {
    expect(shiftsNotPriced(golden.briefFortnight.issues)).toBe(0)
    expect(totalsCaption(golden.briefFortnight)).toEqual({ text: '1 public holiday shift to decide', notFullyPriced: false })
  })
})

describe('the lines of an engine quote as the Review step groups them', () => {
  const weekOf = (quote: typeof golden.briefFortnight) => referenceWeek(quote.periodFrom, quote.periodTo, quote.holidayOccurrences.map(occurrence => occurrence.date))

  it("finds the ordinary week that has no holiday in it, and gives the brief's eight hours and $588.64 for it", () => {
    const quote = golden.briefFortnight
    expect(weekOf(quote)).toEqual({ from: '2026-10-08', to: '2026-10-14' })     // the week of Labour Day (Monday 5 October) is not an ordinary one

    const groups = groupLines(quote.lines, weekOf(quote))

    const daytime = groups.find(group => group.itemCode === '04_104_0125_6_1')!
    expect(daytime).toMatchObject({ occurrences: 3, periodTotal: 882.96, weeklyQty: 8, weeklyTotal: 588.64, band: 'Weekday Daytime' })
    const holiday = groups.find(group => group.itemCode === '04_102_0125_6_1')!
    expect(holiday).toMatchObject({ occurrences: 1, periodTotal: 653.84, weeklyQty: 0, weeklyTotal: 0, flags: { review: true, holidayExposure: true } })
    expect(groups.reduce((sum, group) => sum + group.periodTotal, 0)).toBeCloseTo(quote.totals.amount, 2)       // the groups add up to the engine's total
  })

  it("groups the dawn block's ten lines with no price as one row with no item and a price of nothing, beside its priced support and transport", () => {
    const quote = golden.noItemDawn
    const groups = groupLines(quote.lines, weekOf(quote))

    expect(groups).toHaveLength(3)
    const unpriced = groups.find(group => group.unpriced === 'NoItem')!
    expect(unpriced).toMatchObject({ itemCode: undefined, kind: 'Support', band: 'Weekday Night', occurrences: 10, periodTotal: 0, weeklyQty: 5, weeklyTotal: 0 })
    expect(unpriced.sample.trace.why).toContain('The catalogue has no item for community access standard Weekday Night')
    expect(groups.find(group => group.kind === 'Support' && group.unpriced === undefined)).toMatchObject({ occurrences: 10, weeklyQty: 10, band: 'Weekday Daytime' })
    expect(groups.find(group => group.kind === 'ActivityTransport')).toMatchObject({ occurrences: 10, flags: { provisional: true } })
  })

  it('sums the hours the way the engine does: the hours of the priced lines only', () => {
    const quote = golden.noItemDawn
    const groups = groupLines(quote.lines, weekOf(quote))
    const pricedHours = groups.filter(group => group.kind === 'Support' && group.unpriced === undefined).reduce((sum, group) => sum + group.periodQty, 0)

    expect(pricedHours).toBe(quote.totals.supportHours)         // 20 h: the 10 unpriced hours are not in the engine's hours
  })
})
