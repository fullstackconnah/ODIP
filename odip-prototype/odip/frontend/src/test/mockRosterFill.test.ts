import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The mock API's roster fill payloads (GET rostering/fill), held to the server's rules: eight Monday-to-Sunday weeks from the Monday of today, filled + open = shifts,
 * and a week with nothing rostered all zeros. The mock is not copied into the frontend's Docker build context, so this suite skips itself there; the require is in
 * beforeEach and never in the describe body (vitest runs a skipped describe's body to collect its tests).
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const MOCK = join(__dirname, '../../../mock-api/mock-roster-fill.js')

type Week = { weekStart: string; shifts: number; filled: number; open: number; hoursFilled: number; hoursOpen: number; draft: number }
type Fill = { today: string; weeks: Week[] }
type Mock = { byFixture: (name: string, today: string) => Fill; FIXTURES: Record<string, unknown> }

describe.skipIf(!existsSync(MOCK))('mock roster fill', () => {
  let mock: Mock
  beforeEach(() => { mock = createRequire(import.meta.url)(MOCK) as Mock })

  it('serves 8 Mondays from the Monday of today, and every week adds up', () => {
    const fill = mock.byFixture('mixed', '2026-11-04')
    expect(fill.weeks.map(w => w.weekStart)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21'])
    for (const w of fill.weeks) expect(w.filled + w.open).toBe(w.shifts)
  })
  it('mixed has a week with drafts and open shifts and a week not rostered yet; empty is all zeros', () => {
    const { weeks } = mock.byFixture('mixed', '2026-11-04')
    expect(weeks[1]).toMatchObject({ open: 6, draft: 4 })
    expect(weeks[5].shifts).toBe(0)
    expect(mock.byFixture('empty', '2026-11-04').weeks.every(w => w.shifts === 0)).toBe(true)
  })
  it('an unknown fixture falls back to mixed', () => {
    expect(mock.byFixture('nope', '2026-11-04')).toEqual(mock.byFixture('mixed', '2026-11-04'))
  })
})
