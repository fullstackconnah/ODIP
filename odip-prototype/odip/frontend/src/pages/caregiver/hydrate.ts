import type { CaregiverFormDto } from '@/api/types/caregiver'

/**
 * Form values = projection (current values, caregiver-visible) overlaid with the saved draft.
 * The projection uses ParticipantDetailDto's JSON names; ParticipantFormData uses the same names
 * for scalars (core-02's semantic groups were built from them), so a shallow copy is correct.
 * Collections come from the draft if present, else from the projection.
 */
export function hydrateFormFromProjection(dto: CaregiverFormDto): Record<string, unknown> {
  const base: Record<string, unknown> = { ...dto.current, caregiverName: dto.caregiverName ?? '', caregiverRelationship: dto.caregiverRelationship ?? '' }
  const draft = dto.draft
  if (!draft) return base
  const flat: Record<string, unknown> = { ...base }
  for (const [group, value] of Object.entries(draft)) {
    if (value == null) continue
    if (Array.isArray(value)) { flat[group] = value; continue }     // the 4 collections keep their group name
    Object.assign(flat, value as Record<string, unknown>)           // scalar groups flatten onto field names
  }
  return flat
}
