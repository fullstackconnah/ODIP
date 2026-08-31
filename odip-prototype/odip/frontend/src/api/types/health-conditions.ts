import type { HealthConditionType } from './enums'

/**
 * INTAKE sub-wave C1. `id` is null for a synthesized "not yet answered" placeholder — the backend
 * always returns exactly one entry per HealthConditionType (see
 * ParticipantHealthConditionsController.GetForParticipant), even for a participant with no rows
 * yet. Same shape as ParticipantConsentDto (INTAKE sub-wave B).
 */
export interface ParticipantHealthConditionDto {
  id: string | null
  participantId: string
  conditionType: HealthConditionType
  /** Tri-state: null = not yet answered, true = has this condition/support need, false = does not. */
  has: boolean | null
  severity: string | null
  planProvided: boolean | null
  trainingRequired: boolean | null
  notes: string | null
  createdAt: string | null
  updatedAt: string | null
}

/**
 * Shape used both by CreateParticipantDto.healthConditions (rows submitted alongside a new/drafted
 * participant) and by the detail-page upsert-by-type endpoint's body.
 */
export interface CreateParticipantHealthConditionDto {
  conditionType: HealthConditionType
  has: boolean | null
  severity?: string | null
  planProvided?: boolean | null
  trainingRequired?: boolean | null
  notes?: string | null
}

export interface UpsertParticipantHealthConditionDto {
  has: boolean | null
  severity?: string | null
  planProvided?: boolean | null
  trainingRequired?: boolean | null
  notes?: string | null
}

/**
 * INTAKE sub-wave C1, Master Data Dictionary MED-002..011 — the ten structured health/medical
 * conditions the Participant Profile source form's "Diagnoses & Medical Conditions" table tracks
 * per participant. See the backend's HealthConditionType enum doc for the full DIAG-01
 * reconciliation and epilepsy-derivation notes.
 */
export const HEALTH_CONDITION_TYPE_LABELS: Record<HealthConditionType, string> = {
  IntellectualDisability: 'Intellectual Disability',
  VisualImpairment: 'Visual Impairment',
  HearingImpairment: 'Hearing Impairment',
  MentalHealth: 'Mental Health',
  HighBloodPressure: 'High Blood Pressure',
  WoundCare: 'Wound Care',
  Epilepsy: 'Epilepsy',
  Diabetes: 'Diabetes',
  Asthma: 'Asthma',
  Dysphagia: 'Dysphagia',
}
