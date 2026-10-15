import { describe, expect, it } from 'vitest'
import { golden } from '@/test/fixtures/planPricing'
import { groupIssues, shiftsNotPriced, totalsCaption } from './planQuote'

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
    expect(shiftsNotPriced(issues)).toBe(10)
    // Ten, and "at least": the quote does not say that the two issues touch the same shifts, only how many each touches, so the figure is a lower bound and not the count (review N10).
    expect(totalsCaption(golden.twoIssuesSameShifts)).toEqual({ text: 'at least 10 shifts with a part not priced', notFullyPriced: true })
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
