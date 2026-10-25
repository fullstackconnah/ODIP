import type { CaregiverFormDto } from '@/api/types/caregiver'
import { parseHidpaCategories, parseServiceStreams } from '@/api/types/participants'
import { TRI_STATE_FIELDS } from '@/lib/participantPatchGroups'
import { buildCaregiverWire, COLLECTION_KEYS, norm } from '@/lib/caregiverPayload'
import type { ParticipantFormData } from '@/lib/participantSchema'
import type { PatchParticipantDto } from '@/api/types/participant-patch'
import { boolToTriState } from '../intake/intakeFormat'

// The yes/no fields, plus the yes/no columns of the consent and health-condition rows.
const TRI_STATE = new Set<string>([...TRI_STATE_FIELDS, 'granted', 'has', 'planProvided', 'trainingRequired'])

/**
 * The API sends null for a blank text, true/false for a yes/no answer and one string for the HIDPA categories and the
 * service streams. The step checks and patches take undefined, the strings 'true'/'false'/'' and a list, and a
 * step patch turns any other yes/no value into null, which Accept would then write over the recorded answer. Same
 * conversions as the Profile wizard's own hydration.
 */
export function toFormValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    TRI_STATE.has(key) ? boolToTriState(value as boolean | null | undefined)
      : key === 'hidpaSupportCategories' ? parseHidpaCategories(value as string | null)   // a flags enum arrives as one comma-separated string
      : key === 'serviceStreams' ? parseServiceStreams(value as string | null)
      : value === null ? undefined
      : Array.isArray(value) ? value.map((row) => (row && typeof row === 'object' ? toFormValues(row as Record<string, unknown>) : row))
      : value,
  ]))
}

type Row = Record<string, unknown>
type Wire = Record<string, Row | Row[] | null | undefined>

/** The wire patch of the live record: what an untouched form sends, so the base for a field the caregiver has not changed. */
export function liveWire(current: Record<string, unknown>): PatchParticipantDto {
  return buildCaregiverWire(toFormValues({ ...current }) as unknown as ParticipantFormData)
}

const byKey = (rows: Row[] | undefined, key: string, k: unknown) => rows?.find((r) => String(r[key]) === String(k))
const changedCols = (row: Row, key: string, stored: Row | undefined) => Object.keys(row).filter((c) => c !== key && norm(row[c]) !== norm(stored?.[c]))

/**
 * Form values = projection (current values, caregiver-visible) overlaid with the saved draft.
 * The projection uses ParticipantDetailDto's JSON names; ParticipantFormData uses the same names
 * for scalars (core-02's semantic groups were built from them), so a shallow copy is correct.
 * With the base the caregiver started from, only the members they changed from it come from the draft and the rest stay live,
 * so a staff edit made meanwhile is not shown as theirs. A draft saved before bases existed overlays whole, as it always did.
 */
export function hydrateFormFromProjection(dto: CaregiverFormDto): Record<string, unknown> {
  const flat: Record<string, unknown> = { ...dto.current, caregiverName: dto.caregiverName ?? '', caregiverRelationship: dto.caregiverRelationship ?? '' }
  const draft = dto.draft as Wire | null
  if (!draft) return toFormValues(flat)
  const stored = dto.base as Wire | null | undefined
  for (const [group, value] of Object.entries(draft)) {
    if (value == null) continue
    if (!stored) {
      if (Array.isArray(value)) flat[group] = value     // the 4 collections keep their group name
      else Object.assign(flat, value)                    // scalar groups flatten onto field names
      continue
    }
    if (Array.isArray(value)) {
      const key = COLLECTION_KEYS[group]
      const rows = [...((flat[group] as Row[] | undefined) ?? [])]
      for (const row of value) {
        const cols = changedCols(row, key, byKey(stored[group] as Row[] | undefined, key, row[key]))
        if (!cols.length) continue
        const at = rows.findIndex((r) => String(r[key]) === String(row[key]))
        const target: Row = at >= 0 ? { ...rows[at] } : { [key]: row[key] }
        for (const c of cols) target[c] = row[c]
        if (at >= 0) rows[at] = target; else rows.push(target)
      }
      flat[group] = rows
      continue
    }
    const was = (stored[group] ?? {}) as Row
    for (const [m, v] of Object.entries(value)) if (norm(v) !== norm(was[m])) flat[m] = v
  }
  return toFormValues(flat)
}

/** The base the form sends back: the stored one where the caregiver changed a member, the live wire value everywhere else. */
export function hydrateBase(dto: CaregiverFormDto): PatchParticipantDto {
  const live = liveWire(dto.current)
  const draft = dto.draft as Wire | null
  const stored = dto.base as Wire | null | undefined
  if (!draft || !stored) return live
  const out = structuredClone(live) as unknown as Wire
  for (const [group, value] of Object.entries(draft)) {
    if (value == null) continue
    if (Array.isArray(value)) {
      const key = COLLECTION_KEYS[group]
      const rows = (out[group] = (out[group] as Row[] | undefined) ?? []) as Row[]
      for (const row of value) {
        const was = byKey(stored[group] as Row[] | undefined, key, row[key])
        const cols = changedCols(row, key, was)
        if (!cols.length) continue
        let target = byKey(rows, key, row[key])
        if (!target) rows.push(target = { [key]: row[key] })
        for (const c of cols) target[c] = was?.[c] ?? null
      }
      continue
    }
    const was = (stored[group] ?? {}) as Row
    const target = (out[group] = (out[group] as Row | undefined) ?? {}) as Row
    for (const [m, v] of Object.entries(value)) if (norm(v) !== norm(was[m])) target[m] = was[m] ?? null
  }
  return out as unknown as PatchParticipantDto
}
