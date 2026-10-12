import { describe, expect, it } from 'vitest'
import type { PlanBlock } from '@/api/types'
import {
  blockProblems, canOfferSleepover, clock, daysSummary, defaultSleepoverWindow, durationMinutes, emptyBlock, endsNextDay, forTheServer, fromClock,
  needsSleepoverWindow, normaliseBlock, offeredSupportTypes, registrationGroupFor, stampLocation, toMinutes, toWireTime,
} from './planBlocks'
import { PLAN_TEMPLATES } from './planTemplates'

const block = (changes: Partial<PlanBlock> = {}): PlanBlock => ({ ...emptyBlock('b1', 'NSW'), days: ['Monday', 'Wednesday'], ...changes })

describe('times', () => {
  it('reads wire and input times as minutes, and writes minutes back as the engine\'s HH:mm:ss', () => {
    expect([toMinutes('09:30:00'), toMinutes('09:30'), toMinutes('00:00'), toMinutes('23:59:00')]).toEqual([570, 570, 0, 1439])
    expect([toMinutes(''), toMinutes('24:00'), toMinutes('9:75'), toMinutes('nonsense')].every(Number.isNaN)).toBe(true)
    expect([toWireTime(570), toWireTime(0), toWireTime(1440), toWireTime(-60)]).toEqual(['09:30:00', '00:00:00', '00:00:00', '23:00:00'])
    expect([clock('09:30:00'), clock('7:05'), clock('')]).toEqual(['09:30', '07:05', ''])
    expect([fromClock('09:30'), fromClock('')]).toEqual(['09:30:00', ''])
  })

  it('derives "ends the next day" from the two times and counts the same time twice as 24 hours', () => {
    expect([endsNextDay({ start: '09:00:00', end: '13:00:00' }), endsNextDay({ start: '22:00:00', end: '06:00:00' }), endsNextDay({ start: '16:00:00', end: '16:00:00' })]).toEqual([false, true, true])
    expect([durationMinutes({ start: '09:00:00', end: '13:00:00' }), durationMinutes({ start: '22:00:00', end: '06:00:00' }), durationMinutes({ start: '16:00:00', end: '16:00:00' })]).toEqual([240, 480, 1440])
    expect(durationMinutes({ start: '', end: '13:00:00' })).toBe(0)
  })

})

describe('words', () => {
  it('summarises days: a run of three is a range, a shorter one is listed, all seven is every day', () => {
    expect(daysSummary(['Monday', 'Wednesday'])).toBe('Mon, Wed')
    expect(daysSummary(['Friday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'])).toBe('Mon–Fri')
    expect(daysSummary(['Saturday', 'Sunday'])).toBe('Sat, Sun')
    expect(daysSummary(['Tuesday', 'Thursday', 'Friday', 'Saturday'])).toBe('Tue, Thu–Sat')
    expect(daysSummary(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])).toBe('Every day')
    expect(daysSummary([])).toBe('No days')
  })

})

describe('registration groups', () => {
  it('follows the engine: high intensity is 0104, a group outing is 0136 unless the provider bills it under 0125, and STA is 0115', () => {
    const group = (supportType: PlanBlock['supportType'], intensity: PlanBlock['intensity'] = 'Standard', outings?: 'GroupActivities' | 'CommunityAccess') => registrationGroupFor({ supportType, intensity }, outings)
    expect([group('PersonalCare'), group('CommunityAccess'), group('GroupActivity'), group('StaSupport')]).toEqual(['0107', '0125', '0136', '0115'])
    expect([group('PersonalCare', 'HighIntensity'), group('CommunityAccess', 'HighIntensity'), group('GroupActivity', 'HighIntensity'), group('StaSupport', 'HighIntensity')]).toEqual(['0104', '0104', '0104', '0115'])
    expect(group('GroupActivity', 'Standard', 'CommunityAccess')).toBe('0125')
  })

  it('offers only the support types the provider holds a group for', () => {
    expect(offeredSupportTypes(['0107', '0104', '0125', '0136', '0115', '0108'])).toEqual(['CommunityAccess', 'GroupActivity', 'PersonalCare', 'StaSupport'])
    expect(offeredSupportTypes(['0107', '0125'])).toEqual(['CommunityAccess', 'PersonalCare'])
    expect(offeredSupportTypes(['0125'], 'CommunityAccess')).toEqual(['CommunityAccess', 'GroupActivity'])
    expect(offeredSupportTypes([])).toEqual([])
  })
})

