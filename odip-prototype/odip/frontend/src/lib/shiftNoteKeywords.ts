// NOTES-02: frontend mirror of the CATEGORY TAXONOMY only from
// Odip.Domain.Rostering.ShiftNoteKeywordVocabulary (backend/Odip.Domain/Rostering/ShiftNoteFlagging.cs).
// The actual scan — and the keyword/stem lists it matches against — is backend-only by design
// (see that file's remarks): the frontend never re-implements the regex matching, so it has no
// load-bearing need for the word lists themselves. This file exists purely for display: category
// labels for the portal's "this note mentions X" banner and the coordinator's roster-slide-over
// badge, driven off the `flaggedCategories` names the server already returns.
//
// There is no shared codegen between the .NET backend and this Vite/TS frontend in this
// prototype, so the two CATEGORY sets (not keyword lists — those don't exist here) are a
// manually-maintained parallel pair, not a single generated source — a change to one is NOT
// automatically reflected in (or checked against) the other. shiftNoteKeywords.test.ts checks
// this file's own internal completeness (every category present, every category labelled) the
// same way Odip.Tests.Rostering.ShiftNoteKeywordVocabularyTests checks the backend's — same
// partition-completeness idiom as ChecklistItemTypeGroupsTests, applied per-side since the two
// languages can't share one assertion. Keep the category NAMES identical on both sides when
// editing either; the backend's stem lists can change freely without touching this file at all.
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
