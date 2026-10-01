import type { MedicationCompetencyMode } from './enums'

/**
 * How strictly the organisation gates participants that are not fully ready (intake, onboarding, signed agreement).
 * `Warn` (the default): staff can roster, book and activate them and the gaps show as warnings.
 * `Enforce`: the server refuses until they are ready.
 */
export type ParticipantReadinessMode = 'Warn' | 'Enforce'

export interface ProviderSettingsDto {
  id: string
  registrationNumber: string
  abn: string
  organisationName: string
  address: string
  state: string
  gstRegistered: boolean
  isPaceProvider: boolean
  bankAccountName: string | null
  bsb: string | null
  accountNumber: string | null
  invoiceFooterNotes: string | null
  /** MED-02: primary manager contact — shown first by the (future) MED-01 missed-medication guidance. */
  managerName: string | null
  managerPhone: string | null
  /** The org's participant-readiness check. The query can still resolve to `null` for an org with no row yet: treat that as `Warn`. */
  participantReadinessMode: ParticipantReadinessMode
  /** Warn (default): a user without a current Medication Competency may record and the record is flagged. Enforce: refused (403). */
  medicationCompetencyMode: MedicationCompetencyMode
}

export interface UpsertProviderSettingsDto {
  registrationNumber: string
  abn: string
  organisationName: string
  address: string
  state?: string
  gstRegistered: boolean
  isPaceProvider: boolean
  bankAccountName?: string
  bsb?: string
  accountNumber?: string
  invoiceFooterNotes?: string
  managerName?: string
  managerPhone?: string
  /**
   * Send this ONLY when the user deliberately changed the readiness check. The server changes the mode only when the
   * field is present, so echoing the loaded value back from a stale tab would silently revert another admin's change.
   */
  participantReadinessMode?: ParticipantReadinessMode
  /** Omit to leave the setting as it is: saving the other fields from a client that does not know it must not reset Enforce to Warn. */
  medicationCompetencyMode?: MedicationCompetencyMode
}
