import { apiErrorCode, apiErrorMessages, apiErrorStatus } from '@/lib/shiftPackageErrors'

/** ShiftErrorCodes.ShiftBoardChanged: the code on every board-changed 409, so a reworded sentence cannot switch the action off. */
export const BOARD_CHANGED_CODE = 'SHIFT_BOARD_CHANGED'

/** RosteringController.BoardChangedMessage, word for word. The fallback for a server from before the code existed. */
export const BOARD_CHANGED_MESSAGE = 'This shift changed after the board was loaded. Refresh the board and try again.'

/** A roster write refused because the board was out of date (assign with expectedStaffId, move-staff, a moving create, set regular). */
export function isBoardChanged(error: unknown): boolean {
  return apiErrorStatus(error) === 409 && (apiErrorCode(error) === BOARD_CHANGED_CODE || apiErrorMessages(error).includes(BOARD_CHANGED_MESSAGE))
}

/** What is said once Refresh the board has fetched the week again. */
export const BOARD_REFRESHED = 'The board is up to date.'

/** What the shift panel says when the refreshed board no longer has the carried person on the shift they were carried off: the server would refuse the move again, so it is not sent. */
export const moveGoneSentence = (name: string) => `${name} is no longer on the shift you moved them from. Save adds this shift without moving them.`
