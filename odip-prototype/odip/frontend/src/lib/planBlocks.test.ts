import { describe, expect, it } from 'vitest'
import type { PlanBlock } from '@/api/types'
import {
  BAND_EDGES, blockProblems, canOfferSleepover, clock, dayBars, daysSummary, defaultSleepoverWindow, describeBlock, duplicateBlock, durationMinutes, emptyBlock, endsNextDay, formatDuration, formatHours,
  forTheServer, formatMinute, fromClock, layoutDay, needsSleepoverWindow, nextBlockId, normaliseBlock, offeredSupportTypes, ratioSentence, registrationGroupFor, stampLocation, toMinutes, toWireTime, weekdayBandParts,
  weeklyHours,
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

  it('says a length in words, an hours figure without a trailing zero, and the end of the day as 24:00', () => {
    expect([formatDuration(480), formatDuration(510), formatDuration(45), formatDuration(1440)]).toEqual(['8 h', '8 h 30 min', '45 min', '24 h'])
    expect([formatHours(8), formatHours(4.5), formatHours(6.6667), formatHours(0.1 + 0.2)]).toEqual(['8', '4.5', '6.67', '0.3'])
    expect([formatMinute(0), formatMinute(1439), formatMinute(1440), formatMinute(75)]).toEqual(['00:00', '23:59', '24:00', '01:15'])
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

  it('describes a block as the one readable line the plan shows', () => {
    expect(describeBlock(block({ transport: { km: 20, vehicle: 'Standard', tolls: 0, parking: 0 } }))).toBe('Mon, Wed · 09:00–13:00 · Community access 1:1 · +20 km transport')
    expect(describeBlock(block({ supportType: 'GroupActivity', days: ['Saturday'], start: '09:00:00', end: '15:00:00', participantsPresent: 3 }))).toBe('Sat · 09:00–15:00 · Group activity 1:3')
    expect(describeBlock(block({ supportType: 'PersonalCare', days: ['Friday'], start: '22:00:00', end: '06:00:00', workerMaySleep: true, workers: 2 }))).toBe('Fri · 22:00–06:00 next day · Personal care 2:1 · sleepover')
    expect(describeBlock(block({ travel: { claim: true, minutesEachWay: 20, returnToBase: true, kmEachWay: 5 }, onPublicHoliday: 'Skip' }))).toBe('Mon, Wed · 09:00–13:00 · Community access 1:1 · +provider travel 20 min each way · holidays skipped')
    expect(describeBlock(block({ supportType: 'StaSupport', accommodation: { nights: 1, workerOnSite: false }, onPublicHoliday: 'Charge' }))).toContain('1 night · holidays charged')
  })

  it('works out a week of hours by arithmetic alone', () => {
    expect(weeklyHours(block())).toBe(8)
    expect(weeklyHours(block({ days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], start: '22:00:00', end: '06:00:00' }))).toBe(40)
  })

  it('says what the ratio does to the price in one plain sentence', () => {
    expect(ratioSentence(1, 1)).toBe('One worker for one participant: the full hourly price.')
    expect(ratioSentence(1, 3)).toBe("1:3. Each participant's hourly price is the NDIS maximum divided by 3, rounded down to the cent.")
    expect(ratioSentence(2, 1)).toBe("2:1. Each participant's hourly price is the NDIS maximum times 2, rounded down to the cent.")
    expect(ratioSentence(Number.NaN, 1)).toBe('')
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

describe('where the prices change', () => {
  const parts = (start: string, end: string) => weekdayBandParts({ start, end }).map(part => [part.band, part.minutes])

  it('cuts a block at 06:00, 20:00 and midnight', () => {
    expect(BAND_EDGES).toEqual([0, 360, 1200])
    expect(parts('09:00:00', '13:00:00')).toEqual([['day', 240]])
    expect(parts('22:00:00', '06:00:00')).toEqual([['evening', 120], ['night', 360]])
    expect(parts('05:00:00', '07:00:00')).toEqual([['night', 60], ['day', 60]])
    expect(parts('16:00:00', '16:00:00')).toEqual([['day', 240], ['evening', 240], ['night', 360], ['day', 600]])
    expect(parts('', '13:00:00')).toEqual([])
  })

  it('draws a block across midnight as a bar to the end of its day and another from the start of the next', () => {
    const night = block({ id: 'n', days: ['Friday', 'Sunday'], start: '22:00:00', end: '06:00:00' })
    expect(dayBars([night]).map(bar => [bar.day, bar.from, bar.to, bar.continued])).toEqual([
      ['Friday', 1320, 1440, false], ['Saturday', 0, 360, true], ['Sunday', 1320, 1440, false], ['Monday', 0, 360, true],
    ])
    expect(dayBars([block({ days: ['Monday'], start: '16:00:00', end: '16:00:00' })]).map(bar => [bar.day, bar.from, bar.to])).toEqual([['Monday', 960, 1440], ['Tuesday', 0, 960]])
  })

  it('puts overlapping bars of one day side by side and lets an earlier one\'s lane be reused', () => {
    const bar = (from: number, to: number) => ({ blockId: `${from}`, day: 'Monday' as const, from, to, continued: false })
    expect(layoutDay([bar(540, 780), bar(600, 720), bar(780, 900)]).map(placed => [placed.from, placed.lane, placed.lanes])).toEqual([[540, 0, 2], [600, 1, 2], [780, 0, 2]])
    expect(layoutDay([bar(540, 780)]).map(placed => [placed.lane, placed.lanes])).toEqual([[0, 1]])
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
  it('numbers a new block after the others without reusing an id', () => {
    expect(nextBlockId([])).toBe('b1')
    expect(nextBlockId([{ id: 'b1' }, { id: 'b2' }])).toBe('b3')
    expect(nextBlockId([{ id: 'b2' }])).toBe('b3')
    expect(nextBlockId([{ id: 'b1' }, { id: 'b3' }])).toBe('b4')
  })

  it('duplicates a block as a deep copy on its own id', () => {
    const original = { block: block({ travel: { claim: true, minutesEachWay: 10, returnToBase: false, kmEachWay: 0 } }), requirements: { workerGender: 'Female' as const, driver: true, skills: ['FirstAid' as const] } }
    const copy = duplicateBlock(original, 'b2')
    expect(copy.block.id).toBe('b2')
    expect(copy.block.travel).toEqual(original.block.travel)
    expect(copy.block.travel).not.toBe(original.block.travel)
    expect(copy.requirements.skills).not.toBe(original.requirements.skills)
    expect(original.block.id).toBe('b1')
  })

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

  it('read as the lines the brief gives', () => {
    const line = (key: string) => describeBlock(PLAN_TEMPLATES.find(template => template.key === key)!.build('t', 'NSW', 'National').block)
    expect(line('community-weekdays')).toBe('Mon–Fri · 09:00–13:00 · Community access 1:1')
    expect(line('saturday-outing')).toBe('Sat · 09:00–15:00 · Group activity 1:3')
    expect(line('personal-care-mornings')).toBe('Mon–Fri · 07:00–09:00 · Personal care 1:1')
    expect(line('overnight-sleepover')).toBe('Every day · 22:00–06:00 next day · Personal care 1:1 · sleepover')
    expect(line('weekend-respite-sta')).toBe('Fri, Sat · 16:00–16:00 next day · Short-term accommodation 1:1 · sleepover · 1 night')
  })

  it('keep the overnight and respite templates where a sleepover qualifies', () => {
    for (const key of ['overnight-sleepover', 'weekend-respite-sta']) {
      const { block: started } = PLAN_TEMPLATES.find(template => template.key === key)!.build('t', 'NSW', 'National')
      expect(canOfferSleepover(started), key).toBe(true)
      expect(normaliseBlock(started), key).toEqual(started)
    }
  })
})
