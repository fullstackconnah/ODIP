import { parseISO, format } from 'date-fns'
import type { ParticipantRoutineDto } from '@/api/types'

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/**
 * Which of a participant's active routines are relevant to a given shift window — the read-only
 * list ShiftSlideOver surfaces so a support worker sees them without leaving the roster board.
 * A routine is included when:
 *  - it's timed and its window overlaps the shift's [startTime, endTime) (extended past
 *    midnight when the shift `endsNextDay`), and its day matches (or it applies every day); or
 *  - it's untimed (no reliable window to compare) but flagged `isCritical` — those are always
 *    surfaced on a day that matches, since they're must-know regardless of timing.
 * Sorted critical-first, then by start time (untimed last).
 */
export function getRelevantRoutines(
  routines: ParticipantRoutineDto[],
  shift: { serviceDate: string; startTime: string; endTime: string; endsNextDay: boolean },
): ParticipantRoutineDto[] {
  const shiftDay = format(parseISO(shift.serviceDate), 'EEEE')
  const shiftStart = toMinutes(shift.startTime)
  const shiftEnd = toMinutes(shift.endTime) + (shift.endsNextDay ? 1440 : 0)

  const relevant = routines.filter(r => {
    if (!r.isActive) return false
    // PD-4: r.days is a non-empty day-name list (the full 7 for "every day") — a routine applies
    // to this shift's day when that day is in the set, not via an every-day/single-day distinction.
    if (!r.days.includes(shiftDay)) return false

    if (!r.startTime || !r.endTime) return r.isCritical

    const routineStart = toMinutes(r.startTime)
    const routineEnd = toMinutes(r.endTime)
    return shiftStart < routineEnd && routineStart < shiftEnd
  })

  return [...relevant].sort((a, b) => {
    if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1
    if (!a.startTime && !b.startTime) return 0
    if (!a.startTime) return 1
    if (!b.startTime) return -1
    return a.startTime.localeCompare(b.startTime)
  })
}
