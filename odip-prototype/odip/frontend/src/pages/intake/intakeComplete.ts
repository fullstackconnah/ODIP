/**
 * Hand-off between the Intake wizard and the Onboarding table. Completing Intake puts the participant
 * on the onboarding worklist (the server creates their onboarding record in the same save), so the
 * wizard sends the user to the Onboarding tab of the Participants hub instead of the Profile wizard, and
 * passes the name of who just completed via router navigation state so the table can confirm it once.
 */

/** The Onboarding tab of the Participants hub (`/onboarding` redirects here too). */
export const ONBOARDING_TABLE_PATH = '/participants?tab=onboarding'

export type IntakeCompleteNotice = { participantId: string; name: string }

/** Router state for `navigate(ONBOARDING_TABLE_PATH, { state })`. */
export function intakeCompleteState(participantId: string, name: string): { intakeComplete: IntakeCompleteNotice } {
  return { intakeComplete: { participantId, name } }
}

/** The notice carried by `location.state`, or null when the user did not arrive from a completed intake. */
export function readIntakeCompleteNotice(state: unknown): IntakeCompleteNotice | null {
  if (typeof state !== 'object' || state === null || !('intakeComplete' in state)) return null
  const notice = (state as { intakeComplete: unknown }).intakeComplete
  if (typeof notice !== 'object' || notice === null) return null
  const { participantId, name } = notice as Record<string, unknown>
  return typeof participantId === 'string' && typeof name === 'string' ? { participantId, name } : null
}
