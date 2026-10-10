import type { CaregiverFormDto } from '@/api/types/caregiver'
import { parseHidpaCategories } from '@/api/types/participants'
import { TRI_STATE_FIELDS } from '@/lib/participantPatchGroups'
import { boolToTriState } from '../intake/intakeFormat'

// The yes/no fields, plus the yes/no columns of the consent and health-condition rows.
const TRI_STATE = new Set<string>([...TRI_STATE_FIELDS, 'granted', 'has', 'planProvided', 'trainingRequired'])

/**
 * The API sends null for a blank text, true/false for a yes/no answer and one string for the HIDPA categories. The step
 * checks take undefined, the strings 'true'/'false'/'' and a list, and a step patch turns any other yes/no value into
 * null, which Accept would then write over the recorded answer. Same conversions as the Profile wizard's own hydration.
 */
function toFormValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    TRI_STATE.has(key) ? boolToTriState(value as boolean | null | undefined)
      : key === 'hidpaSupportCategories' ? parseHidpaCategories(value as string | null)   // a flags enum arrives as one comma-separated string
      : value === null ? undefined
      : Array.isArray(value) ? value.map((row) => (row && typeof row === 'object' ? toFormValues(row as Record<string, unknown>) : row))
      : value,
  ]))
}

/**
 * Form values = projection (current values, caregiver-visible) overlaid with the saved draft.
 * The projection uses ParticipantDetailDto's JSON names; ParticipantFormData uses the same names
 * for scalars (core-02's semantic groups were built from them), so a shallow copy is correct.
 * Collections come from the draft if present, else from the projection.
 */
export function hydrateFormFromProjection(dto: CaregiverFormDto): Record<string, unknown> {
  const base: Record<string, unknown> = { ...dto.current, caregiverName: dto.caregiverName ?? '', caregiverRelationship: dto.caregiverRelationship ?? '' }
  const draft = dto.draft
  if (!draft) return toFormValues(base)
  const flat: Record<string, unknown> = { ...base }
  for (const [group, value] of Object.entries(draft)) {
    if (value == null) continue
    if (Array.isArray(value)) { flat[group] = value; continue }     // the 4 collections keep their group name
    Object.assign(flat, value as Record<string, unknown>)           // scalar groups flatten onto field names
  }
  return toFormValues(flat)
}
