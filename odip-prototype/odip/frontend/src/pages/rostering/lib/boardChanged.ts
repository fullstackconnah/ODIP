import { apiErrorMessages, apiErrorStatus } from '@/lib/shiftPackageErrors'

/** RosteringController.BoardChangedMessage, word for word. The 409 carries no code, so its sentence is what tells it apart from the other 409s. */
export const BOARD_CHANGED_MESSAGE = 'This shift changed after the board was loaded. Refresh the board and try again.'

/** A roster write refused because the board was out of date (assign with expectedStaffId, move-staff, a moving create, set regular). */
export function isBoardChanged(error: unknown): boolean {
  return apiErrorStatus(error) === 409 && apiErrorMessages(error).includes(BOARD_CHANGED_MESSAGE)
}

/** What the page says once Refresh the board has fetched the week again. */
export const BOARD_REFRESHED = 'The board is up to date.'
