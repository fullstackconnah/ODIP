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
  reviewDate?: string | null
  relatedMedicationId?: string | null
  isActive: boolean
}

export interface BulkCreateRestrictivePracticeDto {
  items: BulkCreateRestrictivePracticeRowDto[]
}
