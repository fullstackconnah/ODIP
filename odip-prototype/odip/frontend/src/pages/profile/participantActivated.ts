/**
 * Hand-off between the onboarding checklist's "Make active" and the Active participants tab. Making a participant active finalises them, so they
 * have left the Onboarding tab for the Active tab: the checklist sends the user there and passes who it was through router navigation state, so the
 * tab can confirm it once (the same idea as the Intake wizard's hand-off to the Onboarding tab, see intakeComplete.ts).
 */

/** The Active participants tab of the Participants hub. */
export const ACTIVE_TABLE_PATH = '/participants?tab=active'

export type ParticipantActivatedNotice = { participantId: string; name: string }

/** Router state for `navigate(ACTIVE_TABLE_PATH, { state })`. */
export function participantActivatedState(participantId: string, name: string): { participantActivated: ParticipantActivatedNotice } {
  return { participantActivated: { participantId, name } }
}

/** The notice carried by `location.state`, or null when the user did not arrive from a completed onboarding. */
export function readParticipantActivatedNotice(state: unknown): ParticipantActivatedNotice | null {
  if (typeof state !== 'object' || state === null || !('participantActivated' in state)) return null
  const notice = (state as { participantActivated: unknown }).participantActivated
  if (typeof notice !== 'object' || notice === null) return null
  const { participantId, name } = notice as Record<string, unknown>
  return typeof participantId === 'string' && typeof name === 'string' ? { participantId, name } : null
}
