import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CombinedWarning, combinedLines } from './CombinedWarning'
import type { AgreementCheck } from '@/api/types'

const check = (over: Partial<AgreementCheck>): AgreementCheck => ({
  hasBudget: true, asOf: '2026-11-01', periodFrom: '2026-07-01', periodTo: '2027-06-30', agreementCost: 0, pools: [],
  notInARecordedPool: 0, outsideThePlan: 0, otherAgreements: [], combinedOver: false, ...over,
} as AgreementCheck)

const pool = (poolName: string, combinedCost: number, combinedOverBy: number) => ({ poolName, combinedCost, combinedOverBy }) as AgreementCheck['pools'][number]

describe('CombinedWarning', () => {
  it('renders nothing unless the combined plan passes the money', () => {
    const { container } = render(<CombinedWarning check={check({ combinedOver: false })} title="T" countedLead="Counted" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names each pool over, then who was counted, and never says it fits', () => {
    const c = check({
      combinedOver: true,
      pools: [pool('Core supports', 12000, 2500), pool('Capacity building', 100, 0)],
      otherAgreements: [{ agreementId: 'b', agreementKind: 'Trip', agreementName: 'Trip to Cairns', version: 2, cost: 5000 }],
    })
    render(<CombinedWarning check={c} title="Together, these plan more" countedLead="Counted" self={{ label: 'Everyday support', version: 3 }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Together, these plan more')
    expect(screen.getByText(/Core supports: \$12,000\.00 planned, \$2,500\.00 more than the money available\./)).toBeInTheDocument()
    expect(screen.queryByText(/Capacity building/)).toBeNull()
    expect(screen.getByText('Counted: Everyday support (version 3), Trip to Cairns (version 2). Nothing is blocked.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/within budget|fits|under budget/i)
  })

  it('lists only the others when no self is given', () => {
    const c = check({ combinedOver: true, pools: [pool('Core', 1, 1)], otherAgreements: [{ agreementId: 'b', agreementKind: 'NightSupport', version: 1, cost: 1 }] })
    expect(combinedLines(c, 'Counted with')).toEqual(['Core: $1.00 planned, $1.00 more than the money available.', 'Counted with: Night support (version 1). Nothing is blocked.'])
  })
})
