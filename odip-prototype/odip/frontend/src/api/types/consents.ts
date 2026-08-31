import type { ConsentType } from './enums'

/**
 * INTAKE sub-wave B. `id` is null for a synthesized "not yet answered" placeholder — the backend
 * always returns exactly one entry per ConsentType (see ParticipantConsentsController.GetForParticipant),
 * even for a participant with no rows yet.
 */
export interface ParticipantConsentDto {
  id: string | null
  participantId: string
  consentType: ConsentType
  /** Tri-state: null = not yet answered, true = granted, false = declined. */
  granted: boolean | null
  recordedAt: string | null
  signedByName: string | null
  signedDate: string | null
  createdAt: string | null
  updatedAt: string | null
}

/**
 * Shape used both by CreateParticipantDto.consents (rows submitted alongside a new/drafted
 * participant) and by the detail-page upsert-by-type endpoint's body.
 */
export interface CreateParticipantConsentDto {
  consentType: ConsentType
  granted: boolean | null
  signedByName?: string | null
  signedDate?: string | null
}

export interface UpsertParticipantConsentDto {
  granted: boolean | null
  signedByName?: string | null
  signedDate?: string | null
}

/**
 * INTAKE (sub-wave B), Master Data Dictionary CNST-001..013 collapsed to the seven distinct
 * consent decisions the source Participant Profile form's "Consent and Terms" block asks for —
 * see the backend's ConsentType enum doc for the full derivation.
 */
export const CONSENT_TYPE_LABELS: Record<ConsentType, string> = {
  PhotoVideo: 'Photo & Video (promotional use)',
  Alcohol: 'Alcohol',
  OtcMedication: 'Non-Prescribed / Over-the-Counter Medication',
  EmergencyMedical: 'Emergency Medical Treatment',
  Privacy: 'Privacy (collection & use of information)',
  TravelInsurance: 'Travel Insurance (Holidays/STA)',
  TermsAndConditions: 'Terms & Conditions',
}
