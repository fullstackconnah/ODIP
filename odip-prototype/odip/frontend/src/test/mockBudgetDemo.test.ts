import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The mock API's budget warnings (budget phase 2b): the Budgets list, the participant alerts and the agreement check, worked out from the mock ledger with the server's rules and words. This holds
 * the demo to what the screens and the screenshots rely on - one pool over, one forecast over, one approaching, and one on which the NDIA has refused a claim for want of funds - so a change to
 * the ledger's demo items cannot quietly lose one of them, and holds the mock to the real API's shape (it omits nulls).
 *
 * The mock lives next to the frontend in the repository but is not copied into the frontend's Docker build context, so the guard skips there. The mock reads the day from the clock, so the clock is fixed.
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const FUNDING = join(__dirname, '../../../mock-api/funding.js')

type Route = [string, (...args: unknown[]) => unknown]
type Created = { get: Route[]; post: Route[] }

const people = [
  { id: 'p-0001', firstName: 'Liam', lastName: 'Okafor', preferredName: null, planType: 'PlanManaged', isActive: true },
  { id: 'p-0002', firstName: 'Sienna', lastName: 'Whitfield', preferredName: 'Sisi', planType: 'AgencyManaged', isActive: true },
  { id: 'p-0003', firstName: 'Marcus', lastName: 'Tran', preferredName: null, planType: 'SelfManaged', isActive: true },
  { id: 'p-0004', firstName: 'Grace', lastName: 'Palmer-Hughes', preferredName: 'Gracie', planType: 'PlanManaged', isActive: true },
  { id: 'p-0005', firstName: 'Dylan', lastName: 'Marchetti', preferredName: null, planType: 'AgencyManaged', isActive: true },
  { id: 'p-0006', firstName: 'Aisha', lastName: 'Rahimi', preferredName: null, planType: 'PlanManaged', isActive: false },
]

/** Priced lines of an agreement: 8 hours of community access (category 4) on one day of the current quarter, and again on one day of the next. */
const lines = [
  { serviceDate: '2026-10-20', paceCategory: 4, total: 588.64, isPriced: true },
  { serviceDate: '2027-01-12', paceCategory: 4, total: 588.64, isPriced: true },
  { serviceDate: '2026-10-21', paceCategory: 15, total: 100, isPriced: true },
  { serviceDate: '2026-10-22', paceCategory: 4, total: 0, isPriced: false },
]

function load(): Created {
  const require = createRequire(import.meta.url)
  return require(FUNDING).create({ respond: (status: number, body: unknown) => ({ status, body }), fundingSources: [], people, priceLines: () => lines }) as Created
}

const handler = (routes: Route[], pattern: string) => (routes.find(route => route[0] === pattern) as Route)[1]

const BUDGETS = join(__dirname, '../../../mock-api/mock-budgets.js')

// A plan recorded for later (fix round 2): the mock's ledger carries the soonest start as nextPlanStart, as the server's ParticipantLedger.NextPlanStart does, and the list and the check say it.
describe.skipIf(!existsSync(BUDGETS))('the mock says when a plan recorded for later starts', () => {
  const { budgetList, agreementCheckOf } = createRequire(import.meta.url)(BUDGETS) as {
    budgetList: (people: unknown[], ledgerOf: (id: string) => unknown, today: string, approaching: number) => { noBudget: Array<Record<string, unknown>> }
    agreementCheckOf: (ledger: unknown, planType: string, lines: unknown[], from: string, to: string, today: string) => Record<string, unknown>
  }
  const person = { id: 'p-x', firstName: 'Una', lastName: 'Upcoming', preferredName: null, planType: 'PlanManaged', isActive: true }
  const upcomingOnly = { planIsCurrent: false, nextPlanStart: '2026-11-01', pools: [] }
  const endedThenUpcoming = { planId: 'plan-1', planIsCurrent: false, planStart: '2025-07-01', planEnd: '2026-06-30', nextPlanStart: '2026-11-01', pools: [] }
  const endedOnly = { planId: 'plan-1', planIsCurrent: false, planStart: '2025-07-01', planEnd: '2026-06-30', pools: [] }

  it('puts a participant with only a later plan in the list tail as NotStarted, with the day, and keeps the other two reasons as they were', () => {
    const tail = (ledger: unknown) => budgetList([person], () => ledger, '2026-10-08', 80).noBudget[0]

    expect(tail(upcomingOnly)).toEqual({ participantId: 'p-x', participantName: 'Una Upcoming', reason: 'NotStarted', planStart: '2026-11-01' })
    expect(tail(endedThenUpcoming)).toMatchObject({ reason: 'NotStarted', planStart: '2026-11-01' })   // a successor that is recorded outranks the plan that ended
    expect(tail(endedOnly)).toEqual({ participantId: 'p-x', participantName: 'Una Upcoming', reason: 'PlanEnded', planEnd: '2026-06-30' })
    expect(tail({ planIsCurrent: false, pools: [] })).toEqual({ participantId: 'p-x', participantName: 'Una Upcoming', reason: 'NotRecorded' })
  })

  it('says it in the agreement check too, as the server does, and prices nothing', () => {
    const check = (ledger: unknown) => agreementCheckOf(ledger, 'PlanManaged', [], '2026-10-12', '2027-01-31', '2026-10-08')

    expect(check(upcomingOnly)).toMatchObject({ hasBudget: false, noBudgetReason: 'NotStarted', planStart: '2026-11-01', pools: [], agreementCost: 0 })
    expect(check(endedThenUpcoming)).toMatchObject({ noBudgetReason: 'NotStarted', planStart: '2026-11-01' })
    expect(check(endedThenUpcoming)).not.toHaveProperty('planEnd')
    expect(check(endedOnly)).toMatchObject({ noBudgetReason: 'PlanEnded', planEnd: '2026-06-30' })
  })
})

