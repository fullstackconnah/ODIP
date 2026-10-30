import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BatchDto, BuildProblemDto, HubLinesDto, ResultsImportDto } from '@/api/types'

/**
 * The mock API's claims hub module, held to the PLAN.md §9 contract on the points the page branches on. The mock is not in the frontend's Docker build
 * context, so the suite skips itself there; the require is in beforeEach, never the describe body (vitest still collects a skipped describe's body).
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const MODULE = join(__dirname, '../../../mock-api/claimHub.js')

const HTTP = Symbol('http')
const FILE = Symbol('file')
type Handler = (...args: unknown[]) => unknown
type Refusal = { [HTTP]: number; body: { data: { problems: BuildProblemDto[] }; errors: string[] } }
let get: (path: string) => Handler
let post: (path: string) => Handler

describe.skipIf(!existsSync(MODULE))('mock claims hub', () => {
  beforeEach(() => {
    const require = createRequire(import.meta.url)
    const hub = require(MODULE).create({
      respond: (status: number, body: unknown) => ({ [HTTP]: status, body }),
      failEnvelope: (data: unknown, errors: string[]) => ({ success: false, data, errors }),
      FILE,
    })
    const pick = (list: [string, Handler][]) => (path: string) => list.find(([p]) => p === path)![1]
    get = pick(hub.get)
    post = pick(hub.post)
  })

  it('serves the age band edges, a blocked line with two failures and the files in every step', () => {
    const lines = get('claim-hub/lines')() as HubLinesDto
    const byAge = Object.fromEntries(lines.ready.map(l => [l.ageDays, l.ageBand]))
    expect(byAge).toMatchObject({ 59: 'none', 60: 'amber', 80: 'red', 90: 'red', 91: 'over90' })
    expect(lines.ready.some(l => l.problems.length === 2)).toBe(true)
    expect(new Set(lines.rejected.map(l => l.needsDecision))).toEqual(new Set([true, false]))
    expect((get('claim-batches')() as BatchDto[]).map(b => b.status)).toEqual(['Built', 'Uploaded', 'ResultsImported', 'ResultsImported', 'Discarded'])
  })

  it('builds a file from clean lines as a CSV naming itself and its batch, and refuses a blocked line with its problem', () => {
    const built = post('claim-batches')({ lineIds: ['hl-1', 'hl-2'] }) as { headers: Record<string, string> }
    expect(built.headers['X-Claim-Batch-Id']).toMatch(/^b-new-/)
    expect(built.headers['Content-Disposition']).toMatch(/filename="BPR261030\d{3}\.csv"/)
    expect((get('claim-hub/lines')() as HubLinesDto).ready.some(l => l.lineId === 'hl-1')).toBe(false)

    const refused = post('claim-batches')({ lineIds: ['hl-6'] }) as Refusal
    expect(refused[HTTP]).toBe(400)
    expect(refused.body.data.problems[0]).toMatchObject({ lineId: 'hl-6', rule: 'PriceLimit' })
  })

  it("answers the per-claim download's 409s (G9) and the discarded file's re-download", () => {
    expect((get('claims/:id/bpr-csv')('hub-claim-b-uploaded-0') as Refusal).body.errors[0]).toBe("This claim was sent in BPR261028001.csv. Import that file's results in Claims before lodging it again.")
    expect((get('claims/:id/bpr-csv')('hub-claim-b-built-0') as Refusal).body.errors[0]).toBe('This claim is in BPR261030001.csv with other claims. Download it from Claims, or discard it first.')
    post('claim-batches/:id/discard')('b-built')
    expect((get('claim-batches/:id/file')('b-built') as Refusal).body.errors[0]).toBe('This file was discarded. Build a new one.')
  })

  it('moves a file through upload, import and paid', () => {
    expect((post('claim-batches/:id/uploaded')('b-built') as BatchDto).status).toBe('Uploaded')
    const summary = post('claim-batches/:id/results')('b-built', { _form: 'filename="results.csv"' }) as ResultsImportDto
    expect(summary).toMatchObject({ successful: 3, rejected: 1, leftAlone: 0, batch: { status: 'ResultsImported' } })
    expect(post('claim-batches/:id/paid')('b-built', { lines: [] })).toMatchObject({ paid: 3 })
  })
})
