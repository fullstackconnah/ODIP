import type {
  MedicationForm,
  MedicationRoute,
  MedicationType,
  DrugSchedule,
  MedicationSupportLevel,
  MedicationStatus,
  MedicationAdministrationStatus,
  PackagingType,
  MedicationFrequency,
  Weekday,
  WitnessStatus,
} from './enums'

// ── Compliance flags ─────────────────────────────────────
export const MEDICATION_COMPLIANCE_FLAGS = ['ChemicalRestraintUnauthorised', 'ReviewOverdue', 'ConsentMissing'] as const
export type MedicationComplianceFlag = typeof MEDICATION_COMPLIANCE_FLAGS[number]

export const COMPLIANCE_FLAG_LABELS: Record<MedicationComplianceFlag, string> = {
  ChemicalRestraintUnauthorised: 'Restraint not authorised',
  ReviewOverdue: 'Review overdue',
  ConsentMissing: 'Consent missing',
}

// ── Label maps ────────────────────────────────────────────
export const FORM_LABELS: Record<MedicationForm, string> = {
  Tablet: 'Tablet',
  Capsule: 'Capsule',
  Liquid: 'Liquid',
  Injection: 'Injection',
  Patch: 'Patch',
  Cream: 'Cream',
  Inhaler: 'Inhaler',
  Drops: 'Drops',
  Suppository: 'Suppository',
  Enteral: 'Enteral',
  Powder: 'Powder',
  Other: 'Other',
}

export const PACKAGING_LABELS: Record<PackagingType, string> = {
  WebsterPack: 'Webster / blister pack',
  DosetteBox: 'Dosette box',
  OriginalPackaging: 'Original packaging',
  Sachet: 'Sachet',
  Other: 'Other',
}

export const ROUTE_LABELS: Record<MedicationRoute, string> = {
  Oral: 'Oral',
  Subcutaneous: 'Subcutaneous',
  Intramuscular: 'Intramuscular',
  Topical: 'Topical',
  Inhaled: 'Inhaled',
  Enteral: 'Enteral',
  Rectal: 'Rectal',
  Sublingual: 'Sublingual',
  Ocular: 'Ocular',
  Nasal: 'Nasal',
  Other: 'Other',
}

export const MEDICATION_TYPE_LABELS: Record<MedicationType, string> = {
  Regular: 'Regular',
  Prn: 'PRN',
}

export const SUPPORT_LEVEL_LABELS: Record<MedicationSupportLevel, string> = {
  SelfAdministered: 'Self-administered',
  PromptOnly: 'Prompt only',
  Assist: 'Assist',
  Administer: 'Administer',
}

export const DRUG_SCHEDULE_LABELS: Record<DrugSchedule, string> = {
  Unscheduled: 'Unscheduled',
  Schedule2: 'Schedule 2 (Pharmacy)',
  Schedule3: 'Schedule 3 (Pharmacist only)',
  Schedule4: 'Schedule 4 (Prescription)',
  Schedule8: 'Schedule 8 (Controlled)',
}

export const MEDICATION_STATUS_LABELS: Record<MedicationStatus, string> = {
  Active: 'Active',
  OnHold: 'On hold',
  Ceased: 'Ceased',
}

export const ADMIN_STATUS_LABELS: Record<MedicationAdministrationStatus, string> = {
  Administered: 'Administered',
  Refused: 'Refused',
  Withheld: 'Withheld',
  Missed: 'Missed',
  WrongMedication: 'Wrong medication given',
}

/** MED-03/INC-03: MAR outcomes that are auto-incident triggers — recording one of these offers
 * the drop-into-draft-incident prompt (RecordAdministrationModal / IncidentCreatePage prefill). */
export const INCIDENT_TRIGGER_OUTCOMES: readonly MedicationAdministrationStatus[] = ['Refused', 'Withheld', 'Missed', 'WrongMedication']

export const FREQUENCY_LABELS: Record<MedicationFrequency, string> = {
  Daily: 'Every day',
  SpecificDays: 'Specific days of the week',
  EveryNDays: 'Every N days',
}

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
}

export const WITNESS_STATUS_LABELS: Record<WitnessStatus, string> = {
  NotRequired: 'Not required',
  Pending: 'Pending',
  Approved: 'Approved',
  Declined: 'Declined',
}

// ── DTOs ────────────────────────────────────────────────

