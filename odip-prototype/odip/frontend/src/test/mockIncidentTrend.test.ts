import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The mock API's incident trend payloads (GET incidents/trend), held to the server's rules: six months ending in the month of today, oldest first, and
 * incidents = rpUses + otherIncidents. The mock is not copied into the frontend's Docker build context, so this suite skips itself there; the require is in
 * beforeEach and never in the describe body (vitest runs a skipped describe's body to collect its tests).
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const MOCK = join(__dirname, '../../../mock-api/mock-incident-trend.js')

type Month = { month: string; incidents: number; rpUses: number; otherIncidents: number }
type Trend = { today: string; months: Month[] }
type Mock = { byFixture: (name: string, today: string) => Trend }

describe.skipIf(!existsSync(MOCK))('mock incident trend', () => {
  let mock: Mock
  beforeEach(() => { mock = createRequire(import.meta.url)(MOCK) as Mock })

  it('serves 6 months ending in the month of today, across a year boundary, and every month adds up', () => {
    const t = mock.byFixture('mixed', '2026-02-10')
    expect(t.months.map(m => m.month)).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'])
    for (const m of t.months) expect(m.rpUses + m.otherIncidents).toBe(m.incidents)
  })
  it('longest pins today to 2026-04-15 and holds a zero month; high has a 1,240 month; empty is all zeros', () => {
    const longest = mock.byFixture('longest', '2026-11-01')
    expect(longest.today).toBe('2026-04-15')
    expect(longest.months.map(m => m.month)[0]).toBe('2025-11')
    expect(longest.months[1].incidents).toBe(0)
    expect(Math.max(...mock.byFixture('high', '2026-11-01').months.map(m => m.incidents))).toBe(1240)
    expect(mock.byFixture('empty', '2026-11-01').months.every(m => m.incidents === 0)).toBe(true)
  })
  it('an unknown fixture falls back to mixed', () => {
    expect(mock.byFixture('nope', '2026-11-04')).toEqual(mock.byFixture('mixed', '2026-11-04'))
  })
})
