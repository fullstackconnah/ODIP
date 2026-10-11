import { describe, expect, it } from 'vitest'
import type { DraftBlock, PlanBlockRequirements, PlanDayName } from '@/api/types'
import { emptyBlock } from './planBlocks'
import {
  blocksToShifts, engineLimits, shiftBlockOf, groupShifts, newShift, overlappingShiftIds, shiftLabel, shiftWords, shiftsToBlocks, weeklyShiftHours, chargeHolidaysByDefault, patchShift, limitMessage, appendShifts, type Shift,
} from './agreementShifts'

const NO_REQ: PlanBlockRequirements = { workerGender: 'NoPreference', driver: false, skills: [] }
const entry = (id: string, days: PlanDayName[], changes: Partial<DraftBlock['block']> = {}): DraftBlock => ({ block: { ...emptyBlock(id, 'NSW'), days, ...changes }, requirements: { ...NO_REQ } })
const shift = (day: PlanDayName, changes: Partial<Shift['block']> = {}, id = `s-${day}-${changes.start ?? ''}`): Shift => {
  return { id, day, block: { ...shiftBlockOf(emptyBlock('x', 'NSW')), ...changes }, requirements: { ...NO_REQ } }
}

describe('shiftsToBlocks', () => {
  it('groups identical shifts on different days into one block, in week order, with the days listed', () => {
    const blocks = shiftsToBlocks([shift('Friday'), shift('Monday'), shift('Wednesday')])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].block.days).toEqual(['Monday', 'Wednesday', 'Friday'])
    expect(blocks[0].block.id).toBe('b1')
  })

  it('keeps shifts that differ in anything the engine prices as separate blocks', () => {
    const blocks = shiftsToBlocks([shift('Monday'), shift('Tuesday', { end: '14:00:00' }), shift('Wednesday', { workers: 2 }), shift('Thursday', { onPublicHoliday: 'Skip' })])
    expect(blocks.map(b => b.block.days)).toEqual([['Monday'], ['Tuesday'], ['Wednesday'], ['Thursday']])
    expect(blocks.map(b => b.block.id)).toEqual(['b1', 'b2', 'b3', 'b4'])
  })

  it('keeps shifts with different worker requirements apart', () => {
    const female: Shift = { ...shift('Tuesday'), requirements: { ...NO_REQ, workerGender: 'Female' } }
    expect(shiftsToBlocks([shift('Monday'), female])).toHaveLength(2)
  })

  it('does not merge two identical shifts on the same day, so the engine still reports the overlap', () => {
    const blocks = shiftsToBlocks([shift('Monday', {}, 'a'), shift('Monday', {}, 'b')])
    expect(blocks.map(b => b.block.days)).toEqual([['Monday'], ['Monday']])
  })

  it('carries an overnight shift as one block that ends before it starts', () => {
    const [night] = shiftsToBlocks([shift('Friday', { start: '22:00:00', end: '06:00:00' })])
    expect(night.block).toMatchObject({ days: ['Friday'], start: '22:00:00', end: '06:00:00' })
  })
})

describe('blocksToShifts', () => {
  it('makes one shift for each day of each block, Monday first', () => {
    const shifts = blocksToShifts([entry('b1', ['Wednesday', 'Monday']), entry('b2', ['Saturday'], { start: '08:00:00', end: '12:00:00' })])
    expect(shifts.map(s => `${s.day} ${s.block.start}`)).toEqual(['Monday 09:00:00', 'Wednesday 09:00:00', 'Saturday 08:00:00'])
    expect(new Set(shifts.map(s => s.id)).size).toBe(3)
  })

  it('round-trips: blocks to shifts and back gives the same blocks', () => {
    const blocks = [entry('b1', ['Monday', 'Wednesday', 'Friday']), entry('b2', ['Friday'], { start: '22:00:00', end: '06:00:00', supportType: 'PersonalCare', setting: 'AtHome' })]
    expect(shiftsToBlocks(blocksToShifts(blocks))).toEqual(blocks)
  })
})

describe('groupShifts', () => {
  it('says which shifts each block came from, so an engine message can be shown on them', () => {
    const shifts = [shift('Monday', {}, 'm'), shift('Tuesday', { end: '15:00:00' }, 't'), shift('Wednesday', {}, 'w')]
    const groups = groupShifts(shifts)
    expect(groups.map(g => [g.entry.block.id, g.shiftIds])).toEqual([['b1', ['m', 'w']], ['b2', ['t']]])
  })
})

describe('overlappingShiftIds', () => {
  it('flags two shifts that share an hour on one day, and not two that only touch', () => {
    const a = shift('Monday', { start: '09:00:00', end: '13:00:00' }, 'a')
    const b = shift('Monday', { start: '12:00:00', end: '15:00:00' }, 'b')
    const c = shift('Monday', { start: '15:00:00', end: '17:00:00' }, 'c')
    expect([...overlappingShiftIds([a, b, c])].sort()).toEqual(['a', 'b'])
  })

  it('flags an overnight shift against the next morning, including Sunday night into Monday', () => {
    const night = shift('Sunday', { start: '22:00:00', end: '06:00:00' }, 'n')
    const early = shift('Monday', { start: '05:00:00', end: '07:00:00' }, 'e')
    expect([...overlappingShiftIds([night, early])].sort()).toEqual(['e', 'n'])
  })
})

