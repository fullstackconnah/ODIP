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

export interface RestrictivePracticeDto {
  id: string
  participantId: string
  type: RestrictivePracticeType
  description: string
  authorisedBy: string | null
  authorisationDate: string | null
  /** "YYYY-MM-DD". A review date in the past is surfaced as overdue in the UI. */
  reviewDate: string | null
  /** Only meaningful when type === 'ChemicalRestraint'. */
  relatedMedicationId: string | null
  relatedMedicationName: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateRestrictivePracticeDto {
  type: RestrictivePracticeType
  description: string
  authorisedBy?: string | null
  authorisationDate?: string | null
  reviewDate?: string | null
  relatedMedicationId?: string | null
  isActive: boolean
}

export interface UpdateRestrictivePracticeDto {
  type: RestrictivePracticeType
  description: string
  authorisedBy?: string | null
  authorisationDate?: string | null
  reviewDate?: string | null
  relatedMedicationId?: string | null
  isActive: boolean
}

/**
 * RP-01 bulk-add row. No `relatedMedicationId` — the bulk table has no medication column, so
 * `type` must not be `'ChemicalRestraint'`; the backend rejects any row that is (see
 * RestrictivePracticesController.CreateBulk's XML doc for why bulk doesn't support it).
 */
export interface BulkCreateRestrictivePracticeRowDto {
  type: RestrictivePracticeType
  description: string
  authorisedBy?: string | null
  authorisationDate?: string | null
  reviewDate?: string | null
  isActive: boolean
}

export interface BulkCreateRestrictivePracticeDto {
  items: BulkCreateRestrictivePracticeRowDto[]
}

/** RP types selectable for RP-01's bulk-add flow — ChemicalRestraint is excluded (see above). */
export const BULK_RESTRICTIVE_PRACTICE_TYPES = RESTRICTIVE_PRACTICE_TYPES.filter(t => t !== 'ChemicalRestraint')
