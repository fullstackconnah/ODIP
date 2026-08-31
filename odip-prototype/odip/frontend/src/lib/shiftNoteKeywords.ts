// NOTES-02: frontend mirror of Odip.Domain.Rostering.ShiftNoteKeywordVocabulary
// (backend/Odip.Domain/Rostering/ShiftNoteFlagging.cs). The actual scan happens server-side only
// (see PortalController.CreateShiftNote/UpdateShiftNote) — the frontend never re-implements the
// regex matching. This file exists purely for display: category labels for the portal's "this
// note mentions X" banner and the coordinator's roster-slide-over badge, plus the same stem lists
// kept alongside them for documentation/parity.
//
// There is no shared codegen between the .NET backend and this Vite/TS frontend in this
// prototype, so the two vocabularies are a manually-maintained parallel pair, not a single
// generated source — a change to one is NOT automatically reflected in (or checked against) the
// other. shiftNoteKeywords.test.ts checks this file's own internal completeness (every category
// present, every list non-empty, no duplicates) the same way
// Odip.Tests.Rostering.ShiftNoteKeywordVocabularyTests checks the backend's — same
// partition-completeness idiom as ChecklistItemTypeGroupsTests, applied per-side since the two
// languages can't share one assertion. Keep the two lists' words identical when editing either.
import type { IncidentType } from '@/api/types/enums'

export type ShiftNoteFlagCategory = 'Falls' | 'Medication' | 'Injury' | 'BehaviourOfConcern'

export const SHIFT_NOTE_FLAG_CATEGORIES: readonly ShiftNoteFlagCategory[] = ['Falls', 'Medication', 'Injury', 'BehaviourOfConcern']

/** Lowercase, banner-copy-ready labels — "This note mentions {label}." */
export const SHIFT_NOTE_FLAG_LABELS: Record<ShiftNoteFlagCategory, string> = {
  Falls: 'falls',
  Medication: 'medication',
  Injury: 'injury',
  BehaviourOfConcern: 'behaviours',
}

/** Word-for-word mirror of ShiftNoteKeywordVocabulary.Stems on the backend — see the file header. */
export const SHIFT_NOTE_FLAG_KEYWORDS: Record<ShiftNoteFlagCategory, readonly string[]> = {
  Falls: ['fall', 'fell', 'slip', 'stumble', 'collapse', 'tumble'],
  Medication: ['medicat', 'dos', 'tablet', 'pill', 'prn', 'overdose', 'pharmacy'],
  Injury: ['injur', 'wound', 'bruis', 'bleed', 'bled', 'lacerat', 'fracture', 'sprain', 'burn', 'scald'],
  BehaviourOfConcern: ['aggress', 'agitat', 'meltdown', 'outburst', 'abscond', 'restrain', 'seclusion', 'distress', 'harm'],
}

/** Joins flagged category labels for the banner: "falls" / "falls and medication" / "falls, medication and injury". */
export function formatFlaggedCategoryList(categories: readonly ShiftNoteFlagCategory[]): string {
  const labels = categories.map(c => SHIFT_NOTE_FLAG_LABELS[c])
  if (labels.length === 0) return ''
  if (labels.length === 1) return labels[0]
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/**
 * INC-03-style default incident type for the "file an incident report" hand-off — picked by a
 * fixed priority when a note trips more than one category, since IncidentCreatePage's Incident
 * Type field is single-select: physical harm (Falls/Injury) outranks Medication, which outranks
 * BehaviourOfConcern. The coordinator/worker can always change it before submitting — this is
 * only a starting point, same "skeleton, not a decision" posture as the rest of the prefill.
 */
export function incidentTypeForFlaggedCategories(categories: readonly ShiftNoteFlagCategory[]): IncidentType {
  if (categories.includes('Falls') || categories.includes('Injury')) return 'Injury'
  if (categories.includes('Medication')) return 'MedicationError'
  if (categories.includes('BehaviourOfConcern')) return 'BehaviourOfConcern'
  return 'Other'
}
