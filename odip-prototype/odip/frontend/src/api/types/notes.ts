export interface ParticipantNoteDto {
  id: string
  participantId: string
  title: string
  description: string
  isPinned: boolean
  isArchived: boolean
  createdByName: string | null
  createdAt: string
  updatedAt: string
  /** PD-5: non-null identifies this as a system-generated safety-critical note (e.g. "safety:allergies"). */
  sourceKey: string | null
  /** PD-5: true when a manually-edited auto-note's source field has changed since the edit. */
  hasSourceDrift: boolean
}

export interface CreateParticipantNoteDto {
  title: string
  description: string
  isPinned: boolean
  /** One per add-note modal opening: a re-press after a lost response replays the first note instead of adding a second. */
  idempotencyKey?: string | null
}

export interface UpdateParticipantNoteDto {
  title: string
  description: string
  isPinned: boolean
  isArchived: boolean
}
