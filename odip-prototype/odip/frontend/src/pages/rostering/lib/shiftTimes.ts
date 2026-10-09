// The length of a shift or pattern as the forms see it. The server is the backstop (RosteringController refuses a shift that ends at or before its start unless it ends the next day, and says this sentence);
// the forms use the same rule so the person is told under End time, where they are looking, and a check that cannot say anything useful is not sent.

/** The server's sentence for a shift with no length (RosteringController.ShiftEndsBeforeItStartsMessage). A 400 carrying it is shown under End time, not in the alert at the foot of the form. */
export const NO_LENGTH_MESSAGE = "The shift must end after it starts. Tick 'Ends the next day' for an overnight shift."

/**
 * Whether a pair of times has no length: both filled in ("HH:mm"), the end at or before the start, and the shift not ending the next day. A time that is still empty is a missing answer, not a shift with no
 * length, so it is not reported here (the field is required and says so itself).
 */
export function hasNoLength(start: string, end: string, endsNextDay: boolean): boolean {
  return !!start && !!end && !endsNextDay && end <= start
}

/** An hour after a start time ("09:00" gives "10:00"), so a new shift opens with a length. Stops at 23:59 rather than wrapping to a time before the start; an unreadable start gives ''. */
export function oneHourAfter(start: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(start)
  if (!match) return ''
  const hour = Number(match[1])
  return hour >= 23 ? '23:59' : `${String(hour + 1).padStart(2, '0')}:${match[2]}`
}
