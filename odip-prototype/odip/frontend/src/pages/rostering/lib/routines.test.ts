import { describe, it, expect } from 'vitest'
import { getRelevantRoutines } from './routines'
import type { ParticipantRoutineDto } from '@/api/types'

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function makeRoutine(overrides: Partial<ParticipantRoutineDto> = {}): ParticipantRoutineDto {
  return {
    id: 'routine-1',
    participantId: 'participant-1',
    title: 'Routine',
    description: 'Details',
    category: 'PersonalCare',
    days: ALL_DAYS,
    startTime: null,
    endTime: null,
    isCritical: false,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// 2026-08-17 is a Monday.
const mondayShift = { serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false }

describe('getRelevantRoutines', () => {
  it('excludes inactive routines', () => {
    const routine = makeRoutine({ isActive: false, startTime: '10:00:00', endTime: '11:00:00' })
    expect(getRelevantRoutines([routine], mondayShift)).toEqual([])
  })

  it('excludes routines pinned to a different day of week', () => {
    const routine = makeRoutine({ days: ['Tuesday'], startTime: '10:00:00', endTime: '11:00:00' })
    expect(getRelevantRoutines([routine], mondayShift)).toEqual([])
  })

  it('includes an every-day timed routine whose window overlaps the shift', () => {
    const routine = makeRoutine({ days: ALL_DAYS, startTime: '10:00:00', endTime: '11:00:00' })
    expect(getRelevantRoutines([routine], mondayShift)).toEqual([routine])
  })

  it('includes a multi-day (not every-day) routine whose day set contains the shift day', () => {
    const routine = makeRoutine({ days: ['Monday', 'Wednesday', 'Friday'], startTime: '10:00:00', endTime: '11:00:00' })
    expect(getRelevantRoutines([routine], mondayShift)).toEqual([routine])
  })

  it('excludes a multi-day (not every-day) routine whose day set excludes the shift day', () => {
    const routine = makeRoutine({ days: ['Tuesday', 'Thursday'], startTime: '10:00:00', endTime: '11:00:00' })
    expect(getRelevantRoutines([routine], mondayShift)).toEqual([])
  })

  it('excludes a timed routine whose window does not overlap the shift', () => {
    const routine = makeRoutine({ startTime: '20:00:00', endTime: '21:00:00' })
    expect(getRelevantRoutines([routine], mondayShift)).toEqual([])
  })

  it('includes a timed routine matching the shift day', () => {
    const routine = makeRoutine({ days: ['Monday'], startTime: '09:30:00', endTime: '10:00:00' })
    expect(getRelevantRoutines([routine], mondayShift)).toEqual([routine])
  })

  it('extends the shift window past midnight when endsNextDay is set', () => {
    const overnightShift = { serviceDate: '2026-08-17', startTime: '22:00:00', endTime: '06:00:00', endsNextDay: true }
    const routine = makeRoutine({ startTime: '23:00:00', endTime: '23:30:00' })
    expect(getRelevantRoutines([routine], overnightShift)).toEqual([routine])
  })

  it('includes an untimed critical routine on a matching day', () => {
    const routine = makeRoutine({ isCritical: true, startTime: null, endTime: null })
    expect(getRelevantRoutines([routine], mondayShift)).toEqual([routine])
  })

  it('excludes an untimed non-critical routine', () => {
    const routine = makeRoutine({ isCritical: false, startTime: null, endTime: null })
    expect(getRelevantRoutines([routine], mondayShift)).toEqual([])
  })

  it('sorts critical routines first, then by start time, untimed last', () => {
    const untimedCritical = makeRoutine({ id: 'r1', isCritical: true, startTime: null, endTime: null })
    const timedCritical = makeRoutine({ id: 'r2', isCritical: true, startTime: '09:15:00', endTime: '09:30:00' })
    const timedNonCritical = makeRoutine({ id: 'r3', isCritical: false, startTime: '09:00:00', endTime: '09:10:00' })

    const result = getRelevantRoutines([timedNonCritical, untimedCritical, timedCritical], mondayShift)

    expect(result.map(r => r.id)).toEqual(['r2', 'r1', 'r3'])
  })
})

describe('getRelevantRoutines — overnight shifts (after-midnight matching)', () => {
  // 2026-08-17 is a Monday; a Monday-night 22:00 -> 06:00 shift runs into Tuesday.
  const overnight = { serviceDate: '2026-08-17', startTime: '22:00:00', endTime: '06:00:00', endsNextDay: true }

  it('matches a routine that falls after midnight (the old rule never stretched the routine)', () => {
    const nightCheck = makeRoutine({ id: 'night', startTime: '02:00:00', endTime: '02:30:00' })
    const wakeUp = makeRoutine({ id: 'wake', startTime: '05:30:00', endTime: '06:30:00' })
    const lunch = makeRoutine({ id: 'lunch', startTime: '12:00:00', endTime: '13:00:00' })

    expect(getRelevantRoutines([nightCheck, wakeUp, lunch], overnight).map(r => r.id)).toEqual(['night', 'wake'])
  })

  it('checks the weekday of the day the routine actually falls on — the NEXT day for the after-midnight part', () => {
    const tuesdayOnly = makeRoutine({ id: 'tue', days: ['Tuesday'], startTime: '02:00:00', endTime: '02:30:00' })
    const mondayOnly = makeRoutine({ id: 'mon', days: ['Monday'], startTime: '02:00:00', endTime: '02:30:00' })

    // Monday's 02:00 was before the shift began; Tuesday's 02:00 is inside it.
    expect(getRelevantRoutines([tuesdayOnly, mondayOnly], overnight).map(r => r.id)).toEqual(['tue'])
  })

  it('matches a routine that itself crosses midnight', () => {
    const overnightSupport = makeRoutine({ id: 'sleep', startTime: '22:00:00', endTime: '06:00:00' })

    expect(getRelevantRoutines([overnightSupport], overnight)).toEqual([overnightSupport])
    // ...but it is not relevant to a daytime shift (Monday 22:00 -> Tuesday 06:00 never touches 09:00-17:00).
    expect(getRelevantRoutines([overnightSupport], mondayShift)).toEqual([])
  })

  it('orders the window chronologically: a 23:00 routine before a 02:00 one', () => {
    const late = makeRoutine({ id: 'late', startTime: '23:00:00', endTime: '23:30:00' })
    const early = makeRoutine({ id: 'early', startTime: '02:00:00', endTime: '02:30:00' })

    expect(getRelevantRoutines([early, late], overnight).map(r => r.id)).toEqual(['late', 'early'])
  })

  it('surfaces an untimed critical routine when either day of the shift applies', () => {
    const tuesdayCritical = makeRoutine({ id: 'tue-crit', days: ['Tuesday'], isCritical: true })
    const wednesdayCritical = makeRoutine({ id: 'wed-crit', days: ['Wednesday'], isCritical: true })

    expect(getRelevantRoutines([tuesdayCritical, wednesdayCritical], overnight).map(r => r.id)).toEqual(['tue-crit'])
  })

  it('does not pull the next day in when the shift ends exactly at midnight', () => {
    const untilMidnight = { serviceDate: '2026-08-17', startTime: '16:00:00', endTime: '00:00:00', endsNextDay: true }
    const tuesdayMorning = makeRoutine({ id: 'tue-am', days: ['Tuesday'], startTime: '00:00:00', endTime: '01:00:00' })
    const mondayEvening = makeRoutine({ id: 'mon-pm', days: ['Monday'], startTime: '20:00:00', endTime: '21:00:00' })

    expect(getRelevantRoutines([tuesdayMorning, mondayEvening], untilMidnight).map(r => r.id)).toEqual(['mon-pm'])
  })

  it('a day shift is unchanged: a routine on the next day never matches', () => {
    const tuesdayMorning = makeRoutine({ days: ['Tuesday'], startTime: '10:00:00', endTime: '11:00:00' })

    expect(getRelevantRoutines([tuesdayMorning], mondayShift)).toEqual([])
  })
})