describe('sleepovers', () => {
  it('is offered only to a family with a sleepover item, across midnight, for 8 hours or more', () => {
    const night = { supportType: 'PersonalCare' as const, start: '22:00:00', end: '06:00:00' }
    expect(canOfferSleepover(night)).toBe(true)
    expect(canOfferSleepover({ ...night, end: '05:59:00' })).toBe(false)             // 7 h 59
    expect(canOfferSleepover({ ...night, supportType: 'CommunityAccess' })).toBe(false)
    expect(canOfferSleepover({ ...night, supportType: 'GroupActivity' })).toBe(false)
    expect(canOfferSleepover({ ...night, supportType: 'StaSupport' })).toBe(true)
    expect(canOfferSleepover({ supportType: 'PersonalCare', start: '08:00:00', end: '17:00:00' })).toBe(false)   // not across midnight
  })

  it('needs the window past 12 hours, and offers 22:00 to 06:00 when that night lies inside the block', () => {
    expect(needsSleepoverWindow({ start: '22:00:00', end: '06:00:00', workerMaySleep: true })).toBe(false)
    expect(needsSleepoverWindow({ start: '16:00:00', end: '16:00:00', workerMaySleep: true })).toBe(true)
    expect(needsSleepoverWindow({ start: '16:00:00', end: '16:00:00', workerMaySleep: false })).toBe(false)
    expect(defaultSleepoverWindow({ start: '16:00:00', end: '16:00:00' })).toEqual({ from: '22:00:00', to: '06:00:00' })
    expect(defaultSleepoverWindow({ start: '23:00:00', end: '12:00:00' })).toEqual({ from: '23:00:00', to: '07:00:00' })
  })
})

