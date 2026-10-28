import { describe, expect, it } from 'vitest'
import type { AgreementApproveOutcome, AgreementApproveResult } from '@/api/types'
import { groupResults, resultHeading, summarise } from './outcomeWords'

const r = (outcome: AgreementApproveOutcome, name: string): AgreementApproveResult => ({ participantId: name, draftId: `d-${name}`, participantName: name, outcome, reasons: [] })

describe('summarise', () => {
  it('counts the approved and names who needs review, three at most', () => {
    const s = summarise([r('Approved', 'A'), r('Approved', 'B'), ...['Ana', 'Bo', 'Cy', 'Di'].map(n => r('NeedsReview', n)), r('Busy', 'Ed')])
    // A partial run uses the notice tone that renders as the house warning.
    expect(s).toEqual({ tone: 'danger', title: '2 approved.', message: '4 need review: Ana, Bo, Cy and 1 more. 1 was busy: try again.' })
  })
  it('says "needs" for exactly one that needs review', () => {
    expect(summarise([r('Approved', 'A'), r('NeedsReview', 'Ben')]).message).toBe('1 needs review: Ben.')
  })
  it('is a danger notice when nothing was approved, and says what was not started', () => {
    const s = summarise([r('Ended', 'Fay')], 3)
    expect(s.tone).toBe('danger')
    expect(s.title).toBe('Nothing was approved.')
    expect(s.message).toBe("1 could not be approved: Fay. 3 weren't started.")
  })
  it('stays a success when everything was approved, and neutral when it was all approved already', () => {
    expect(summarise([r('Approved', 'A'), r('Approved', 'B')]).tone).toBe('success')
    expect(summarise([r('AlreadyApproved', 'A'), r('AlreadyApproved', 'B')])).toEqual({ tone: 'info', title: 'These were already approved.', message: '' })
  })
  it('says no answer came back, not that the rest were not started', () => {
    expect(summarise([r('Approved', 'A')], 3, true).message).toBe('No answer came back for the last 3: some may have been approved.')
  })
})

describe('resultHeading', () => {
  const many = (n: number, o: AgreementApproveOutcome) => Array.from({ length: n }, (_, i) => r(o, `${o}${i}`))
  it('is the plain count when all were approved', () => {
    expect(resultHeading(many(17, 'Approved'), 17)).toEqual({ title: '17 agreements approved', line: null, danger: false })
  })
  it('says a partial is partial, and why to look at the rows', () => {
    expect(resultHeading([...many(5, 'Approved'), ...many(12, 'NeedsReview')], 17)).toEqual({ title: '5 of 17 approved', line: "12 weren't approved. Each row says why.", danger: false })
  })
  it('names every part that is left, so the counts add up', () => {
    const mixed = [...many(5, 'Approved'), ...many(11, 'NeedsReview'), ...many(1, 'AlreadyApproved')]
    expect(resultHeading(mixed, 17)).toEqual({ title: '5 of 17 approved', line: "11 weren't approved, and 1 was already approved. Each row says why.", danger: false })
    expect(resultHeading([...many(5, 'Approved'), ...many(11, 'NeedsReview')], 16).line).toBe("11 weren't approved. Each row says why.")
    expect(resultHeading([...many(5, 'Approved'), ...many(1, 'AlreadyApproved')], 7).line).toBe('1 was already approved. Each row says why.')
    expect(resultHeading([...many(5, 'Approved'), ...many(1, 'Busy'), ...many(2, 'AlreadyApproved')], 8).line).toBe("1 wasn't approved, and 2 were already approved. Each row says why.")
  })
  it('is neutral when everything was approved already', () => {
    expect(resultHeading(many(3, 'AlreadyApproved'), 3)).toEqual({ title: 'These were already approved.', line: null, danger: false })
  })
  it('stays red when nothing was approved for other reasons', () => {
    expect(resultHeading([...many(1, 'AlreadyApproved'), ...many(2, 'Busy')], 3)).toEqual({ title: 'Nothing was approved.', line: 'Each row says why.', danger: true })
  })
  it('counts the ones that were never sent in the total', () => {
    expect(resultHeading(many(25, 'Approved'), 50)).toEqual({ title: '25 of 50 approved', line: null, danger: false })
  })
})

describe('groupResults', () => {
  it('lists needs review, roster busy, other failures, then already approved, by name within each group, and leaves the approved out', () => {
    const out = groupResults([r('AlreadyApproved', 'Al'), r('Failed', 'Zed'), r('Busy', 'Bo'), r('Approved', 'Ann'), r('NeedsReview', 'Yan'), r('Ended', 'Cy'), r('NeedsReview', 'Dee'), r('Busy', 'Abe')])
    expect(out.map(x => x.participantName)).toEqual(['Dee', 'Yan', 'Abe', 'Bo', 'Cy', 'Zed', 'Al'])
  })
})
