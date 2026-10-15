// The length of a shift or pattern as the forms see it. The server is the backstop (RosteringController refuses a shift that ends at or before its start unless it ends the next day, and says this sentence);
// the forms use the same rule so the person is told under End time, where they are looking, and a check that cannot say anything useful is not sent.
import { apiErrorCode, apiErrorMessages } from '@/lib/shiftPackageErrors'
import { extractErrorMessage } from '@/lib/utils'

/** The server's sentence for a shift with no length (RosteringController.ShiftEndsBeforeItStartsMessage). The fallback for recognising its 400 (below), and what the form's own rule says under End time. */
export const NO_LENGTH_MESSAGE = "The shift must end after it starts. Tick 'Ends the next day' for an overnight shift."

/** The code the server sends with that 400 (RosteringController.ShiftNoLengthCode): on the dry run, a create and an update of a shift, and a pattern's create and update. */
export const NO_LENGTH_CODE = 'shift-no-length'

/** Whether a failed call is the server's refusal of a pair of times with no length: by its code, and by its sentence when the answer carries no code (an older server, a mock). Such a 400 is shown under End time, not in the alert at the foot of the form. */
export function isNoLengthRefusal(error: unknown): boolean {
  return apiErrorCode(error) === NO_LENGTH_CODE || apiErrorMessages(error).includes(NO_LENGTH_MESSAGE)
}

/** A failed call as a panel keeps it: the words to show (the server's own when it sent any, else the fallback) and whether it is the refusal for no length. */
export type PanelRefusal = { message: string; noLength: boolean }

export function refusalOf(error: unknown, fallback: string): PanelRefusal {
  return { message: extractErrorMessage(error, fallback), noLength: isNoLengthRefusal(error) }
}

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
