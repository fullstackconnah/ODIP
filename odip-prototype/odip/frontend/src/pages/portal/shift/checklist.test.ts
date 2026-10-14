import { describe, it, expect } from 'vitest'
import {
  breaksSignature, buildChecklist, clockLabel, endChecklist,
  FINISH_STEPS, handoverForward, stepForCode, dosesSummary, timeBounds, timesError, movedTimes, parseKilometres, type TimesInput,
} from './checklist'
import type { PortalDoseSlotDto, PortalShiftRoutineDto } from '@/api/types'

const dose = (over: Partial<PortalDoseSlotDto>): PortalDoseSlotDto => ({
  medicationId: 'm1', medicationName: 'Panadol', strength: null, doseDescription: '1 tablet', form: 'Tablet', route: 'Oral', directions: null,
  supportLevel: 'Administer', isHighRisk: false, scheduledAt: '2026-10-05T08:00:00', scheduledTime: '08:00', state: 'Due', isOverdue: false,
  outcome: null, witness: { required: false, status: null, witnessName: null, requestedAt: null, respondedAt: null }, ...over,
} as PortalDoseSlotDto)

const routine = (over: Partial<PortalShiftRoutineDto>): PortalShiftRoutineDto => ({
  id: 'r1', title: 'Shower', description: '', category: 'PersonalCare', isCritical: false, startTime: null, endTime: null,
  occursAt: '2026-10-05T08:00:00', afterMidnight: false, isChecked: false, checkedAt: null, checkedByName: null, fromTickSnapshot: false, ...over,
} as PortalShiftRoutineDto)

describe('clockLabel', () => {
  it('prints wall-clock digits, never shifted', () => {
    expect(clockLabel('2026-10-05T08:00:00')).toBe('8:00 am')
    expect(clockLabel('2026-10-05T13:30:00')).toBe('1:30 pm')
  })
})

describe('buildChecklist', () => {
  it('puts overdue doses in a warning group at the top, then time groups, with routines at their time', () => {
    const { groups } = buildChecklist({
      medicationsDue: [
        dose({ medicationId: 'a', scheduledAt: '2026-10-05T12:00:00', scheduledTime: '12:00' }),
        dose({ medicationId: 'b', scheduledAt: '2026-10-05T08:00:00', state: 'Overdue', isOverdue: true }),
      ],
      shiftRoutines: [routine({ id: 'r', occursAt: '2026-10-05T12:00:00' }), routine({ id: 'any', occursAt: null })],
    })
    expect(groups.map(g => g.id)).toEqual(['overdue', '2026-10-05T12:00', 'anytime'])
    expect(groups[0].tone).toBe('warning')
    expect(groups[1].items.map(i => i.kind)).toEqual(['dose', 'routine'])
    expect(groups[2].label).toBe('Anytime')
  })
  it('sorts after-midnight occurrences after the evening', () => {
    const { groups } = buildChecklist({
      medicationsDue: [],
      shiftRoutines: [routine({ id: 'late', occursAt: '2026-10-06T01:00:00', afterMidnight: true }), routine({ id: 'eve', occursAt: '2026-10-05T22:00:00' })],
    })
    expect(groups.map(g => g.items[0].key)).toEqual(['routine-eve', 'routine-late'])
  })
  it('is empty when there is nothing due', () => {
    expect(buildChecklist({ medicationsDue: [], shiftRoutines: [] }).groups).toEqual([])
  })
})

describe('endChecklist', () => {
  const base = { blockers: [], breaksConfirmed: true, noteCount: 1, nothingToNote: false, handoverText: '', nothingToHandOver: false }
  it('needs a note or Nothing to note', () => {
    expect(endChecklist({ ...base, noteCount: 0 }).find(i => i.id === 'note')?.done).toBe(false)
    expect(endChecklist({ ...base, noteCount: 0, nothingToNote: true }).find(i => i.id === 'note')?.done).toBe(true)
  })
  it('needs handover text or Nothing to hand over', () => {
    expect(endChecklist(base).find(i => i.id === 'handover')?.done).toBe(false)
    expect(endChecklist({ ...base, handoverText: 'ok' }).find(i => i.id === 'handover')?.done).toBe(true)
    expect(endChecklist({ ...base, nothingToHandOver: true }).find(i => i.id === 'handover')?.done).toBe(true)
  })
  it('is blocked by missing doses and a running break', () => {
    const items = endChecklist({
      ...base,
      blockers: [
        { code: 'DOSE_OUTCOME_MISSING', message: 'x', medicationId: 'm', medicationName: 'P', scheduledAt: '2026-10-05T08:00:00' },
        { code: 'BREAK_RUNNING', message: 'y', medicationId: null, medicationName: null, scheduledAt: null },
      ],
    })
    expect(items.find(i => i.id === 'doses')?.done).toBe(false)
    expect(items.find(i => i.id === 'breaks')?.done).toBe(false)
  })
  it('needs the breaks confirmed', () => {
    expect(endChecklist({ ...base, breaksConfirmed: false }).find(i => i.id === 'breaks')?.done).toBe(false)
    expect(endChecklist(base).find(i => i.id === 'breaks')?.done).toBe(true)
  })
})

