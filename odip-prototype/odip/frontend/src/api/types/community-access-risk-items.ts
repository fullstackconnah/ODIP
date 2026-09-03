import type { CommunityAccessRiskItemType, RiskRatingLevel } from './enums'

/**
 * PF-10.2 (SPEC-05). `id` is null for a synthesized "not yet rated" placeholder — the backend
 * always returns exactly one entry per CommunityAccessRiskItemType (see
 * ParticipantCommunityAccessRiskItemsController.GetForParticipant), even for a participant with no
 * rows yet. Same shape convention as ParticipantChecklistItemDto/ParticipantAdlAssessmentDto.
 */
export interface ParticipantCommunityAccessRiskItemDto {
  id: string | null
  participantId: string
  itemType: CommunityAccessRiskItemType
  /** Nullable: null = not yet rated. */
  rating: RiskRatingLevel | null
  strategyNotes: string | null
  createdAt: string | null
  updatedAt: string | null
}

/**
 * Shape used both by CreateParticipantDto.communityAccessRiskItems (rows submitted alongside a
 * new/drafted participant) and by the detail-page/Profile-wizard upsert-by-type endpoint's body.
 * The wizard always submits/round-trips all twenty-two CommunityAccessRiskItemType entries (a
 * fixed enumerated set, not a repeatable add/remove list) — same convention as
 * CreateParticipantChecklistItemDto.
 */
export interface CreateParticipantCommunityAccessRiskItemDto {
  itemType: CommunityAccessRiskItemType
  rating: RiskRatingLevel | null
  strategyNotes?: string | null
}

export interface UpsertParticipantCommunityAccessRiskItemDto {
  rating: RiskRatingLevel | null
  strategyNotes?: string | null
}
