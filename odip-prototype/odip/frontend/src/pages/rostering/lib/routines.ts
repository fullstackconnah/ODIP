import { parseISO, format, addDays } from 'date-fns'
import type { ParticipantRoutineDto } from '@/api/types'

const MINUTES_PER_DAY = 1440

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/**
 * Which of a participant's active routines are relevant to a given shift window — the read-only
 * list ShiftSlideOver surfaces so a support worker sees them without leaving the roster board.
 * A routine is relevant when:
 *  - it's timed and, on a calendar day it applies on, its window overlaps the shift's
 *    [startTime, endTime) — where the shift window runs past midnight when it `endsNextDay`; or
 *  - it's untimed (no reliable window to compare) but flagged `isCritical` — those are always
 *    surfaced on a shift that touches a day they apply on, since they're must-know regardless of timing.
 *
 * OVERNIGHT SHIFTS: each routine is placed on every calendar day the shift touches (the service day,
 * plus the next day when the shift runs past midnight) whose weekday it applies on. A routine whose
 * end is before its start crosses midnight itself. So a 02:00 or 06:30 routine now matches a
 * 22:00-06:00 shift, on the NEXT day's weekday — the old rule compared the routine's time of day with
 * the stretched window but never stretched the routine, and only checked the start day's weekday.
 * The day BEFORE the service day is tried for timed routines too: a Sunday 22:00-06:00 routine is still
 * running at 00:00-06:00 on Monday, so it belongs to a Monday 00:00-08:00 shift.
 * The server applies the same rule (backend RoutineWindowMatcher -> `shiftRoutines`).
 *
 * Sorted critical-first, then chronologically inside the shift window (untimed last).
 */
export function getRelevantRoutines(
  routines: ParticipantRoutineDto[],
  shift: { serviceDate: string; startTime: string; endTime: string; endsNextDay: boolean },
): ParticipantRoutineDto[] {
  const serviceDate = parseISO(shift.serviceDate)
  const shiftStart = toMinutes(shift.startTime)
  const shiftEnd = toMinutes(shift.endTime) + (shift.endsNextDay ? MINUTES_PER_DAY : 0)
  // Day offsets (minutes from the service day's midnight) the window touches: the service day, and the
  // next day when the window runs past midnight.
  const dayOffsets = shiftEnd > MINUTES_PER_DAY ? [0, MINUTES_PER_DAY] : [0]
  // A timed routine may also have started the evening before the service day and still be running when the window opens.
  const timedDayOffsets = [-MINUTES_PER_DAY, ...dayOffsets]
  const dayNameAt = (offset: number) => format(addDays(serviceDate, offset / MINUTES_PER_DAY), 'EEEE')

  const matches: { routine: ParticipantRoutineDto; occursAt: number | null }[] = []
  for (const r of routines) {
    if (!r.isActive) continue
    // PD-4: r.days is a non-empty day-name list (the full 7 for "every day") — a routine applies on a
    // calendar day when that day is in the set, not via an every-day/single-day distinction.
    if (!r.startTime || !r.endTime) {
      const appliesInWindow = dayOffsets.some(offset => r.days.includes(dayNameAt(offset)))
      if (r.isCritical && appliesInWindow) matches.push({ routine: r, occursAt: null })
      continue
    }

    const applicable = timedDayOffsets.filter(offset => r.days.includes(dayNameAt(offset)))
    if (applicable.length === 0) continue

    const start = toMinutes(r.startTime)
    const end = toMinutes(r.endTime)
    for (const offset of applicable) {
      const occurrenceStart = offset + start
      const occurrenceEnd = offset + end + (end < start ? MINUTES_PER_DAY : 0)
      if (shiftStart < occurrenceEnd && occurrenceStart < shiftEnd) {
        matches.push({ routine: r, occursAt: Math.max(occurrenceStart, shiftStart) })
        break
      }
    }
  }

  return matches
    .sort((a, b) => {
      if (a.routine.isCritical !== b.routine.isCritical) return a.routine.isCritical ? -1 : 1
      if (a.occursAt === null && b.occursAt === null) return 0
      if (a.occursAt === null) return 1
      if (b.occursAt === null) return -1
      return a.occursAt - b.occursAt
    })
    .map(m => m.routine)
}
