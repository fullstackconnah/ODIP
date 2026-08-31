import type { AtRiskParty } from './enums'

export interface ParticipantRiskEntryDto {
  id: string
  participantId: string
  atRiskParty: AtRiskParty
  description: string
  mitigationNotes: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Shape used both by the nested-CRUD create endpoint (participantId comes from the route) and,
 * as CreateParticipantDto.riskEntries, for rows submitted alongside a brand-new participant.
 */
export interface CreateParticipantRiskEntryDto {
  atRiskParty: AtRiskParty
  description: string
  mitigationNotes?: string | null
  isActive: boolean
}

export interface UpdateParticipantRiskEntryDto {
  atRiskParty: AtRiskParty
  description: string
  mitigationNotes?: string | null
  isActive: boolean
}

export const AT_RISK_PARTY_LABELS: Record<AtRiskParty, string> = {
  Participant: 'The participant',
  OtherParticipants: 'Other participants',
  Public: 'The public',
  Staff: 'Staff',
}
