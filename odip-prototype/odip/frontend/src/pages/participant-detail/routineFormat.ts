import { formatShiftTime } from '@/lib/utils'
import type { ParticipantRoutineDto } from '@/api/types/routines'

// Routine display helpers shared by the Routines tab and Overview's "Today's routines" card. A module of its own, not the component
// files: React Fast Refresh wants a component file to export only components.

/** Monday-first for display, independent of the .NET DayOfWeek (Sunday=0) wire ordering. */
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

const WEEKDAY_ABBREVIATIONS: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
}

/**
 * Readable label for a routine's day set (PD-4) — "Every day" for all 7, "Weekdays"/"Weekends"
 * for those two common subsets, otherwise a Monday-first comma list of abbreviations (e.g.
 * "Mon, Wed, Fri"). Re-sorts to Monday-first order regardless of the input array's order, since
 * the days array is built by toggling individual checkboxes and isn't guaranteed to arrive sorted.
 */
export function formatDaySet(days: string[]): string {
  const sorted = WEEKDAYS.filter(d => days.includes(d))
  if (sorted.length === 7) return 'Every day'
  if (sorted.length === 5 && WEEKDAYS.slice(0, 5).every(d => sorted.includes(d))) return 'Weekdays'
  if (sorted.length === 2 && WEEKDAYS.slice(5).every(d => sorted.includes(d))) return 'Weekends'
  return sorted.map(d => WEEKDAY_ABBREVIATIONS[d]).join(', ')
}

/** Same "h:mma–h:mma" formatting as the rostering board's shift times, plus an "Untimed" fallback
 * for routines with no start/end — delegates to the shared formatShiftTime instead of duplicating it.
 * A routine may also have only a start ("the task needs to be done from this time") or only an end
 * ("the task needs to be done by this time") — both render as a single time with a directional word. */
export function formatRoutineTime(startTime: string | null, endTime: string | null): string {
  if (startTime && endTime) return `${formatShiftTime(startTime)}–${formatShiftTime(endTime)}`
  if (startTime) return `From ${formatShiftTime(startTime)}`
  if (endTime) return `By ${formatShiftTime(endTime)}`
  return 'Untimed'
}

/** Critical first, then by time (untimed last). */
export function sortRoutines(items: ParticipantRoutineDto[]): ParticipantRoutineDto[] {
  return [...items].sort((a, b) => {
    if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1
    // An end-only routine ("By 5pm") still carries a real time constraint, so it sorts among
    // timed routines by its deadline rather than being lumped in with true "Untimed" routines.
    const aTime = a.startTime ?? a.endTime
    const bTime = b.startTime ?? b.endTime
    if (!aTime && !bTime) return 0
    if (!aTime) return 1
    if (!bTime) return -1
    return aTime.localeCompare(bTime)
  })
}

/** The active routines that run on this weekday, sorted. */
export function routinesOn(routines: ParticipantRoutineDto[], weekday: string): ParticipantRoutineDto[] {
  return sortRoutines(routines.filter(r => r.isActive && r.days.includes(weekday)))
}
