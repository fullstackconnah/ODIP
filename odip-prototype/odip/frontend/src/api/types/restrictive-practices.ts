import type { MedicationStatus } from './enums'

export const RESTRICTIVE_PRACTICE_TYPES = [
  'Seclusion',
  'ChemicalRestraint',
  'MechanicalRestraint',
  'PhysicalRestraint',
  'EnvironmentalRestraint',
  'Unclassified',
] as const
export type RestrictivePracticeType = typeof RESTRICTIVE_PRACTICE_TYPES[number]

export const RESTRICTIVE_PRACTICE_TYPE_LABELS: Record<RestrictivePracticeType, string> = {
  Seclusion: 'Seclusion',
  ChemicalRestraint: 'Chemical restraint',
  MechanicalRestraint: 'Mechanical restraint',
  PhysicalRestraint: 'Physical restraint',
  EnvironmentalRestraint: 'Environmental restraint',
  Unclassified: 'Unclassified (legacy)',
}

/** Plain-language explanations shown under each option in the Type picker so a coordinator
 * unfamiliar with NDIS restrictive-practice terminology can tell the five categories apart. */
export const RESTRICTIVE_PRACTICE_TYPE_DESCRIPTIONS: Record<RestrictivePracticeType, string> = {
  Seclusion: 'Confining the person alone in a room or area they can’t freely leave',
  ChemicalRestraint: 'Medication used to control behaviour, not to treat a diagnosed condition',
  MechanicalRestraint: 'A device or equipment that restricts the person’s movement',
  PhysicalRestraint: 'Holding or physically restraining part of the person’s body',
  EnvironmentalRestraint: 'Restricting access to parts of the environment, e.g. locked doors or gates',
  Unclassified: 'Type not yet recorded — reclassify this entry when you next review it',
}

/** Routine is part of the everyday plan; Prn is used only when a set situation arises. A linked chemical entry follows its medicine. */
export const RESTRICTIVE_PRACTICE_USE_KINDS = ['Routine', 'Prn'] as const
export type RestrictivePracticeUseKind = typeof RESTRICTIVE_PRACTICE_USE_KINDS[number]

export const USE_KIND_LABELS: Record<RestrictivePracticeUseKind, string> = { Routine: 'Routine', Prn: 'As needed (PRN)' }

/** Where a behaviour support plan stands. The server counts due dates from the first use date and the browser only shows them. */
export type BspPlanState = 'NotStarted' | 'Due' | 'DueSoon' | 'Overdue' | 'InPlace'

export interface RestrictivePracticeDto {
  id: string
  participantId: string
  type: RestrictivePracticeType
  description: string
  authorisedBy: string | null
  authorisationDate: string | null
  /** "YYYY-MM-DD", inclusive: the last day it is authorised. Null means no end date. */
  authorisationEndDate: string | null
  useKind: RestrictivePracticeUseKind
  /** "YYYY-MM-DD". When the practice was first used; the plan due dates count from it. */
  firstUsedOn: string | null
  interimBspDate: string | null
  comprehensiveBspDate: string | null
  /** The earliest use on record (an incident or an administered dose): a suggestion for firstUsedOn, never filled in for you. */
  earliestRecordedUseDate: string | null
  interimBspDueOn: string | null
  comprehensiveBspDueOn: string | null
  interimBspState: BspPlanState
  comprehensiveBspState: BspPlanState
  /** "YYYY-MM-DD". A review date in the past is surfaced as overdue in the UI. */
  reviewDate: string | null
  /** Only meaningful when type === 'ChemicalRestraint'. */
  relatedMedicationId: string | null
  relatedMedicationName: string | null
  /** Status of the linked medicine (a ceased one cannot be re-activated from here). */
  relatedMedicationStatus?: MedicationStatus | null
  /** Whether this needs reporting to the NDIS Commission; null until someone answers. */
  requiresReporting?: boolean | null
  /** The ID the NDIS Commission portal gave this practice or its behaviour support plan. */
  commissionReference?: string | null
  isActive: boolean
  /** The server's one "Authorised" verdict (active, who and when recorded, dated on or before the organisation's today). Show it; never recompute it. */
  isAuthorised: boolean
  createdAt: string
  updatedAt: string
}

