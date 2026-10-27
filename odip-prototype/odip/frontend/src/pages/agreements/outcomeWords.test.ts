import { describe, expect, it } from 'vitest'
import type { AgreementApproveOutcome, AgreementApproveResult } from '@/api/types'
import { summarise } from './outcomeWords'

const r = (outcome: AgreementApproveOutcome, name: string): AgreementApproveResult => ({ participantId: name, draftId: `d-${name}`, participantName: name, outcome, reasons: [] })

describe('summarise', () => {
  it('counts the approved and names who needs review, three at most', () => {
    const s = summarise([r('Approved', 'A'), r('Approved', 'B'), ...['Ana', 'Bo', 'Cy', 'Di'].map(n => r('NeedsReview', n)), r('Busy', 'Ed')])
    expect(s).toEqual({ tone: 'success', title: '2 approved.', message: '4 need review: Ana, Bo, Cy and 1 more. 1 was busy: try again.' })
  })
  it('is a danger notice when nothing was approved, and says what was not started', () => {
    const s = summarise([r('Ended', 'Fay')], 3)
    expect(s.tone).toBe('danger')
    expect(s.title).toBe('Nothing was approved.')
    expect(s.message).toBe("1 could not be approved: Fay. 3 weren't started.")
  })
})
