import type { AdlType, AdlLevel } from './enums'

/**
 * INTAKE sub-wave C2. `id` is null for a synthesized "not yet assessed" placeholder — the backend
 * always returns exactly one entry per AdlType (see ParticipantAdlAssessmentsController.
 * GetForParticipant), even for a participant with no rows yet. Same shape as
 * ParticipantHealthConditionDto (INTAKE sub-wave C1).
 */
export interface ParticipantAdlAssessmentDto {
  id: string | null
  participantId: string
  adlType: AdlType
  /** Nullable: null = not yet assessed. */
  level: AdlLevel | null
  notes: string | null
  createdAt: string | null
  updatedAt: string | null
}

/**
 * Shape used both by CreateParticipantDto.adlAssessments (rows submitted alongside a new/drafted
 * participant) and by the detail-page upsert-by-type endpoint's body.
 */
export interface CreateParticipantAdlAssessmentDto {
  adlType: AdlType
  level: AdlLevel | null
  notes?: string | null
}

export interface UpsertParticipantAdlAssessmentDto {
  level: AdlLevel | null
  notes?: string | null
}

/**
 * INTAKE sub-wave C2, Master Data Dictionary PADL-002..007/CADL-001..015 — the 20 activities of
 * daily living the Participant Profile source form's Personal (§1c-15) and Community/Domestic
 * (§1c-17) ADL tables track per participant. See the backend's AdlType enum doc for the full
 * Personal/Community-Domestic grouping rationale.
 */
export const ADL_TYPE_LABELS: Record<AdlType, string> = {
  Dressing: 'Dressing',
  Bathing: 'Bathing / Showering',
  OralCare: 'Oral Care',
  Grooming: 'Grooming',
  Toileting: 'Toileting / Bowel Care',
  MedicationAdministration: 'Medication Administration',
  CommunityAccess: 'Community Access',
  Socialising: 'Socialising',
  MoneyHandling: 'Money Handling',
  Appointments: 'Attending Appointments',
  WorkStudy: 'Work / Study',
  Transportation: 'Transportation',
  PublicTransport: 'Public Transport',
  RoadAwareness: 'Road Awareness',
  Kitchen: 'Kitchen',
  Laundry: 'Laundry',
  Cleaning: 'Cleaning',
  Gardening: 'Gardening',
  Shopping: 'Shopping',
  Banking: 'Banking',
}

/**
 * INTAKE sub-wave C2 — the I/S/A/F rating scale. See ADL_LEVELS' doc (api/types/enums.ts) and the
 * backend's AdlLevel enum doc for why these labels are this PR's best-effort plain-English
 * expansion of the source form's unexpanded column-header letters, not a confirmed source reading.
 */
export const ADL_LEVEL_LABELS: Record<AdlLevel, string> = {
  Independent: 'Independent (I)',
  Supervision: 'Supervision (S)',
  Assistance: 'Assistance (A)',
  FullSupport: 'Full Support (F)',
}