describe.skipIf(!existsSync(FUNDING))('the mock API serves the budget warnings (phase 2b)', () => {
  let mock: Created
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T03:00:00Z'))
    mock = load()
  })
  afterEach(() => { vi.useRealTimers() })

  const list = () => handler(mock.get, 'funding/budgets')() as { asOf: string; rows: Array<Record<string, unknown>>; noBudget: Array<Record<string, unknown>> }
  const alertsOf = (id: string) => (handler(mock.get, 'participants/:id/alerts')(id) as { alerts: Array<{ type: string; severity: string; message: string; deepLinkTab: string }> }).alerts

  it('lists every active participant\'s pools for the period running now, by risk and then by name, with the NDIS-funded participants who have no budget kept apart', () => {
    const { asOf, rows, noBudget } = list()

    expect(asOf).toBe('2026-10-08')
    // The NDIA has refused a claim of Gracie's Core, which ODIP's own figures call on track: the list ranks it straight after Over, with the NDIA's word on the row.
    expect(rows.map(row => [row.participantName, row.poolName, row.status])).toEqual([
      ['Dylan Marchetti', 'Core', 'Over'],
      ['Gracie Palmer-Hughes', 'Core', 'OnTrack'],
      ['Sisi Whitfield', 'Core', 'ForecastOver'],
      ['Sisi Whitfield', 'Improved Daily Living Skills', 'Approaching'],
      ['Dylan Marchetti', 'Improved Daily Living Skills', 'OnTrack'],
    ])
    expect(rows.map(row => row.ndiaRejection)).toEqual([undefined, { date: '2026-10-08', code: 'V27', claimId: 'claim-0003', claimReference: 'TC-43000412-20261008' }, undefined, undefined, undefined])
    // What is left, or how far over (available minus used), and how much of what is available was rolled over.
    expect(rows.map(row => [row.remaining, row.carried])).toEqual([[-1563.21, 0], [38899, 0], [1541.32, 448.66], [108.22, 864.86], [1740.44, 1008.22]])
    expect(rows.map(row => row.unpricedShiftCount)).toEqual([0, 0, 1, 0, 0])   // only Sienna's Core, which has the sleepover
    expect(noBudget).toEqual([
      { participantId: 'p-0001', participantName: 'Liam Okafor', reason: 'NotRecorded' },
      { participantId: 'p-0003', participantName: 'Marcus Tran', reason: 'PlanEnded', planEnd: '2026-06-30' },
    ])
  })

  it('has one pool over, one forecast over, one approaching, and the NDIA\'s word on a pool that is on track, each as an alert that opens the Funding tab, in the server\'s words', () => {
    expect(alertsOf('p-0005')).toEqual([{ type: 'budget-over', severity: 'Critical', message: 'Core is $1,563.21 over this period\'s $403.29', deepLinkTab: 'funding' }])
    // Worse first: the banner shows three and "+N more" behind them, so the milder warning must not crowd out the worse one.
    expect(alertsOf('p-0002').map(alert => [alert.type, alert.severity])).toEqual([['budget-forecast-over', 'Warning'], ['budget-approaching', 'Warning']])
    // Sienna's Core has a sleepover in the quarter, which the shift claim cannot price yet: the alert says the figures leave it out.
    expect(alertsOf('p-0002')[0].message).toBe('Booked shifts would take Core $1,354.68 over by 31 Dec 2026. 1 shift in this period is not priced yet, so this leaves it out')
    expect(alertsOf('p-0002')[1].message).toBe('Improved Daily Living Skills is at 94% of this period\'s $2,074.72 (to 31 Dec 2026)')
    expect(alertsOf('p-0004')).toEqual([{ type: 'budget-ndia-exhausted', severity: 'Critical', message: 'Core: NDIA rejected a claim on 8 Oct 2026: not enough funds (V27)', deepLinkTab: 'funding' }])
  })

  it('has no alert for a participant with no plan, or whose plan has ended', () => {
    expect(alertsOf('p-0001')).toEqual([])
    expect(alertsOf('p-0003')).toEqual([])
  })

  it('serves the aggregate for the active participants only, Critical first within each, with the counts that follow', () => {
    const all = handler(mock.get, 'participants/alerts')() as Array<{ participantId: string; criticalCount: number; warningCount: number; budgetInForce: boolean; alerts: unknown[] }>

    expect(all.map(entry => entry.participantId)).toEqual(['p-0001', 'p-0002', 'p-0003', 'p-0004', 'p-0005'])   // p-0006 is not active
    expect(all.map(entry => [entry.criticalCount, entry.warningCount])).toEqual([[0, 0], [0, 2], [0, 0], [1, 0], [1, 0]])
    // Who has a budget in force (a plan running now): Liam has none recorded and Marcus's plan has ended, so the dashboard can tell "no budget is at risk" from "no budget is recorded".
    expect(all.map(entry => entry.budgetInForce)).toEqual([false, true, false, true, true])
  })

  it('says the NDIA\'s word on the Funding tab\'s pool, with the claim, and nowhere else', () => {
    const ledger = handler(mock.get, 'participants/:id/funding/ledger')('p-0004') as { pools: Array<{ name: string; ndiaRejection?: Record<string, string>; planTotal: Record<string, number> }> }

    expect(ledger.pools[0].ndiaRejection).toEqual({ date: '2026-10-08', code: 'V27', claimId: 'claim-0003', claimReference: 'TC-43000412-20261008' })
    // The pool's plan total is worked out from its periods (it was NaN, and so null on the wire, when it summed plain numbers as if they were rows). Her started trip with no claim yet is pending.
    expect(ledger.pools[0].planTotal).toMatchObject({ limit: 40000, claimed: 621, pending: 480, bookedAhead: 276, forecast: 1377 })
    const other = handler(mock.get, 'participants/:id/funding/ledger')('p-0005') as { pools: Array<{ ndiaRejection?: unknown }> }
    expect(other.pools.every(pool => pool.ndiaRejection === undefined)).toBe(true)
  })

  it('splits an agreement over the pools and funding periods it touches, with what is left in each and how far over', () => {
    const check = handler(mock.post, 'participants/:id/funding/agreement-check')('p-0002', {
      blocks: [{ id: 'b1' }], periodFrom: '2026-10-12', periodTo: '2027-01-31',
    }) as { hasBudget: boolean; agreementCost: number; pools: Array<{ poolName: string; over: boolean; overBy: number; periods: Array<Record<string, unknown>> }>; notInARecordedPool: number }

    expect(check.hasBudget).toBe(true)
    expect(check.pools.map(pool => [pool.poolName, pool.periods.map(period => period.periodStart)])).toEqual([
      ['Core', ['2026-10-01', '2027-01-01']],
      ['Improved Daily Living Skills', ['2026-10-01']],
    ])
    const [firstQuarter, secondQuarter] = check.pools[0].periods
    // Available minus used is what is left (the ledger's own figures, 3,473.32 less 1,932), and the cost over it is how far over.
    expect(firstQuarter).toMatchObject({ agreementCost: 588.64, available: 3473.32, used: 1932, remaining: 1541.32, overBy: 0, isCurrent: true })
    expect(secondQuarter).toMatchObject({ agreementCost: 588.64, isCurrent: false, overBy: 0 })
    // What the agreement spends in the first quarter is not there for the second: the ledger's own available for it, less the $588.64 the agreement uses up in the first (AgreementCarry on the server).
    const ledger = handler(mock.get, 'participants/:id/funding/ledger')('p-0002') as { pools: Array<{ periods: Array<{ periodStart: string; periodEnd: string; available: number }> }> }
    const ledgerSecond = ledger.pools[0].periods.find(period => period.periodStart <= '2027-01-12' && '2027-01-12' <= period.periodEnd) as { available: number }
    expect(secondQuarter.available).toBe(Math.round((ledgerSecond.available - 588.64) * 100) / 100)
    expect(check.pools[1].periods[0]).toMatchObject({ agreementCost: 100, remaining: 108.22, overBy: 0 })
    expect(check.pools.map(pool => pool.overBy)).toEqual([0, 0])   // the pool's whole shortfall: nothing here is over
    expect(check.agreementCost).toBe(1277.28)   // a line that is not priced adds nothing
    expect(check.notInARecordedPool).toBe(0)
  })

  // Dylan's Core is already over in the first quarter (-$1,563.21 left), so the agreement's cost there is all past what is left and the period's over-by counts that excess too: the check says how much
  // of the pool's over-by was already there, so the sum never reads as an overspend bigger than the agreement (AgreementCarry's AlreadyOverBy on the server).
  it('says how much of a pool over-by was already over before the agreement', () => {
    const check = handler(mock.post, 'participants/:id/funding/agreement-check')('p-0005', {
      blocks: [{ id: 'b1' }], periodFrom: '2026-10-12', periodTo: '2027-01-31',
    }) as { pools: Array<{ poolName: string; over: boolean; agreementCost: number; overBy: number; alreadyOverBy: number; periods: Array<Record<string, unknown>> }> }

    const core = check.pools[0]
    expect(core).toMatchObject({ poolName: 'Core', over: true, agreementCost: 1177.28 })
    expect(core.periods[0]).toMatchObject({ remaining: -1563.21, agreementCost: 588.64, overBy: 2151.85 })
    expect(core.alreadyOverBy).toBe(1563.21)
    expect(core.overBy - core.alreadyOverBy).toBeLessThanOrEqual(core.agreementCost)
    // Nothing was already over in a pool that is not: Sienna's pools say 0, and a pool over only by the agreement does too.
    const sienna = handler(mock.post, 'participants/:id/funding/agreement-check')('p-0002', { blocks: [{ id: 'b1' }], periodFrom: '2026-10-12', periodTo: '2027-01-31' }) as { pools: Array<{ alreadyOverBy: number }> }
    expect(sienna.pools.map(pool => pool.alreadyOverBy)).toEqual([0, 0])
  })

  it('says there is no budget when no plan is running, and prices nothing', () => {
    const check = handler(mock.post, 'participants/:id/funding/agreement-check')('p-0001', { blocks: [{ id: 'b1' }], periodFrom: '2026-10-12', periodTo: '2027-01-31' }) as Record<string, unknown>

    expect(check).toEqual({ hasBudget: false, noBudgetReason: 'NotRecorded', asOf: '2026-10-08', periodFrom: '2026-10-12', periodTo: '2027-01-31', agreementCost: 0, pools: [], notInARecordedPool: 0, outsideThePlan: 0 })

    // Marcus's plan has ended: the answer says so, and when, in the Budgets list's own two words.
    const ended = handler(mock.post, 'participants/:id/funding/agreement-check')('p-0003', { blocks: [{ id: 'b1' }], periodFrom: '2026-10-12', periodTo: '2027-01-31' }) as Record<string, unknown>
    expect(ended).toMatchObject({ hasBudget: false, noBudgetReason: 'PlanEnded', planEnd: '2026-06-30', pools: [] })
  })

  it('refuses what the real API refuses: no blocks or dates, an end before the start, and a participant that is not there', () => {
    const check = handler(mock.post, 'participants/:id/funding/agreement-check')
    expect(check('p-0002', {})).toMatchObject({ status: 400 })
    expect(check('p-0002', { blocks: [], periodFrom: '2027-01-31', periodTo: '2026-10-12' })).toMatchObject({ status: 400 })
    expect(check('p-9999', { blocks: [], periodFrom: '2026-10-12', periodTo: '2027-01-31' })).toMatchObject({ status: 404 })
  })

  it('omits what it does not know instead of sending null, as the real API does', () => {
    const everything = JSON.stringify([list(), handler(mock.get, 'participants/alerts')(), handler(mock.get, 'participants/:id/funding/ledger')('p-0004'),
      handler(mock.post, 'participants/:id/funding/agreement-check')('p-0002', { blocks: [{ id: 'b1' }], periodFrom: '2026-10-12', periodTo: '2027-01-31' })])

    expect(everything).not.toContain(':null')
  })
})
