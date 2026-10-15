import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The mock API's roster budget module (budget phase 3), held to the server on the one rule the panels branch on: a shift or pattern with no length (the end at or before the start, and not ending the next day) is
 * refused with a 400 that carries the server's sentence and the code "shift-no-length", for a shift's check and create and for a pattern's create and update. The pattern update only refuses an edit that changes the
 * times, as the server does, so a pattern saved before the rule can still be switched off.
 *
 * The mock lives next to the frontend in the repository but is not copied into the frontend's Docker build context, so this suite skips itself there (the existsSync guard below). The require is in
 * beforeEach and never in the describe body: vitest still runs the body of a skipped describe to collect its tests, so requiring there throws `Cannot find module` at collection time and fails the file.
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROSTER_BUDGET = join(__dirname, '../../../mock-api/rosterBudget.js')
const SERVER = join(__dirname, '../../../mock-api/server.js')

const SENTENCE = "The shift must end after it starts. Tick 'Ends the next day' for an overnight shift."

type Reply = { status: number; body: { success: boolean; errors?: string[]; code?: string } }
type Times = { startTime: string; endTime: string; endsNextDay?: boolean }
type Created = {
  refuseNoLength: (body: Times) => Reply | null
  refusePatternNoLength: (existing: Times | null, body: Partial<Times> & Record<string, unknown>) => Reply | null
  post: Array<[string, (body: unknown) => unknown]>
}

function load(): Created {
  const require = createRequire(import.meta.url)
  const respond = (status: number, body: Reply['body']): Reply => ({ status, body })
  const failEnvelope = (_data: unknown, errors: string[], code?: string) => ({ success: false, ...(errors ? { errors } : {}), ...(code ? { code } : {}) })
  return require(ROSTER_BUDGET).create({
    funding: { settings: () => ({ approachingPercent: 80 }), plansOf: () => [] },
    respond, failEnvelope, rosterShifts: [], tasks: [], participants: [], today: () => '2026-10-09',
  }) as Created
}

describe.skipIf(!existsSync(ROSTER_BUDGET))('the mock refuses a shift or pattern with no length, as the server does', () => {
  let mock: Created

  beforeEach(() => {
    mock = load()
  })

  it('answers 400 with the server’s sentence and the code the panels recognise it by', () => {
    const refusal = mock.refuseNoLength({ startTime: '09:00', endTime: '09:00' })

    expect(refusal).toEqual({ status: 400, body: { success: false, errors: [SENTENCE], code: 'shift-no-length' } })
    expect(mock.refuseNoLength({ startTime: '22:00', endTime: '06:00' })).not.toBeNull()
  })

  it('lets a shift with a length through, an overnight one with the box ticked included', () => {
    expect(mock.refuseNoLength({ startTime: '09:00', endTime: '10:00' })).toBeNull()
    expect(mock.refuseNoLength({ startTime: '22:00', endTime: '06:00', endsNextDay: true })).toBeNull()
  })

  it('refuses the shift check and the shift create with it', () => {
    const noLength = { startTime: '09:00', endTime: '08:00', participantId: 'p-0002', serviceDate: '2026-10-09' }

    for (const route of ['rostering/shifts/check', 'rostering/shifts']) {
      const handler = (mock.post.find(([pattern]) => pattern === route) as [string, (body: unknown) => Reply])[1]
      expect(handler(noLength), route).toEqual({ status: 400, body: { success: false, errors: [SENTENCE], code: 'shift-no-length' } })
    }
  })

  it('refuses a new pattern with no length, and a pattern edit that gives it none', () => {
    expect(mock.refusePatternNoLength(null, { startTime: '09:00', endTime: '09:00' })?.body.code).toBe('shift-no-length')
    const saved = { startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false }

    expect(mock.refusePatternNoLength(saved, { endTime: '08:00' })?.body.errors).toEqual([SENTENCE])
  })

  it('leaves alone a pattern saved before the rule while its times are not changed (switching it off, editing its notes)', () => {
    const legacy = { startTime: '09:00:00', endTime: '09:00:00', endsNextDay: false }

    expect(mock.refusePatternNoLength(legacy, { isActive: false, notes: 'Stopped while the agreement is reviewed' })).toBeNull()
    expect(mock.refusePatternNoLength(legacy, { startTime: '09:00', endTime: '09:00' })).toBeNull()   // the same times, sent back by the form
    expect(mock.refusePatternNoLength(legacy, { endTime: '08:00' })).not.toBeNull()                   // a fresh bad time
  })

  it('is wired into the pattern routes of the mock server, create and update (and nowhere else in it)', () => {
    const source = readFileSync(SERVER, 'utf-8')

    expect(source).toContain("['rostering/patterns', (body) =>")
    expect((source.match(/rosterBudget\.refusePatternNoLength\(/g) ?? []).length).toBe(2)
  })
})