describe('wording and break signature', () => {
  const blocker = { code: 'DOSE_OUTCOME_MISSING' as const, message: 'x', medicationId: 'm', medicationName: 'P', scheduledAt: '2026-10-05T08:00:00' }
  const base = { blockers: [], breaksConfirmed: true, noteCount: 1, nothingToNote: false, handoverText: '', nothingToHandOver: false }
  it('agrees the verb with the count', () => {
    expect(endChecklist({ ...base, blockers: [blocker] })[0].label).toBe('1 dose needs an outcome')
    expect(endChecklist({ ...base, blockers: [blocker, blocker] })[0].label).toBe('2 doses need an outcome')
  })
  it('changes the break signature when a break is edited or ended', () => {
    const a = [{ id: 'b', startedAt: '2026-10-05T01:00:00Z', endedAt: null }]
    expect(breaksSignature(a)).not.toBe(breaksSignature([{ ...a[0], endedAt: '2026-10-05T01:30:00Z' }]))
    expect(breaksSignature(a)).not.toBe(breaksSignature([]))
  })
})

describe('the finish flow: steps and step 4', () => {
  it('has the five steps in order, with the rail labels and the headings (SHAPE §7)', () => {
    expect(FINISH_STEPS.map(s => [s.key, s.label, s.heading])).toEqual([
      ['times', 'Times', 'Your times'], ['doses', 'Doses', 'Doses & routines'], ['report', 'Report', 'Anything to report?'],
      ['handover', 'Handover', 'Note & handover'], ['submit', 'Submit', 'Check and submit'],
    ])
  })
  it("names step 4's missing answers on its forward button, so it is never blocked and never silent", () => {
    expect(handoverForward(0, false, '', false)).toBe('Nothing to note or hand over')
    expect(handoverForward(1, false, '', false)).toBe('Nothing to hand over')
    expect(handoverForward(0, false, 'All settled', false)).toBe('Nothing to note')
    expect(handoverForward(0, true, '', true)).toBe('Next')
    expect(handoverForward(2, false, '  ', true)).toBe('Next')
  })
  it('sends a refused submit to the step that can fix it', () => {
    for (const code of ['BREAK_RUNNING', 'SHIFT_TIME_ADJUSTMENT_TOO_LARGE', 'SHIFT_TIME_ADJUSTMENT_REASON_REQUIRED', 'SHIFT_TIME_ADJUSTMENT_REASON_TOO_LONG',
      'SHIFT_ACTUAL_END_IN_FUTURE', 'SHIFT_START_NOT_BEFORE_END', 'SHIFT_BREAK_OUTSIDE_TIMES', 'SHIFT_KILOMETRES_OUT_OF_RANGE']) {
      expect(stepForCode(code)).toBe('times')
    }
    expect(stepForCode('DOSE_OUTCOME_MISSING')).toBe('doses')
    expect(stepForCode('SHIFT_NOTE_REQUIRED')).toBe('handover')
    expect(stepForCode('SHIFT_CANCELLED')).toBeNull()
    expect(stepForCode(undefined)).toBeNull()
  })
  it('summarises doses and routines with only what there is to count', () => {
    const slot = (status: string | null) => ({ outcome: status ? { status } : null }) as unknown as PortalDoseSlotDto
    const routine = (isChecked: boolean) => ({ isChecked }) as unknown as PortalShiftRoutineDto
    expect(dosesSummary([slot('Administered'), slot('Administered'), slot('Administered'), slot('Refused'), slot(null)],
      [routine(true), routine(true), routine(true), routine(true), routine(false)])).toBe('3 given, 1 refused · 4 of 5 routines ticked')
    expect(dosesSummary([slot('Missed')], [])).toBe('1 not given')
    expect(dosesSummary([], [])).toBe('')
  })
})

