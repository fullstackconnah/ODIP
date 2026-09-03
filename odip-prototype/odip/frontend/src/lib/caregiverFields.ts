import { fieldsForEntry, sharedFieldsDisplayedOnProfile, type DocumentMappingEntry } from './documentMapping'

/**
 * Allocation-contract field ids a primary caregiver must never see or edit. Frontend twin of
 * the backend's CaregiverFieldPolicy.InternalFields (which is keyed by DTO JSON name and
 * reconciled to these ids by its own drift guard). The test file fails if any id here is not in
 * DOCUMENT_MAPPING, or if any Profile field is neither here nor editable.
 *
 * - `preferredStaffId`, `behaviourRiskRating` — clinical/rostering fields, entryPhase 'profile'.
 * - `behaviourRiskSummary` — the scalar member of the backend's `risksHazardsSummary` PATCH
 *   group (participantPatchGroups.ts), shown read-only on Profile via `sharedFieldsDisplayedOnProfile`.
 * - `ndisNumber`, `planStartDate`, `planEndDate`, `planType`, `fundingSource`, `fundingOrganisation`,
 *   `isRepeatClient` — the `ndisPlan` PATCH group (plan-management/funding-admin info).
 * - `region` — the `serviceProfile` PATCH group, EXCEPT `serviceStreams` (never excluded — the
 *   caregiver wizard's own step visibility depends on reading it).
 */
export const CAREGIVER_INTERNAL_FIELDS: ReadonlySet<string> = new Set<string>([
  'behaviourRiskRating',
  'behaviourRiskSummary',
  'preferredStaffId',
  'ndisNumber',
  'planStartDate',
  'planEndDate',
  'planType',
  'fundingSource',
  'fundingOrganisation',
  'isRepeatClient',
  'region',
])

export function caregiverEditableFields(): DocumentMappingEntry[] {
  return fieldsForEntry('profile').filter((e) => !CAREGIVER_INTERNAL_FIELDS.has(e.field))
}

export function caregiverReadOnlyFields(): DocumentMappingEntry[] {
  return sharedFieldsDisplayedOnProfile().filter((e) => !CAREGIVER_INTERNAL_FIELDS.has(e.field))
}