export interface UpdateRestrictivePracticeDto {
  type: RestrictivePracticeType
  description: string
  authorisedBy?: string | null
  authorisationDate?: string | null
  /** True: the four dates below are meant as sent (null clears one). Absent: the server leaves them as stored. */
  datesIncluded?: boolean
  authorisationEndDate?: string | null
  /** Ignored by the server while a medicine is linked. */
  useKind?: RestrictivePracticeUseKind
  firstUsedOn?: string | null
  interimBspDate?: string | null
  comprehensiveBspDate?: string | null
  reviewDate?: string | null
  relatedMedicationId?: string | null
  /** null or absent leaves the stored answer as it is. */
  requiresReporting?: boolean | null
  /** Absent leaves the stored value; a blank string clears it. */
  commissionReference?: string
  isActive: boolean
  /** The version the form loaded: the server answers 409 if the entry changed since. */
  expectedUpdatedAt?: string
}

/**
 * PD-2 "Add entries" bulk-add row — the only create path, so `type` may be `'ChemicalRestraint'`.
 * `relatedMedicationId` is optional even then (a chemical restraint entry can be logged before
 * the medication record exists); the server validates it the same way `Create`/`Update` do when
 * it's set.
 */
export interface BulkCreateRestrictivePracticeRowDto {
  type: RestrictivePracticeType
  description: string
  authorisedBy?: string | null
  authorisationDate?: string | null
  authorisationEndDate?: string | null
  useKind?: RestrictivePracticeUseKind
  reviewDate?: string | null
  relatedMedicationId?: string | null
  isActive: boolean
}

export interface BulkCreateRestrictivePracticeDto {
  items: BulkCreateRestrictivePracticeRowDto[]
}

// ── Monthly reports to the NDIS Commission (GET /restrictive-practice-reports) ──

export const RP_REPORT_TYPES = ['UsedAsPerPlan', 'VariedUse', 'NotUsed', 'Eliminated', 'NoServiceProvided', 'ServiceCeased', 'UsesReported'] as const
export type RpReportType = typeof RP_REPORT_TYPES[number]

export const RP_REPORT_TYPE_LABELS: Record<RpReportType, string> = {
  UsedAsPerPlan: 'Used as per plan',
  VariedUse: 'Varied use',
  NotUsed: 'Not used',
  Eliminated: 'Eliminated',
  NoServiceProvided: 'No service provided',
  ServiceCeased: 'Service provision has ceased',
  UsesReported: 'Uses reported',
}

/** The types the server accepts for a practice: routine ones report "as per plan" or "varied", as-needed ones report their uses. */
export const rpReportTypesFor = (useKind: RestrictivePracticeUseKind): RpReportType[] =>
  RP_REPORT_TYPES.filter((t) => (useKind === 'Prn' ? t !== 'UsedAsPerPlan' && t !== 'VariedUse' : t !== 'UsesReported'))

export type RpVariedKind = 'Increased' | 'Decreased' | 'Other'
export const RP_VARIED_KIND_LABELS: Record<RpVariedKind, string> = { Increased: 'Increased', Decreased: 'Decreased', Other: 'Other' }

/** Not a *Status enum: the pill tone is chosen where it is shown. */
export type MonthlyReportState = 'Due' | 'Overdue' | 'Lodged'

export interface RpReportUseDto {
  /** The provider's wall clock, no offset: "2026-10-12T14:30:00". */
  localDateTime: string
  incidentReportId: string | null
  medicationAdministrationId: string | null
}

export interface RpLodgedReportDto {
  id: string
  reportType: RpReportType
  variedKind: RpVariedKind | null
  variedAlsoUnauthorised: boolean | null
  useCount: number | null
  note: string | null
  /** "YYYY-MM-DD" */
  lodgedOn: string
  lodgedByName: string
  createdAt: string
}

/** One practice's month: what is owed, when, the uses behind it, and the report lodged for it once there is one. */
export interface RpReportLine {
  restrictivePracticeId: string
  participantId: string
  participantName: string
  practiceType: RestrictivePracticeType
  practiceDescription: string
  useKind: RestrictivePracticeUseKind
  /** "YYYY-MM-01" */
  month: string
  dueOn: string
  /** True when the due date skipped weekends only: the holiday list has no rows for a year it touched. */
  dueCountedWithoutHolidays: boolean
  state: MonthlyReportState
  /** As-needed lines only. */
  suggestedType: RpReportType | null
  uses: RpReportUseDto[]
  report: RpLodgedReportDto | null
}

export interface LodgeRpReportDto {
  restrictivePracticeId: string
  month: string
  reportType: RpReportType
  variedKind: RpVariedKind | null
  variedAlsoUnauthorised: boolean | null
  note: string | null
  lodgedOn: string
}
