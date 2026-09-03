import type { PatchParticipantDto } from '@/api/types/participant-patch'
import { getFieldMapping } from './documentMapping'

/**
 * cg04 Task 8 — flattens a caregiver submission's `PatchParticipantDto` payload against the
 * current caregiver-visible projection into the rows the review page (Task 11) renders,
 * containing ONLY the fields that actually changed. Scalar groups compare field-by-field;
 * the four collections (consents / healthConditions / adlAssessments / checklistItems) are
 * matched by their real key property name, confirmed against `src/api/types/participants.ts`
 * (actually `consents.ts` / `health-conditions.ts` / `adl-assessments.ts` / `checklist-items.ts`
 * — the DTOs re-exported from there): consentType, conditionType, adlType, itemType.
 */

export type DiffRow = { field: string; label: string; group: string; current: string; proposed: string }

const COLLECTION_KEYS: Record<string, string> = {
  consents: 'consentType',
  healthConditions: 'conditionType',
  adlAssessments: 'adlType',
  checklistItems: 'itemType',
}

function norm(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function label(field: string): string {
  return getFieldMapping(field)?.label ?? field
}

function stripKey(o: Record<string, unknown>, k: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([key]) => key !== k))
}

export function computeCaregiverDiff(current: Record<string, unknown>, payload: PatchParticipantDto | null): DiffRow[] {
  if (!payload) return []
  const rows: DiffRow[] = []

  for (const [group, value] of Object.entries(payload)) {
    if (value == null) continue

    const keyProp = COLLECTION_KEYS[group]
    if (keyProp && Array.isArray(value)) {
      const currentItems = (current[group] as Array<Record<string, unknown>> | undefined) ?? []
      for (const item of value as Array<Record<string, unknown>>) {
        const k = String(item[keyProp])
        const before = currentItems.find((c) => String(c[keyProp]) === k)
        const b = norm(before ? stripKey(before, keyProp) : null)
        const a = norm(stripKey(item, keyProp))
        if (a !== b) {
          rows.push({ field: `${group}.${k}`, label: `${label(group)} — ${k}`, group, current: b || '—', proposed: a || '—' })
        }
      }
      continue
    }

    for (const [field, proposed] of Object.entries(value as Record<string, unknown>)) {
      const a = norm(proposed)
      const b = norm(current[field])
      if (a !== b) {
        rows.push({ field, label: label(field), group, current: b || '—', proposed: a || '—' })
      }
    }
  }

  return rows
}
