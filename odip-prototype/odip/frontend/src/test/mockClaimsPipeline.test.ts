import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The mock API's claims pipeline payloads (GET claim-hub/pipeline), held to the server's rules: 12 weeks, Mondays, the last one the week of today, oldest first.
 * The mock is not copied into the frontend's Docker build context, so this suite skips itself there; the require is in beforeEach and never in the describe
 * body (vitest runs a skipped describe's body to collect its tests).
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const MOCK = join(__dirname, '../../../mock-api/mock-claims-pipeline.js')

type Week = { weekStart: string; sent: number; paid: number; rejected: number; rejectedLines: number }
type Pipeline = { today: string; weeks: Week[]; withNdia: number; acceptedUnpaid: number; undatedPaid: number }
type Mock = { byFixture: (name: string, today: string) => Pipeline }

describe.skipIf(!existsSync(MOCK))('mock claims pipeline', () => {
  let mock: Mock
  beforeEach(() => { mock = createRequire(import.meta.url)(MOCK) as Mock })

  it('serves 12 Mondays, oldest first, the last being the week of today', () => {
    const p = mock.byFixture('mixed', '2026-11-01') // a Sunday: its week starts Monday 26 October
    expect(p.weeks).toHaveLength(12)
    expect(p.weeks[11].weekStart).toBe('2026-10-26')
    expect(p.weeks[0].weekStart).toBe('2026-08-10')
    for (const w of p.weeks) expect(new Date(`${w.weekStart}T00:00:00Z`).getUTCDay()).toBe(1)
  })
  it('empty is all zeros with nothing owed; owed has no weeks but a figure waiting on the NDIA', () => {
    const empty = mock.byFixture('empty', '2026-11-04')
    expect(empty.weeks.every(w => w.sent === 0 && w.paid === 0 && w.rejected === 0)).toBe(true)
    expect(empty.withNdia).toBe(0)
    const owed = mock.byFixture('owed', '2026-11-04')
    expect(owed.weeks.every(w => w.sent === 0 && w.paid === 0)).toBe(true)
    expect(owed.withNdia).toBe(4800)
  })
  it('high holds a six-figure week; undated carries the pre-dating footnote figure', () => {
    expect(Math.max(...mock.byFixture('high', '2026-11-04').weeks.map(w => w.sent))).toBe(128400.5)
    expect(mock.byFixture('undated', '2026-11-04').undatedPaid).toBe(1234.5)
    expect(mock.byFixture('mixed', '2026-11-04').undatedPaid).toBe(0)
  })
  it('an unknown fixture falls back to mixed', () => {
    expect(mock.byFixture('nope', '2026-11-04')).toEqual(mock.byFixture('mixed', '2026-11-04'))
  })
})