describe('words', () => {
  it('labels a shift with its times, support and ratio, and says an overnight shift ends the next day', () => {
    expect(shiftLabel(shift('Monday'))).toBe('09:00 to 13:00 · Community access · 1:1')
    expect(shiftLabel(shift('Friday', { start: '22:00:00', end: '06:00:00', supportType: 'PersonalCare' }))).toBe('22:00 to 06:00 (ends the next day) · Personal care · 1:1')
  })

  it('names the shifts in an engine message and never says block', () => {
    const groups = groupShifts([shift('Monday'), shift('Tuesday'), shift('Wednesday', { start: '10:00:00', end: '14:00:00' })])
    expect(shiftWords("Blocks 'b1' and 'b2' are on at the same time. Move one block.", groups)).toBe('Mon, Tue 09:00 to 13:00 and Wed 10:00 to 14:00 are on at the same time. Move one shift.')
    expect(shiftWords("Block 'b1' breaks a rule", groups)).toBe('Mon, Tue 09:00 to 13:00 breaks a rule')
    expect(shiftWords('Part of this block has no price item. Two blocks clash.', groups)).toBe('Part of this shift has no price item. Two shifts clash.')
  })
})

describe('numbers', () => {
  it('adds a week of shift hours, an overnight shift counting its whole length', () => {
    expect(weeklyShiftHours([shift('Monday'), shift('Tuesday', { start: '22:00:00', end: '06:00:00' })])).toBe(12)
  })

  it('counts engine blocks and roster patterns (days times workers) against the caps', () => {
    const shifts = [shift('Monday', { workers: 2 }), shift('Tuesday', { workers: 2 }), shift('Wednesday')]
    expect(engineLimits(shifts)).toMatchObject({ blocks: 2, patterns: 5, exceeded: null })
    const many = Array.from({ length: 101 }, (_, i) => shift('Monday', { start: `${String(i % 24).padStart(2, '0')}:00:00`, workers: 10, participantsPresent: 1 + Math.floor(i / 24) }, `m${i}`))
    expect(engineLimits(many).exceeded).toBe('patterns')
  })
})

describe('newShift', () => {
  it('starts from the last times and support used, on the chosen day, with an id nobody else has', () => {
    const last = shift('Monday', { start: '10:00:00', end: '12:00:00', supportType: 'GroupActivity', participantsPresent: 3 }, 's1')
    const added = newShift('Tuesday', [last], 'NSW')
    expect(added).toMatchObject({ day: 'Tuesday', block: { start: '10:00:00', end: '12:00:00', supportType: 'GroupActivity', participantsPresent: 3 } })
    expect(added.id).not.toBe('s1')
  })

  it('starts a first shift from the usual morning of community access', () => {
    expect(newShift('Monday', [], 'NSW').block).toMatchObject({ supportType: 'CommunityAccess', start: '09:00:00', end: '13:00:00', workers: 1, participantsPresent: 1, onPublicHoliday: 'Charge' })
  })

  it('charges public holidays at the holiday rate unless the shift says skip, and turns an old undecided shift into a charged one', () => {
    const shifts = [shift('Monday', { onPublicHoliday: 'Review' }), shift('Tuesday', { onPublicHoliday: 'Skip' })]
    expect(chargeHolidaysByDefault(shifts).map(s => s.block.onPublicHoliday)).toEqual(['Charge', 'Skip'])
  })
})

describe('patchShift', () => {
  it('changes the named fields and nothing else', () => {
    const patched = patchShift(shift('Monday'), { block: { end: '15:00:00' }, requirements: { driver: true } })
    expect(patched).toMatchObject({ day: 'Monday', block: { start: '09:00:00', end: '15:00:00' }, requirements: { driver: true, workerGender: 'NoPreference' } })
  })

  it('lets go of what the new times no longer allow, as the plan builder did: a sleepover that is no longer eight hours across midnight', () => {
    const night = shift('Friday', { start: '22:00:00', end: '06:00:00', supportType: 'PersonalCare', setting: 'AtHome', workerMaySleep: true })
    const day = patchShift(night, { block: { start: '09:00:00', end: '13:00:00' } })
    expect(day.block).toMatchObject({ workerMaySleep: false, sleepoverActiveHours: 0 })
  })
})

describe('limitMessage', () => {
  it('says nothing under the limits and names the limit in words over them', () => {
    expect(limitMessage({ blocks: 3, patterns: 9, exceeded: null })).toBeNull()
    expect(limitMessage({ blocks: 201, patterns: 201, exceeded: 'blocks' })).toBe('This week has 201 different kinds of shift and pricing takes at most 200. Make shifts the same where you can.')
    expect(limitMessage({ blocks: 3, patterns: 150, exceeded: 'patterns' })).toBe('Approval would make 150 weekly roster patterns (days times workers) and can make at most 100. Use fewer days or workers.')
  })
})

describe('appendShifts', () => {
  it('adds shifts under ids nobody has', () => {
    const added = appendShifts([shift('Monday', {}, 's1'), shift('Tuesday', {}, 's2')], [shift('Friday', {}, 's1'), shift('Saturday', {}, 's2')])
    expect(added.map(s => [s.id, s.day])).toEqual([['s1', 'Monday'], ['s2', 'Tuesday'], ['s3', 'Friday'], ['s4', 'Saturday']])
  })
})