export interface MedicationListDto {
  id: string
  participantId: string
  participantName: string
  name: string
  strength: string | null
  form: MedicationForm
  route: MedicationRoute
  doseDescription: string | null
  type: MedicationType
  timesOfDay: string | null
  frequency: MedicationFrequency
  daysOfWeek: Weekday[]
  intervalDays: number | null
  anchorDate: string | null
  status: MedicationStatus
  isHighRisk: boolean
  isPsychotropic: boolean
  isChemicalRestraint: boolean
  drugSchedule: DrugSchedule
  supportLevel: MedicationSupportLevel
  packaging: PackagingType
  /** A calendar DATE held in a DateTime ("2026-10-03T00:00:00"): read the day with lib/dateOnly, never as an instant. */
  startDate: string | null
  /** A calendar DATE held in a DateTime ("2026-10-03T00:00:00"): read the day with lib/dateOnly, never as an instant. */
  endDate: string | null
  /** A calendar DATE held in a DateTime ("2026-10-03T00:00:00"): read the day with lib/dateOnly, never as an instant. */
  nextReviewDue: string | null
  complianceFlags: MedicationComplianceFlag[]
}

export interface MedicationDetailDto extends MedicationListDto {
  directions: string | null
  prnIndication: string | null
  prnMaxDosesPer24h: number | null
  prnMinIntervalMinutes: number | null
  purpose: string | null
  bspInPlace: boolean
  restrictivePracticeAuthorisationRef: string | null
  isHighIntensitySupport: boolean
  prescriberName: string | null
  pharmacyName: string | null
  /** MED-01: shown as a "call the pharmacy on ..." tap-to-call link in the missed-medication guidance when present. */
  pharmacyPhone: string | null
  consentObtained: boolean
  consentGivenBy: string | null
  /** A calendar DATE held in a DateTime ("2026-10-03T00:00:00"): read the day with lib/dateOnly, never as an instant. */
  consentDate: string | null
  storageRequirements: string | null
  notes: string | null
  prnDosesInLast24h: number
  createdAt: string
  updatedAt: string
}

export interface CreateMedicationDto {
  name: string
  strength?: string
  form: MedicationForm
  route: MedicationRoute
  doseDescription?: string
  directions?: string
  type: MedicationType
  timesOfDay?: string
  frequency: MedicationFrequency
  daysOfWeek: Weekday[]
  intervalDays?: number
  anchorDate?: string
  prnIndication?: string
  prnMaxDosesPer24h?: number
  prnMinIntervalMinutes?: number
  purpose?: string
  isHighRisk: boolean
  isPsychotropic: boolean
  isChemicalRestraint: boolean
  bspInPlace: boolean
  restrictivePracticeAuthorisationRef?: string
  isHighIntensitySupport: boolean
  drugSchedule: DrugSchedule
  supportLevel: MedicationSupportLevel
  packaging: PackagingType
  prescriberName?: string
  pharmacyName?: string
  pharmacyPhone?: string
  consentObtained: boolean
  consentGivenBy?: string
  /** A calendar DATE held in a DateTime ("2026-10-03T00:00:00"): read the day with lib/dateOnly, never as an instant. */
  consentDate?: string
  storageRequirements?: string
  /** A calendar DATE held in a DateTime ("2026-10-03T00:00:00"): read the day with lib/dateOnly, never as an instant. */
  startDate?: string
  /** A calendar DATE held in a DateTime ("2026-10-03T00:00:00"): read the day with lib/dateOnly, never as an instant. */
  endDate?: string
  /** A calendar DATE held in a DateTime ("2026-10-03T00:00:00"): read the day with lib/dateOnly, never as an instant. */
  nextReviewDue?: string
  notes?: string
}

export interface UpdateMedicationDto extends CreateMedicationDto {
  status: MedicationStatus
}

export interface AdministrationDto {
  id: string
  participantMedicationId: string
  participantId: string
  participantName: string
  medicationName: string
  doseDescription: string | null
  tripInstanceId: string | null
  /** Provider-local WALL-CLOCK value, no zone: the digits are the answer. Read with lib/wallClock, never parseApiDate (DESIGN.md, "Time on the wire"). */
  scheduledAt: string | null
  administeredAt: string | null
  /** The IANA time zone (e.g. "Australia/Sydney") the client was in when it captured
   * administeredAt — null when there's no client-supplied timestamp to anchor (no-JS fallback)
   * or for records predating this field; display falls back to the viewer's local zone. */
  administeredAtTimeZone: string | null
  status: MedicationAdministrationStatus
  doseGiven: string | null
  recordedByName: string | null
  recordedByUserId: string | null
  witnessName: string | null
  witnessStaffId: string | null
  witnessStatus: WitnessStatus
  witnessRequestedAt: string | null
  witnessRespondedAt: string | null
  reason: string | null
  prnReason: string | null
  prnOutcome: string | null
  prnOutcomeAt: string | null
  limitBreachAcknowledged: boolean
  notes: string | null
  createdAt: string
  /** True when the recording user did not hold a current Medication Competency (the provider is in Warn mode): the record was accepted and
   * flagged for review. Always false in Enforce mode and for records that predate the flag. */
  recordedWithoutCompetency: boolean
  /** Set on a Refused, Withheld or Missed record that a later Administered (or WrongMedication) record superseded: the id of its replacement. Absent or null = the active
   * record for its slot. Superseded records stay in the history lists (participant history, administration report) and are never shown by
   * the MAR or the shift package, which show the active record only. */
  supersededByAdministrationId?: string | null
  /** Connection map: the incident this administration was filed into, if any (set once the
   * coordinator/support worker submits the drop-into-draft incident form — see
   * lib/incidentPrefill.ts's buildMarIncidentPrefill). Null until then. */
  incidentId: string | null
}

