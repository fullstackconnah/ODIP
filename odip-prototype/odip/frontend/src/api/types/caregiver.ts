import type { PatchParticipantDto } from './participant-patch'

export type CaregiverSubmissionStatus = 'Draft' | 'Submitted' | 'Accepted' | 'Rejected' | 'Revoked'

/** Mirrors backend CaregiverFormDto. `current` is a caregiver-visible subset of ParticipantDetailDto's JSON. */
export type CaregiverFormDto = {
  status: CaregiverSubmissionStatus
  caregiverName: string | null
  caregiverRelationship: string | null
  expiresAt: string
  rejectionNote: string | null
  current: Record<string, unknown>
  editable: string[]
  draft: PatchParticipantDto | null
}

export type CaregiverDraftDto = {
  caregiverName: string
  caregiverRelationship?: string | null
  payload: PatchParticipantDto
}

export type CaregiverLinkDto = { token: string; expiresAt: string }

export type CaregiverSubmissionListItemDto = {
  id: string
  participantId: string
  participantName: string
  status: CaregiverSubmissionStatus
  caregiverName: string | null
  createdAt: string
  expiresAt: string
  submittedAt: string | null
}

export type CaregiverSubmissionDetailDto = CaregiverSubmissionListItemDto & {
  caregiverRelationship: string | null
  reviewedAt: string | null
  rejectionNote: string | null
  current: Record<string, unknown>
  payload: PatchParticipantDto | null
}
