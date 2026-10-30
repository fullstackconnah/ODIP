import { describe, expect, it } from 'vitest'
import type { AgreementApproveOutcome, AgreementApproveResult } from '@/api/types'
import { groupResults, notMovedWords, resultHeading, summarise } from './outcomeWords'

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

describe('moving to Active on approval', () => {
  const moved = (name: string) => ({ ...r('Approved', name), activation: { result: 'Activated' as const } })
  const notMoved = (name: string, reason = 'intake not finished') => ({ ...r('Approved', name), activation: { result: 'NotActivated' as const, reason } })

  it('puts the failures first, then who was not moved, then the moved count, and only a not-moved one asks for attention', () => {
    expect(summarise([moved('A'), moved('B'), notMoved('C')])).toEqual({ tone: 'danger', title: '3 approved.', message: '1 not moved to Active: C. 2 moved to Active.' })
    expect(summarise([moved('A'), moved('B')])).toEqual({ tone: 'success', title: '2 approved.', message: '2 moved to Active.' })
    expect(summarise([moved('A'), notMoved('B'), r('Busy', 'Ed')]).message).toBe('1 was busy: try again. 1 not moved to Active: B. 1 moved to Active.')
  })

  it('says nothing about Active when the setting is off', () => {
    expect(summarise([{ ...r('Approved', 'A'), activation: { result: 'Off' } }, r('Approved', 'B')])).toEqual({ tone: 'success', title: '2 approved.', message: '' })
  })

  it('lists an approved row that was not moved after the other failures and before already approved, and never one that was moved', () => {
    const out = groupResults([r('AlreadyApproved', 'Al'), notMoved('Nia'), moved('Mo'), r('Failed', 'Zed'), r('Busy', 'Bo'), r('NeedsReview', 'Yan'), notMoved('Ann')])
    expect(out.map(x => x.participantName)).toEqual(['Yan', 'Bo', 'Zed', 'Ann', 'Nia', 'Al'])
  })

  it('adds the not-moved line to the heading, also when everything was approved', () => {
    expect(resultHeading([moved('A'), notMoved('B'), notMoved('C')], 3)).toEqual({ title: '3 agreements approved', line: "2 weren't moved to Active. Each row says why.", danger: false })
    expect(resultHeading([moved('A'), notMoved('B')], 2).line).toBe("1 wasn't moved to Active. The row says why.")
    expect(resultHeading([moved('A'), notMoved('B'), r('AlreadyApproved', 'C')], 3).line).toBe("1 wasn't moved to Active. Each row says why.")
    expect(resultHeading([moved('A'), moved('B')], 2).line).toBeNull()
    expect(resultHeading([moved('A'), notMoved('B'), r('Busy', 'C')], 3)).toEqual({ title: '2 of 3 approved', line: "1 wasn't approved, and 1 wasn't moved to Active. Each row says why.", danger: false })
  })

  it('ends the server reason with one full stop, whether or not it carries one', () => {
    expect(notMovedWords("their plan budget isn't on the Funding tab yet")).toBe("Not moved to Active: their plan budget isn't on the Funding tab yet.")
    expect(notMovedWords('intake not finished.')).toBe('Not moved to Active: intake not finished.')
    expect(notMovedWords('intake not finished')).toBe('Not moved to Active: intake not finished.')
  })
})