export interface CreateAdministrationDto {
  /** Provider-local WALL-CLOCK value, no zone: the digits are the answer. Read with lib/wallClock, never parseApiDate (DESIGN.md, "Time on the wire"). */
  scheduledAt?: string
  administeredAt?: string
  /** IANA time zone the client's clock was set to when it captured administeredAt — omitted for
   * the no-JS-timestamp fallback (server stamps its own UTC time with no zone recorded). */
  administeredAtTimeZone?: string
  status: MedicationAdministrationStatus
  doseGiven?: string
  /** Legacy free-text witness — kept for back-compat; new callers should set witnessStaffId instead. */
  witnessName?: string
  /** The staff member selected to witness a high-risk administration. Puts the record into a Pending state for that staff member to approve/decline in their portal. */
  witnessStaffId?: string
  reason?: string
  prnReason?: string
  notes?: string
  tripInstanceId?: string
  acknowledgeLimitBreach: boolean
  /**
   * Optional idempotency key — generate one UUID when the record-dose sheet opens (see newCompletionRequestId) and send
   * the same one on every retry / double tap: a second submit with the same key returns the FIRST record with 200 instead
   * of creating another. Independent of the one-record-per-scheduled-slot rule, which also answers 409
   * ADMINISTRATION_ALREADY_RECORDED (with the existing record as `data`) for a different key.
   */
  idempotencyKey?: string
}

export interface UpdateAdministrationDto {
  status: MedicationAdministrationStatus
  administeredAt?: string
  /** See CreateAdministrationDto.administeredAtTimeZone. Omit to preserve the previously-recorded
   * zone (e.g. an amend that doesn't change administeredAt). */
  administeredAtTimeZone?: string
  doseGiven?: string
  witnessName?: string
  reason?: string
  prnReason?: string
  prnOutcome?: string
  prnOutcomeAt?: string
  notes?: string
}

export interface MarEntryDto {
  medicationId: string
  participantId: string
  participantName: string
  medicationName: string
  strength: string | null
  doseDescription: string | null
  form: MedicationForm
  route: MedicationRoute
  packaging: PackagingType
  /** MED-01: surfaced in the missed-medication guidance's "check the packaging / call the pharmacy" step when present. */
  pharmacyName: string | null
  pharmacyPhone: string | null
  scheduledTime: string
  /** Provider-local WALL-CLOCK value, no zone: the digits are the answer. Read with lib/wallClock, never parseApiDate (DESIGN.md, "Time on the wire"). */
  scheduledAt: string
  isHighRisk: boolean
  supportLevel: MedicationSupportLevel
  isOverdue: boolean
  administration: AdministrationDto | null
  /** Connection map: mirrors administration?.incidentId when administration is present, null
   * otherwise (no administration means no medicationAdministrationId for an incident to
   * reference). MarTab reads administration.incidentId directly rather than this field, but the
   * backend sends both — see AdministrationDto.incidentId and MarEntryDto.IncidentId. */
  incidentId: string | null
}

export interface MarPrnDto {
  medicationId: string
  participantId: string
  participantName: string
  name: string
  strength: string | null
  doseDescription: string | null
  prnIndication: string | null
  prnMaxDosesPer24h: number | null
  prnMinIntervalMinutes: number | null
  packaging: PackagingType
  /** MED-01: same as MarEntryDto.pharmacyName. */
  pharmacyName: string | null
  pharmacyPhone: string | null
  dosesInLast24h: number
  lastDoseAt: string | null
  outcomePendingAdministrationId: string | null
}

export interface MarDayDto {
  date: string
  entries: MarEntryDto[]
  prnMedications: MarPrnDto[]
}
