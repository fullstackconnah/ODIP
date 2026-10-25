import type { PatchParticipantDto } from '@/api/types/participant-patch'
import { getFieldMapping } from './documentMapping'
import { COLLECTION_KEYS, norm } from './caregiverPayload'
import { liveWire } from '@/pages/caregiver/hydrate'

export { norm }

/**
 * cg04 Task 8 — flattens a caregiver submission's `PatchParticipantDto` payload against the
 * current caregiver-visible projection into the rows the review page (Task 11) renders,
 * containing ONLY the fields that actually changed. Scalar groups compare field-by-field;
 * the four collections (consents / healthConditions / adlAssessments / checklistItems) are
 * matched by their real key property name (see COLLECTION_KEYS) and compared column by column.
 *
 * With the `base` the caregiver loaded, "changed" means changed from that base, which is what Accept applies;
 * `staffChanged` marks a row whose live value also moved from the base since. Without one (sent before bases
 * existed) every payload value that differs from the record is listed, as Accept applies them all.
 */

export type DiffRow = { field: string; label: string; group: string; current: string; proposed: string; staffChanged?: boolean }

export function label(field: string): string {
  return getFieldMapping(field)?.label ?? field
}

type Row = Record<string, unknown>
const rowByKey = (rows: unknown, key: string, k: string) => (Array.isArray(rows) ? (rows as Row[]).find((r) => String(r[key]) === k) : undefined)
const withoutKey = (o: Row | undefined, key: string) => (o ? Object.fromEntries(Object.entries(o).filter(([c]) => c !== key)) : null)

export function computeCaregiverDiff(current: Record<string, unknown>, payload: PatchParticipantDto | null, base?: PatchParticipantDto | null): DiffRow[] {
  if (!payload) return []
  const rows: DiffRow[] = []
  const baseGroups = (base ?? undefined) as Record<string, unknown> | undefined
  const liveGroups = (base ? liveWire(current) : undefined) as Record<string, unknown> | undefined

  for (const [group, value] of Object.entries(payload)) {
    if (value == null) continue

    const keyProp = COLLECTION_KEYS[group]
    if (keyProp && Array.isArray(value)) {
      for (const item of value as Row[]) {
        const k = String(item[keyProp])
        const live = rowByKey(current[group], keyProp, k)
        const ref = baseGroups ? rowByKey(baseGroups[group], keyProp, k) : live
        const cols = Object.keys(item).filter((c) => c !== keyProp && norm(item[c]) !== norm(ref?.[c]))
        if (!cols.length) continue
        const staffChanged = liveGroups ? cols.some((c) => norm(rowByKey(liveGroups[group], keyProp, k)?.[c]) !== norm(ref?.[c])) : undefined
        rows.push({
          field: `${group}.${k}`, label: `${label(group)} — ${k}`, group,
          current: norm(withoutKey(live, keyProp)) || '—', proposed: norm(withoutKey(item, keyProp)) || '—',
          ...(staffChanged !== undefined && { staffChanged }),
        })
      }
      continue
    }

    const baseGroup = baseGroups?.[group] as Row | undefined
    const liveGroup = liveGroups?.[group] as Row | undefined
    for (const [field, proposed] of Object.entries(value as Row)) {
      const a = norm(proposed)
      if (a === norm(baseGroups ? baseGroup?.[field] : current[field])) continue
      rows.push({
        field, label: label(field), group, current: norm(current[field]) || '—', proposed: a || '—',
        ...(baseGroups && { staffChanged: norm(liveGroup?.[field]) !== norm(baseGroup?.[field]) }),
      })
    }
  }

  return rows
}