describe('the finish flow: times (Review Focus 1 and 3)', () => {
  // Brisbane is UTC+10 all year. The stamp is 09:05:40 local; now is 17:00:30 local.
  const tz = 'Australia/Brisbane'
  const base: TimesInput = {
    tz, stampedStart: '2026-08-16T23:05:40Z', startOverride: null, endOverride: null, reason: '', kilometres: '', breaks: [],
    now: new Date('2026-08-17T07:00:30Z'),
  }

  it('offers the stamp to the minute ±15 for the start, and from 15 minutes before this minute up to it for the end', () => {
    expect(timeBounds(base.stampedStart, tz, base.now)).toEqual({
      start: { stamp: '2026-08-17T09:05', min: '2026-08-17T08:50', max: '2026-08-17T09:20' },
      end: { now: '2026-08-17T17:00', min: '2026-08-17T16:45', max: '2026-08-17T17:00' },
    })
  })
  it('accepts both edges and refuses a minute past either, naming the window', () => {
    expect(timesError({ ...base, startOverride: '2026-08-17T08:50', reason: 'Early' })).toBeNull()
    expect(timesError({ ...base, startOverride: '2026-08-17T09:20', reason: 'Late' })).toBeNull()
    expect(timesError({ ...base, startOverride: '2026-08-17T08:49', reason: 'x' }))
      .toEqual({ field: 'start', message: 'Choose a time between 8:50 am and 9:20 am.' })
    expect(timesError({ ...base, endOverride: '2026-08-17T16:44', reason: 'x' }))
      .toEqual({ field: 'end', message: 'Choose a time no more than 15 minutes before now.' })
    expect(timesError({ ...base, endOverride: '2026-08-17T17:01', reason: 'x' }))
      .toEqual({ field: 'end', message: "Your finish time can't be in the future." })
    expect(timesError({ ...base, startOverride: '', reason: 'x' })?.field).toBe('start')
  })
  it("treats the stamp's minute and this minute as no change: nothing is sent and no reason is needed", () => {
    const same = { ...base, startOverride: '2026-08-17T09:05', endOverride: '2026-08-17T17:00' }
    expect(movedTimes(same)).toEqual({ start: null, end: null })
    expect(timesError(same)).toBeNull()
  })
  it('sends a moved time as a UTC instant with Z, and then needs a reason', () => {
    const moved = { ...base, endOverride: '2026-08-17T16:50' }
    expect(movedTimes(moved)).toEqual({ start: null, end: '2026-08-17T06:50:00Z' })
    expect(timesError(moved)).toEqual({ field: 'reason', message: 'Say why your times changed.' })
    expect(timesError({ ...moved, reason: '   ' })?.field).toBe('reason')
    expect(timesError({ ...moved, reason: 'Left early' })).toBeNull()
  })
  it('refuses a start that is not before the finish', () => {
    const early = { ...base, now: new Date('2026-08-16T23:15:00Z') }   // ten minutes into the shift
    expect(timesError({ ...early, startOverride: '2026-08-17T09:17', reason: 'x' }))
      .toEqual({ field: 'start', message: 'Your start must be before your finish.' })
  })
  it('crosses midnight for an overnight shift', () => {
    const night = { ...base, stampedStart: '2026-08-17T08:00:00Z', now: new Date('2026-08-17T14:05:00Z') }   // 18:00 start, 00:05 now
    expect(timeBounds(night.stampedStart, tz, night.now).end).toEqual({ now: '2026-08-18T00:05', min: '2026-08-17T23:50', max: '2026-08-18T00:05' })
    expect(movedTimes({ ...night, endOverride: '2026-08-17T23:55' }).end).toBe('2026-08-17T13:55:00Z')
  })
  it('asks for a running break to end first', () => {
    const running = { id: 'b1', startedAt: '2026-08-17T06:40:00Z', endedAt: null, isRunning: true }
    expect(timesError({ ...base, breaks: [running] })).toEqual({ field: 'break', breakId: 'b1', message: 'End your break first.' })
  })
  it('keeps every break inside the moved times', () => {
    const brk = { id: 'b1', startedAt: '2026-08-17T06:40:00Z', endedAt: '2026-08-17T06:52:00Z', isRunning: false }
    expect(timesError({ ...base, breaks: [brk], endOverride: '2026-08-17T16:50', reason: 'Left' })).toEqual({
      field: 'break', breakId: 'b1', message: 'Your times must include your breaks. Change the break first, or your times.',
    })
    expect(timesError({ ...base, breaks: [brk], endOverride: '2026-08-17T16:52', reason: 'Left' })).toBeNull()
  })
})


describe('the finish flow: kilometres (Review Focus 5)', () => {
  it.each([['', null], ['   ', null], ['0', 0], ['12.5', 12.5], ['.5', 0.5], ['2000', 2000], ['2000.0', 2000]] as const)('reads %j as %j', (raw, value) => {
    expect(parseKilometres(raw)).toBe(value)
  })
  it.each(['12,5', '1e3', '2000.05', '2000.1', '-1', '12.55', 'abc', '.'])('refuses %j', raw => {
    expect(parseKilometres(raw)).toBe('invalid')
  })
  it('names the field on step 1', () => {
    const base: TimesInput = {
      tz: 'Australia/Brisbane', stampedStart: '2026-08-16T23:05:40Z', startOverride: null, endOverride: null, reason: '', kilometres: '12,5', breaks: [],
      now: new Date('2026-08-17T07:00:30Z'),
    }
    expect(timesError(base)).toEqual({ field: 'kilometres', message: 'Enter kilometres from 0 to 2,000.' })
  })
})
