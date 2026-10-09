import { describe, expect, it } from 'vitest'
import { budgetRow, noBudget } from '@/test/fixtures/budgets'
import { budgetRiskRow, fundingTabPath, noBudgetEntry } from './budgetRows'

// The adapter from the Budgets list's DTO to the table's view-model. It maps and decides nothing: every figure is the server's, a status is the server's word, a zero stays a zero.

const visible = { visible: true } as const

describe('budgetRiskRow', () => {
  it('passes the server’s figures through as they are, in whole dollars, and adds nothing up', () => {
    const row = budgetRiskRow(budgetRow({ available: 9000, used: 3180, bookedAhead: 960, forecast: 4140 }), visible)

    expect([row.available, row.used, row.bookedAhead, row.forecast]).toEqual([9000, 3180, 960, 4140])
    expect(row.figures).toEqual({ visible: true })
  })

  it('keeps a zero a zero: a pool recorded at $0 is a figure, never a missing one', () => {
    const row = budgetRiskRow(budgetRow({ available: 0, used: 0, bookedAhead: 0, forecast: 0 }), visible)

    expect([row.available, row.used, row.bookedAhead, row.forecast]).toEqual([0, 0, 0, 0])
  })

  it('carries how many shifts the forecast leaves out because no price can be worked out for them yet, and nothing at all when there are none', () => {
    expect(budgetRiskRow(budgetRow({ unpricedShiftCount: 3 }), visible)).toHaveProperty('unpricedShifts', 3)
    expect(budgetRiskRow(budgetRow({ unpricedShiftCount: 0 }), visible)).not.toHaveProperty('unpricedShifts')
    expect(budgetRiskRow(budgetRow(), visible)).not.toHaveProperty('unpricedShifts')
  })

  it('carries what is left and what rolled over as the server sent them, and adds nothing up', () => {
    const row = budgetRiskRow(budgetRow({ available: 3473.32, carried: 448.66, used: 1932, remaining: 1541.32 }), visible)

    expect([row.available, row.carried, row.used, row.remaining]).toEqual([3473.32, 448.66, 1932, 1541.32])
    expect(budgetRiskRow(budgetRow({ available: 1000, used: 1400, remaining: -400 }), visible).remaining).toBe(-400)   // how far over, as the server worked it out
  })

  it('carries the NDIA word, with its day and code, when the server sent one, and nothing at all when it did not', () => {
    const refused = budgetRiskRow(budgetRow({ ndiaRejection: { date: '2026-10-08', code: 'V27', claimId: 'claim-1', claimReference: 'TC-1' } }), visible)

    expect(refused.ndiaWord).toEqual({ date: '2026-10-08', code: 'V27' })
    expect(budgetRiskRow(budgetRow(), visible)).not.toHaveProperty('ndiaWord')
  })

  it('names who, which pool and which period, and links the row to the participant’s Funding tab', () => {
    const row = budgetRiskRow(budgetRow({ participantId: 'p-0002', participantName: 'Sienna Williams', poolName: 'Improved Daily Living Skills' }), visible)

    expect(row.participantLabel).toBe('Sienna Williams')
    expect(row.poolLabel).toBe('Improved Daily Living Skills')
    expect([row.periodStart, row.periodEnd]).toEqual(['2026-10-01', '2026-12-31'])
    expect(row.action).toEqual({ label: 'Open funding', to: '/participants/p-0002?tab=funding' })
    expect(fundingTabPath('p-0002')).toBe('/participants/p-0002?tab=funding')
  })

  it('gives each participant-pool-period a stable id of its own', () => {
    const a = budgetRiskRow(budgetRow({ participantId: 'p-1', poolId: 'pool-a' }), visible)
    const b = budgetRiskRow(budgetRow({ participantId: 'p-1', poolId: 'pool-b' }), visible)
    const c = budgetRiskRow(budgetRow({ participantId: 'p-2', poolId: 'pool-a' }), visible)

    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
    expect(a.id).toBe(budgetRiskRow(budgetRow({ participantId: 'p-1', poolId: 'pool-a' }), visible).id)
  })

  it.each([
    ['OnTrack', 'OnTrack'], ['Approaching', 'Approaching'], ['ForecastOver', 'ForecastOver'], ['Over', 'Over'], ['None', 'NoBudget'],
  ] as const)('maps the server’s status %s to %s', (server, expected) => {
    expect(budgetRiskRow(budgetRow({ status: server }), visible).status).toBe(expected)
  })

  it('carries the viewer’s visibility onto the row, so a withheld figure is withheld at the one renderer', () => {
    const hidden = { visible: false, reason: 'Budget figures are for coordinators and administrators.' } as const

    expect(budgetRiskRow(budgetRow(), hidden).figures).toEqual(hidden)
  })
})

describe('noBudgetEntry', () => {
  it('says no budget is recorded, and links to the Funding tab where one is', () => {
    const entry = noBudgetEntry(noBudget({ participantId: 'p-0005', participantName: 'Noor Hassan' }))

    expect(entry).toEqual({
      id: 'p-0005', participantLabel: 'Noor Hassan', reason: 'No budget recorded', action: { label: 'Record budget', to: '/participants/p-0005?tab=funding' },
    })
  })

  it('says a plan ended, and on which day, when that is why there is no row', () => {
    // (the app's written dates keep their words together with non-breaking spaces, which read as spaces)
    expect(noBudgetEntry(noBudget({ reason: 'PlanEnded', planEnd: '2026-06-30' })).reason.replace(/\s/g, ' ')).toBe('Plan ended 30 Jun 2026')
  })

  it('offers the Funding tab\u2019s own button for a plan that ended: Record a new plan', () => {
    const entry = noBudgetEntry(noBudget({ participantId: 'p-0006', reason: 'PlanEnded', planEnd: '2026-06-30' }))

    expect(entry.action).toEqual({ label: 'Record a new plan', to: '/participants/p-0006?tab=funding' })
  })

  it('still says a plan ended when the server did not say which day (it omits what it does not have)', () => {
    expect(noBudgetEntry(noBudget({ reason: 'PlanEnded' })).reason).toBe('Plan ended')
  })
})
