import { describe, it, expect } from 'vitest'
import { getRelevantRoutines } from './routines'
import type { ParticipantRoutineDto } from '@/api/types'

function makeRoutine(overrides: Partial<ParticipantRoutineDto> = {}): ParticipantRoutineDto {
  return {
    id: 'routine-1',
    participantId: 'participant-1',
    title: 'Routine',
    description: 'Details',
    category: 'PersonalCare',
    dayOfWeek: null,
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
    const routine = makeRoutine({ dayOfWeek: 'Tuesday', startTime: '10:00:00', endTime: '11:00:00' })
    expect(getRelevantRoutines([routine], mondayShift)).toEqual([])
  })

  it('includes an every-day timed routine whose window overlaps the shift', () => {
    const routine = makeRoutine({ dayOfWeek: null, startTime: '10:00:00', endTime: '11:00:00' })
    expect(getRelevantRoutines([routine], mondayShift)).toEqual([routine])
  })

  it('excludes a timed routine whose window does not overlap the shift', () => {
    const routine = makeRoutine({ startTime: '20:00:00', endTime: '21:00:00' })
    expect(getRelevantRoutines([routine], mondayShift)).toEqual([])
  })

  it('includes a timed routine matching the shift day', () => {
    const routine = makeRoutine({ dayOfWeek: 'Monday', startTime: '09:30:00', endTime: '10:00:00' })
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
