import type {
  MedicationForm,
  MedicationRoute,
  MedicationType,
  DrugSchedule,
  MedicationSupportLevel,
  MedicationStatus,
  MedicationAdministrationStatus,
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
  status: MedicationStatus
  isHighRisk: boolean
  isPsychotropic: boolean
  isChemicalRestraint: boolean
  drugSchedule: DrugSchedule
  supportLevel: MedicationSupportLevel
  startDate: string | null
  endDate: string | null
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
  isDoseAidPacked: boolean
  consentObtained: boolean
  consentGivenBy: string | null
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
  prescriberName?: string
  pharmacyName?: string
  isDoseAidPacked: boolean
  consentObtained: boolean
  consentGivenBy?: string
  consentDate?: string
  storageRequirements?: string
  startDate?: string
  endDate?: string
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
  scheduledAt: string | null
  administeredAt: string | null
  status: MedicationAdministrationStatus
  doseGiven: string | null
  recordedByName: string | null
  witnessName: string | null
  reason: string | null
  prnReason: string | null
  prnOutcome: string | null
  prnOutcomeAt: string | null
  limitBreachAcknowledged: boolean
  notes: string | null
  createdAt: string
}

export interface CreateAdministrationDto {
  scheduledAt?: string
  administeredAt?: string
  status: MedicationAdministrationStatus
  doseGiven?: string
  witnessName?: string
  reason?: string
  prnReason?: string
  notes?: string
  tripInstanceId?: string
  acknowledgeLimitBreach: boolean
}

export interface UpdateAdministrationDto {
  status: MedicationAdministrationStatus
  administeredAt?: string
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
  scheduledTime: string
  scheduledAt: string
  isHighRisk: boolean
  supportLevel: MedicationSupportLevel
  isOverdue: boolean
  administration: AdministrationDto | null
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
  dosesInLast24h: number
  lastDoseAt: string | null
  outcomePendingAdministrationId: string | null
}

export interface MarDayDto {
  date: string
  entries: MarEntryDto[]
  prnMedications: MarPrnDto[]
}