describe('what is wrong with a block', () => {
  const found = (changes: Partial<PlanBlock>, context = {}) => blockProblems(block(changes), context).map(problem => `${problem.step}:${problem.field}`)

  it('has nothing to say about a complete block', () => {
    expect(blockProblems(block())).toEqual([])
  })

  it('names the day, time, worker and participant problems next to their fields', () => {
    expect(found({ days: [] })).toEqual(['times:days'])
    expect(found({ start: '' })).toContain('times:start')
    expect(found({ end: '' })).toContain('times:end')
    expect(found({ workers: 0 })).toEqual(['requirements:workers'])
    expect(found({ workers: Number.NaN })).toEqual(['requirements:workers'])
    expect(found({ participantsPresent: 41 })).toEqual(['requirements:participantsPresent'])
  })

  it('checks the registration group only once the settings are known, and says which group and why', () => {
    expect(found({})).toEqual([])
    expect(found({}, { groupsHeld: ['0107'] })).toEqual(['requirements:supportType'])
    expect(blockProblems(block(), { groupsHeld: ['0107'] })[0].message).toBe('Community access needs registration group 0125, which your organisation has not recorded as held.')
    expect(found({ intensity: 'HighIntensity' }, { groupsHeld: ['0125'] })).toEqual(['requirements:intensity'])
    expect(found({ supportType: 'GroupActivity' }, { groupsHeld: ['0125'], groupOutings: 'CommunityAccess' })).toEqual([])
  })

  it('checks sleepover windows and active hours', () => {
    const sleeping = { supportType: 'PersonalCare' as const, start: '22:00:00', end: '06:00:00', workerMaySleep: true }
    expect(found({ ...sleeping, sleepoverActiveHours: 9 })).toEqual(['times:sleepoverActiveHours'])
    expect(found({ ...sleeping, sleepoverActiveHours: 2 })).toEqual([])
    expect(found({ ...sleeping, start: '16:00:00', end: '16:00:00' })).toEqual(['times:sleepoverFrom'])          // 24 h with no window
    expect(found({ ...sleeping, start: '16:00:00', end: '16:00:00', sleepoverWindow: { from: '22:00:00', to: '06:00:00' } })).toEqual([])
    expect(found({ ...sleeping, sleepoverWindow: { from: '20:00:00', to: '03:00:00' } })).toEqual(['times:sleepoverFrom'])   // starts before the block
  })

  // Review F1: a number box that was cleared reports NaN, JSON turns NaN into null, and the server refuses a null for a decimal with a 400 the screen could not read.
  it('says a cleared box is a problem for every number a block carries, NaN and infinity included, never a null for the server', () => {
    const sleeping = { supportType: 'PersonalCare' as const, start: '22:00:00', end: '06:00:00', workerMaySleep: true }
    expect(found({ ...sleeping, sleepoverActiveHours: Number.NaN })).toEqual(['times:sleepoverActiveHours'])
    expect(found({ ...sleeping, sleepoverActiveHours: Number.POSITIVE_INFINITY })).toEqual(['times:sleepoverActiveHours'])
    expect(found({ participantsPresent: Number.NaN })).toEqual(['requirements:participantsPresent'])
    expect(found({ travel: { claim: true, minutesEachWay: Number.NaN, returnToBase: false, kmEachWay: Number.NaN } })).toEqual(['travel:travelMinutes', 'travel:travelKm'])
    expect(found({ transport: { km: Number.NaN, vehicle: 'Standard', tolls: Number.NaN, parking: Number.NaN } })).toEqual(['travel:transportKm', 'travel:tolls', 'travel:parking'])
    expect(found({ supportType: 'StaSupport', accommodation: { nights: Number.NaN, workerOnSite: false } })).toEqual(['travel:nights'])
  })

  it('checks travel, transport, sharing and nights against the engine\'s ranges', () => {
    expect(found({ travel: { claim: true, minutesEachWay: 500, returnToBase: false, kmEachWay: 0 } })).toEqual(['travel:travelMinutes'])
    expect(found({ travel: { claim: false, minutesEachWay: 500, returnToBase: false, kmEachWay: 0 } })).toEqual([])   // not claimed: nothing to check
    expect(found({ transport: { km: -1, vehicle: 'Standard', tolls: 10001, parking: 0 } })).toEqual(['travel:transportKm', 'travel:tolls'])
    expect(found({ participantsPresent: 2, transport: { km: 5, vehicle: 'Standard', tolls: 0, parking: 0, participantsSharing: 3 } })).toEqual(['travel:transportSharing'])
    expect(found({ supportType: 'StaSupport', accommodation: { nights: 15, workerOnSite: false } })).toEqual(['travel:nights'])
  })
})

describe('forTheServer', () => {
  it('leaves a block with every number in it exactly as it is', () => {
    const complete = block({ travel: { claim: true, minutesEachWay: 20, returnToBase: true, kmEachWay: 8.5, participantsSharing: 1 }, transport: { km: 20, vehicle: 'Standard', tolls: 0, parking: 4.5, participantsSharing: 1 } })
    expect(forTheServer(complete)).toEqual(complete)
  })

  it('writes a number nobody can see (travel switched off, an emptied box behind it) as one the server can read, so JSON never carries a null for a decimal', () => {
    const hidden = block({
      sleepoverActiveHours: Number.NaN,
      travel: { claim: false, minutesEachWay: Number.NaN, returnToBase: false, kmEachWay: Number.NaN, participantsSharing: Number.NaN },
      transport: { km: Number.NaN, vehicle: 'Standard', tolls: Number.NaN, parking: 2, participantsSharing: Number.NaN },
      accommodation: { nights: Number.NaN, workerOnSite: false },
    })

    const wire = JSON.parse(JSON.stringify(forTheServer(hidden)))

    expect(wire.sleepoverActiveHours).toBe(0)
    expect(wire.travel).toEqual({ claim: false, minutesEachWay: 0, returnToBase: false, kmEachWay: 0 })
    expect(wire.transport).toEqual({ km: 0, vehicle: 'Standard', tolls: 0, parking: 2 })
    expect(wire.accommodation).toEqual({ nights: 0, workerOnSite: false })
    expect(JSON.stringify(wire)).not.toContain('null')
  })
})

