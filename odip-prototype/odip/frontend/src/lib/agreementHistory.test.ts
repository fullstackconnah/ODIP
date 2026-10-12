import { describe, expect, it } from 'vitest'
import { approvalHistory } from './agreementHistory'

const approved = (version: number, approvedAt: string, approvedByName: string) => ({ version, approval: { approvedAt, approvedByName } })

describe('approvalHistory', () => {
  it('has no history until something was approved', () => {
    expect(approvalHistory([{ version: 2 }, { version: 1 }])).toEqual([])
  })

  it('says who approved the agreement and when', () => {
    expect(approvalHistory([approved(3, '2026-10-03T01:00:00Z', 'Alex'), { version: 2 }])).toEqual(['Approved 3 Oct 2026 by Alex.'])
  })

  it('says when an approval was replaced by a later one, newest first', () => {
    const lines = approvalHistory([approved(5, '2026-10-09T03:00:00Z', 'Sam'), { version: 4 }, approved(3, '2026-10-03T01:00:00Z', 'Alex')])
    expect(lines).toEqual(['Approved 9 Oct 2026 by Sam.', 'Approved 3 Oct 2026 by Alex. Replaced 9 Oct 2026.'])
  })
})
