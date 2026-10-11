import { describe, expect, it } from 'vitest'
import type { PlanBlockRequirements, PlanDayName, PlanIssue } from '@/api/types'
import { emptyBlock } from './planBlocks'
import { groupShifts, shiftBlockOf, type Shift } from './agreementShifts'
import { agreementIssues } from './agreementIssues'

const REQ: PlanBlockRequirements = { workerGender: 'NoPreference', driver: false, skills: [] }
const shift = (day: PlanDayName, changes: Partial<Shift['block']> = {}, id = `${day}-${changes.start ?? '09'}`): Shift => {
  return { id, day, block: { ...shiftBlockOf(emptyBlock('x', 'NSW')), ...changes }, requirements: REQ }
}
const issue = (changes: Partial<PlanIssue>): PlanIssue => ({ blockId: 'b1', reason: 'NoItem', message: "Block 'b1' has no price item from 00:00 to 06:00", count: 4, firstDate: '2026-10-13', ...changes })
const run = (shifts: Shift[], quoteIssues: PlanIssue[] = [], to = '2027-06-30') =>
  agreementIssues({ shifts, groups: groupShifts(shifts), quoteIssues, limits: { blocks: 1, patterns: 1, exceeded: null }, to })

describe('agreementIssues', () => {
  it('has nothing to say about a clean week', () => {
    expect(run([shift('Monday'), shift('Tuesday')])).toEqual([])
  })

  it('names what is wrong with a shift in plain words and points at the shifts to fix', () => {
    const [problem] = run([shift('Monday', { workers: 0 }, 'a'), shift('Tuesday', { workers: 0 }, 'b')])
    expect(problem).toMatchObject({ tone: 'fix', step: 'week', shiftIds: ['a', 'b'] })
    expect(problem.title).toBe('Mon, Tue 09:00 to 13:00: Workers must be between 1 and 10.')
  })

  it('maps an engine issue back to the shifts it came from and keeps the word block off the screen', () => {
    const shifts = [shift('Monday', { start: '03:00:00', end: '05:00:00' }, 'a'), shift('Tuesday', { start: '03:00:00', end: '05:00:00' }, 'b')]
    const [found] = run(shifts, [issue({})])
    expect(found).toMatchObject({ tone: 'review', shiftIds: ['a', 'b'] })
    expect(JSON.stringify(found)).not.toMatch(/block/i)
    expect(found.detail).toContain('Mon, Tue 03:00 to 05:00 has no price item')
  })

  it('treats a refusal as something to fix', () => {
    const [found] = run([shift('Monday')], [issue({ reason: 'RegistrationGroupNotHeld', message: "Block 'b1' needs registration group 0125" })])
    expect(found.tone).toBe('fix')
  })

  it('flags shifts that overlap, once, without repeating the engine\'s own overlap issue', () => {
    const shifts = [shift('Monday', { start: '09:00:00', end: '13:00:00' }, 'a'), shift('Monday', { start: '12:00:00', end: '15:00:00' }, 'b')]
    const found = run(shifts, [issue({ reason: 'BlocksOverlap', blockId: 'b1', message: "Blocks 'b1' and 'b2' overlap" })])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ tone: 'review', shiftIds: ['a', 'b'], title: '2 shifts overlap another shift' })
  })

  it('says when the agreement runs past the catalogue', () => {
    const found = run([shift('Monday')], [], '2027-12-31')
    expect(found[0]).toMatchObject({ tone: 'review', step: 'agreement' })
    expect(found[0].title.replace(/\s/g, ' ')).toContain('30 Jun 2027')
  })

  it('names a limit the week is over', () => {
    const found = agreementIssues({ shifts: [shift('Monday')], groups: groupShifts([shift('Monday')]), quoteIssues: [], limits: { blocks: 201, patterns: 201, exceeded: 'blocks' }, to: '2027-06-30' })
    expect(found[0]).toMatchObject({ tone: 'fix', step: 'week' })
    expect(found[0].title).toContain('201 different kinds of shift')
  })
})
