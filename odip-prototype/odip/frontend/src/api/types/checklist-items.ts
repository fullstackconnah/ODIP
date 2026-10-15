import type { ChecklistItemType, ChecklistItemValue } from './enums'

/**
 * INTAKE-03/04, CommunityAccessDailyLiving stream. `id` is null for a synthesized "not yet
 * assessed" placeholder — the backend always returns exactly one entry per ChecklistItemType (see
 * ParticipantChecklistItemsController.MaterializeAll), even for a participant with no rows
 * yet. Same shape as ParticipantAdlAssessmentDto (INTAKE sub-wave C2).
 */
export interface ParticipantChecklistItemDto {
  id: string | null
  participantId: string
  itemType: ChecklistItemType
  /** Nullable: null = not yet assessed. */
  value: ChecklistItemValue | null
  notes: string | null
  createdAt: string | null
  updatedAt: string | null
}

/**
 * Shape used both by CreateParticipantDto.checklistItems (rows submitted alongside a new/drafted
 * participant) and by the detail-page upsert-by-type endpoint's body. The wizard always submits
 * all twenty-one ChecklistItemType entries (a fixed enumerated set, not a repeatable add/remove
 * list) — same convention as CreateParticipantAdlAssessmentDto.
 */
export interface CreateParticipantChecklistItemDto {
  itemType: ChecklistItemType
  value: ChecklistItemValue | null
  notes?: string | null
}
