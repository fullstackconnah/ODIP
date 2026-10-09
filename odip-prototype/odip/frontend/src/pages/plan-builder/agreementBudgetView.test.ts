import { describe, expect, it, vi } from 'vitest'
import { agreementCheck, agreementPeriod, agreementPool, noBudgetCheck } from '@/test/fixtures/budgets'
import { agreementBudgetView, type AgreementCheckState } from './agreementBudgetView'

// The adapter from the agreement check's DTO to the bar's view-model. What these tests hold: it maps the server's figures and verdicts without adding, comparing or ranking anything; "no plan" is its own
// state and carries the way to the Funding tab; and a check that is not there yet, or never came, is a state of its own rather than a zero or an all-clear.

const onRetry = vi.fn()
const state = (overrides: Partial<AgreementCheckState> = {}): AgreementCheckState => ({ wanted: true, data: agreementCheck(), failed: false, pending: false, onRetry, ...overrides })

describe('agreementBudgetView', () => {
  it('is no view at all while there is nothing to compare: no complete block, or no dates to price over', () => {
    expect(agreementBudgetView('p-1', state({ wanted: false }))).toBeNull()
    expect(agreementBudgetView('p-1', state({ wanted: false, data: undefined, failed: true }))).toBeNull()
  })

  it('maps each pool and each funding period of it onto a line: the cost, what is left, and whether it fits', () => {
    const view = agreementBudgetView('p-1', state())

    expect(view).toEqual({
      status: 'ready',
      figures: { visible: true },
      refreshing: false,
      pools: [{ poolLabel: 'Core', cost: 2355.5, overBy: null, lines: [{ periodStart: '2026-10-01', periodEnd: '2026-12-31', cost: 2355.5, remaining: 3120, withinLimit: true, overBy: null }] }],
      notInARecordedPool: 0,
      outsideThePlan: 0,
    })
  })

  it('takes the verdict from the server\'s over-by and nothing else: more than nothing is over, nothing is within, and the cost is never compared with what is left here', () => {
    const view = agreementBudgetView('p-1', state({
      data: agreementCheck({
        pools: [agreementPool({
          periods: [
            agreementPeriod({ agreementCost: 100, remaining: 5000, overBy: 0 }),
            agreementPeriod({ periodStart: '2027-01-01', periodEnd: '2027-03-31', isCurrent: false, agreementCost: 1000, remaining: 400, overBy: 600 }),
            // A cost above "left" that the server says fits: the bar draws the server's word, because the ledger's rules (carry-over, pending) are the server's to apply.
            agreementPeriod({ periodStart: '2027-04-01', periodEnd: '2027-06-30', isCurrent: false, agreementCost: 900, remaining: 100, overBy: 0 }),
          ],
        })],
      }),
    }))

    expect(view?.pools[0].lines.map(line => [line.withinLimit, line.overBy])).toEqual([[true, null], [false, 600], [true, null]])
  })

  it('keeps the pools in the order the server sent, each under its own name, and every period in date order', () => {
    const view = agreementBudgetView('p-1', state({
      data: agreementCheck({
        pools: [
          agreementPool({ poolId: 'pool-core', poolName: 'Core (plan managed)', periods: [agreementPeriod(), agreementPeriod({ periodStart: '2027-01-01', periodEnd: '2027-03-31', isCurrent: false })] }),
          agreementPool({ poolId: 'pool-ildl', poolName: 'Improved Daily Living Skills', kind: 'Stated', periods: [agreementPeriod({ agreementCost: 300, remaining: 900 })] }),
        ],
      }),
    }))

    expect(view?.pools.map(pool => [pool.poolLabel, pool.lines.map(line => line.periodStart)])).toEqual([
      ['Core (plan managed)', ['2026-10-01', '2027-01-01']],
      ['Improved Daily Living Skills', ['2026-10-01']],
    ])
  })

  it('carries the part of the agreement no pool covers, and the part outside the plan\'s dates, as the server sent them: shown, never dropped', () => {
    const view = agreementBudgetView('p-1', state({ data: agreementCheck({ notInARecordedPool: 410.5, outsideThePlan: 1200 }) }))

    expect(view).toMatchObject({ status: 'ready', notInARecordedPool: 410.5, outsideThePlan: 1200 })
  })

  it('says no budget is recorded when no plan is running, and points at the participant\'s Funding tab', () => {
    const view = agreementBudgetView('p-1', state({ data: noBudgetCheck() }))

    expect(view).toEqual({
      status: 'none', figures: { visible: true }, pools: [], notInARecordedPool: null, outsideThePlan: null, refreshing: false, noBudgetReason: 'NotRecorded',
      noBudgetAction: { label: 'Open the Funding tab', to: '/participants/p-1?tab=funding' },
    })
  })

  // An ended plan is not "no budget was ever recorded": the Funding tab shows it, so the bar says it ended, and the way on is to record a new plan there.
  it('says the recorded plan ended, and when, and offers to record a new plan on the Funding tab', () => {
    const view = agreementBudgetView('p-1', state({ data: noBudgetCheck({ noBudgetReason: 'PlanEnded', planEnd: '2026-06-30' }) }))

    expect(view).toMatchObject({
      status: 'none', noBudgetReason: 'PlanEnded', planEnd: '2026-06-30',
      noBudgetAction: { label: 'Record a new plan', to: '/participants/p-1?tab=funding' },
    })
  })

  it('reads an answer with no reason, from an older server, as nothing recorded', () => {
    const data = noBudgetCheck() as Partial<ReturnType<typeof noBudgetCheck>>
    delete data.noBudgetReason

    expect(agreementBudgetView('p-1', state({ data: data as ReturnType<typeof noBudgetCheck> }))).toMatchObject({ status: 'none', noBudgetReason: 'NotRecorded' })
  })

  it('carries what the agreement costs in a pool and how far over it is in all, as the server sent them, and nothing when it fits', () => {
    const view = agreementBudgetView('p-1', state({
      data: agreementCheck({
        pools: [
          agreementPool({ poolName: 'Core', periods: [agreementPeriod({ agreementCost: 1000, remaining: 400, overBy: 600 }), agreementPeriod({ periodStart: '2027-01-01', periodEnd: '2027-03-31', agreementCost: 500, remaining: 100, overBy: 400 })] }),
          agreementPool({ poolId: 'pool-ildl', poolName: 'Improved Daily Living Skills', periods: [agreementPeriod({ agreementCost: 300, remaining: 900, overBy: 0 })] }),
        ],
      }),
    }))

    expect(view?.pools.map(pool => [pool.poolLabel, pool.cost, pool.overBy])).toEqual([['Core', 1500, 1000], ['Improved Daily Living Skills', 300, null]])
  })

  it('is loading while the first answer is on its way, and failed, with a way to ask again, when it never came: neither states a figure', () => {
    const loading = agreementBudgetView('p-1', state({ data: undefined, pending: true }))
    expect(loading).toEqual({ status: 'loading', figures: { visible: true }, pools: [], notInARecordedPool: null, outsideThePlan: null })

    const failed = agreementBudgetView('p-1', state({ data: undefined, failed: true }))
    expect(failed).toMatchObject({ status: 'failed', pools: [], notInARecordedPool: null, outsideThePlan: null })
    failed?.onRetry?.()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('keeps the last answer while a newer one is on its way, and says so', () => {
    const view = agreementBudgetView('p-1', state({ pending: true }))

    expect(view).toMatchObject({ status: 'ready', refreshing: true })
    expect(view?.pools).toHaveLength(1)
  })

  it('does not call a failed refresh a failure while there is an answer to show', () => {
    expect(agreementBudgetView('p-1', state({ failed: true }))?.status).toBe('ready')
  })

  it('reads a missing over-by as within, not over: a warning is never invented', () => {
    const period = { ...agreementPeriod() } as Partial<ReturnType<typeof agreementPeriod>>
    delete period.overBy
    const view = agreementBudgetView('p-1', state({ data: agreementCheck({ pools: [agreementPool({ periods: [period as ReturnType<typeof agreementPeriod>] })] }) }))

    expect(view?.pools[0].lines[0]).toMatchObject({ withinLimit: true, overBy: null })
  })
})