describe('normaliseBlock', () => {
  const sleeping = (changes: Partial<PlanBlock> = {}) => block({ supportType: 'PersonalCare', start: '22:00:00', end: '06:00:00', workerMaySleep: true, ...changes })

  it('lets go of a sleepover the new times or type no longer allow', () => {
    expect(normaliseBlock(sleeping({ end: '03:00:00', sleepoverActiveHours: 1 }))).toMatchObject({ workerMaySleep: false, sleepoverActiveHours: 0, sleepoverWindow: undefined })
    expect(normaliseBlock(sleeping({ supportType: 'CommunityAccess' }))).toMatchObject({ workerMaySleep: false })
    expect(normaliseBlock(sleeping())).toMatchObject({ workerMaySleep: true })
  })

  it('gives a block longer than 12 hours its window, and replaces one that no longer lies inside the block', () => {
    expect(normaliseBlock(sleeping({ start: '16:00:00', end: '16:00:00' })).sleepoverWindow).toEqual({ from: '22:00:00', to: '06:00:00' })
    // 16:00 to 05:00 is 13 hours and 22:00 to 06:00 does not fit in it, so the first eight hours stand in; a window after the block ends is replaced
    expect(normaliseBlock(sleeping({ start: '16:00:00', end: '05:00:00', sleepoverWindow: { from: '06:00:00', to: '10:00:00' } })).sleepoverWindow).toEqual({ from: '16:00:00', to: '00:00:00' })
    expect(normaliseBlock(sleeping({ sleepoverWindow: { from: '05:00:00', to: '08:00:00' } })).sleepoverWindow).toBeUndefined()
  })

  it('caps active hours at the length of the sleepover', () => {
    expect(normaliseBlock(sleeping({ sleepoverActiveHours: 12 })).sleepoverActiveHours).toBe(8)
  })

  it('drops transport and accommodation from a type that has none, and sharing beyond who is present', () => {
    const transport = { km: 5, vehicle: 'Standard' as const, tolls: 0, parking: 0 }
    expect(normaliseBlock(block({ supportType: 'PersonalCare', transport })).transport).toBeUndefined()
    expect(normaliseBlock(block({ supportType: 'GroupActivity', transport })).transport).toEqual(transport)
    expect(normaliseBlock(block({ supportType: 'CommunityAccess', accommodation: { nights: 1, workerOnSite: false } })).accommodation).toBeUndefined()
    expect(normaliseBlock(block({ supportType: 'StaSupport', accommodation: { nights: 1, workerOnSite: false } })).accommodation).toEqual({ nights: 1, workerOnSite: false })
    const shared = normaliseBlock(block({ participantsPresent: 2, travel: { claim: true, minutesEachWay: 10, returnToBase: false, kmEachWay: 0, participantsSharing: 3 }, transport: { ...transport, participantsSharing: 3 } }))
    expect([shared.travel?.participantsSharing, shared.transport?.participantsSharing]).toEqual([undefined, undefined])
  })

  it('returns the same block when nothing needs letting go', () => {
    const plain = block()
    expect(normaliseBlock(plain)).toBe(plain)
  })
})

describe('blocks as the plan keeps them', () => {
  it('puts the agreement\'s delivery location on a block, whatever it carried', () => {
    expect(stampLocation(block(), 'VIC', 'Remote').location).toEqual({ state: 'VIC', zone: 'Remote' })
  })
})

describe('the templates', () => {
  it('each start from a block the engine would accept (the blank one needs its days)', () => {
    for (const template of PLAN_TEMPLATES) {
      const entry = template.build('t', 'NSW', 'National')
      const problems = blockProblems(entry.block, { groupsHeld: ['0107', '0104', '0125', '0136', '0115', '0108'] }).map(problem => problem.field)
      expect(problems, template.title).toEqual(template.key === 'blank' ? ['days'] : [])
      expect(entry.requirements).toEqual({ workerGender: 'NoPreference', driver: false, skills: [] })
      expect(entry.block.location).toEqual({ state: 'NSW', zone: 'National' })
    }
  })

  it('keep the overnight and respite templates where a sleepover qualifies', () => {
    for (const key of ['overnight-sleepover', 'weekend-respite-sta']) {
      const { block: started } = PLAN_TEMPLATES.find(template => template.key === key)!.build('t', 'NSW', 'National')
      expect(canOfferSleepover(started), key).toBe(true)
      expect(normaliseBlock(started), key).toEqual(started)
    }
  })
})
