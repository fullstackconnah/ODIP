import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The mock API computes money (plan quotes and the budget ledger) with its own copies of the engine's rules. This holds those copies to the real C# engine on one fixed input each: the fixtures under
 * src/test/fixtures/golden are WRITTEN BY the engine (PlanQuoteFrontendFixtureTests), so a rule the mock gets wrong, or an engine rule that changes, fails here.
 * To refresh the files after an intended engine change: `ODIP_REGENERATE_GOLDEN=1 dotnet test --filter PlanQuoteFrontendFixtureTests`, then run this file. A missing file fails; it never skips.
 *
 * The mock is not copied into the frontend's Docker build context, so the suite skips itself there (the existsSync guard). The require is in beforeEach and never in the describe body: vitest runs the
 * body of a skipped describe to collect its tests, so requiring there throws `Cannot find module` at collection time.
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const MOCK_DIR = join(__dirname, '../../../mock-api')
const GOLDEN = join(__dirname, 'fixtures/golden')

function fixture<T>(name: string): T {
  const path = join(GOLDEN, name)
  if (!existsSync(path)) throw new Error(`${name} is missing: run \`ODIP_REGENERATE_GOLDEN=1 dotnet test --filter PlanQuoteFrontendFixtureTests\` to write it.`)
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

type Line = { blockId: string; kind: string; itemCode?: string; qty: number; unitPrice: number; total: number; serviceDate: string; isPriced: boolean }
type Quote = { lines: Line[]; totals: { amount: number } }
const priced = (quote: Quote) => quote.lines
  .filter((l) => l.isPriced)
  .map(({ blockId, kind, itemCode, qty, unitPrice, total, serviceDate }) => ({ blockId, kind, itemCode, qty, unitPrice, total, serviceDate }))

describe.skipIf(!existsSync(MOCK_DIR))('the mock API\u2019s money is the engine\u2019s on a fixed input', () => {
  let planPricing: { quote: (request: unknown, settings: unknown) => Quote; defaultSettings: () => unknown }
  let ledger: { computeLedger: (plan: unknown, today: string, percent: number, items: unknown[]) => { pools: Array<{ periods: Array<Record<string, unknown>> }> } }

  beforeEach(() => {
    const require = createRequire(import.meta.url)
    planPricing = require(join(MOCK_DIR, 'planPricing.js'))
    ledger = require(join(MOCK_DIR, 'mock-ledger.js'))
  })

  it('prices the week with a sleepover, an eight-hour day, a high intensity block and a holiday as the engine does', () => {
    const { request, quote } = fixture<{ request: unknown; quote: Quote }>('plan-quote-mock-parity.json')

    const mock = planPricing.quote(request, planPricing.defaultSettings())

    expect(priced(mock)).toEqual(priced(quote))
    expect(mock.totals.amount).toBe(quote.totals.amount)
  })

  it('calls a pool used to exactly 80% Approaching, as the engine does', () => {
    const { input, expected } = fixture<{ input: { planAmount: number; claimed: number; approachingPercent: number; today: string }; expected: Record<string, unknown> }>('budget-ledger-mock-parity.json')
    const plan = {
      id: 'plan', planStart: '2026-07-01', planEnd: '2027-06-30',
      pools: [{ id: 'core', name: 'Core (flexible)', kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged', position: 0, periods: [{ id: 'q', periodStart: '2026-07-01', periodEnd: '2027-06-30', planAmount: input.planAmount }] }],
    }
    const item = { kind: 'ClaimLine', group: 'Claimed', date: '2026-08-03', amount: input.claimed, paceCategory: 4, managementType: 'PlanManaged', description: 'claimed' }

    const period = ledger.computeLedger(plan, input.today, input.approachingPercent, [item]).pools[0].periods[0]

    expect({ available: period.available, used: period.used, forecast: period.forecast, status: period.status }).toEqual(expected)
  })
})
