import { useParticipantRiskEntries, useParticipantRoutines, useParticipantContactRoles, useParticipantNotes } from '@/api/hooks'

type Count = number | undefined

/**
 * The tab badges. Each calls the list hook with the arguments its section uses, so the page and the section share one cache entry.
 * A count is `undefined` while the list loads or when it failed, so a badge never shows a wrong number. Inactive risks and routines
 * and archived notes are history and are not counted.
 */
export function useParticipantTabCounts(participantId: string | undefined): { health: Count; daily: Count; people: Count; records: Count } {
  const risks = useParticipantRiskEntries(participantId, true)
  const routines = useParticipantRoutines(participantId, true)
  const contacts = useParticipantContactRoles(participantId)
  const notes = useParticipantNotes(participantId, true)
  return {
    health: risks.data?.filter(r => r.isActive).length,
    daily: routines.data?.filter(r => r.isActive).length,
    people: contacts.data?.length,
    records: notes.data?.filter(n => !n.isArchived).length,
  }
}
