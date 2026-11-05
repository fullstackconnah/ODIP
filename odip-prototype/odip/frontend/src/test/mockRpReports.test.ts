import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The mock's monthly report routes hold to RestrictivePracticeReportsController: POST answers the whole line, a missing month is a 400 with
 * the server's sentence, and the CSV is the file shape the other mock file routes use. The mock is not copied into the frontend's Docker
 * build context, so the suite skips there and loads the mock in beforeEach (see mockBudgetDemo.test.ts).
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const MOCK = join(__dirname, '../../../mock-api/mock-rp-reports.js')

type Route = [string, (...args: unknown[]) => unknown]
type Created = { get: Route[]; post: Route[] }
type Reply = { status: number; body: { errors?: string[] } }

describe.skipIf(!existsSync(MOCK))('the mock monthly report routes', () => {
  let mock: Created
  beforeEach(() => {
    const require = createRequire(import.meta.url)
    mock = require(MOCK).create({ respond: (status: number, body: unknown) => ({ status, body }), failEnvelope: (_d: unknown, errors: string[]) => ({ errors }) }) as Created
  })
  const post = (body: unknown) => (mock.post.find(r => r[0] === 'restrictive-practice-reports') as Route)[1](body) as Reply & Record<string, unknown>
  const lodge = { restrictivePracticeId: 'rp-alex', month: '2026-10-01', reportType: 'NotUsed', lodgedOn: '2026-11-04', note: 'ok' }

  it('answers a lodge with the whole line, report included', () => {
    const line = post(lodge)
    expect(line).toMatchObject({ restrictivePracticeId: 'rp-alex', month: '2026-10-01', state: 'Lodged', report: { reportType: 'NotUsed', lodgedOn: '2026-11-04' } })
  })

  it('answers a month with no line with 400 and the server sentence', () => {
    const reply = post({ ...lodge, month: '2020-01-01' })
    expect(reply.status).toBe(400)
    expect(reply.body.errors).toEqual(['This practice has no monthly report for that month.'])
  })

  it('answers a month already lodged with 409 and the server sentence', () => {
    post(lodge)
    const reply = post(lodge)
    expect(reply.status).toBe(409)
    expect(reply.body.errors).toEqual(['This month has already been lodged. Reload to see it.'])
  })

  it('serves the CSV as a file', () => {
    const route = mock.get.find(r => r[0] === 'restrictive-practice-reports/csv') as Route
    const file = route[1](new URLSearchParams({ month: '2026-10-01' })) as Record<symbol, string> & { contentType: string }
    expect(file.contentType).toBe('text/csv')
    const text = Object.getOwnPropertySymbols(file).map(s => file[s]).find(v => typeof v === 'string')
    expect(text).toContain('Participant,Practice,Month')
  })
})
