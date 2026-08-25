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
}

export interface CreateParticipantNoteDto {
  title: string
  description: string
  isPinned: boolean
}

export interface UpdateParticipantNoteDto {
  title: string
  description: string
  isPinned: boolean
  isArchived: boolean
}
