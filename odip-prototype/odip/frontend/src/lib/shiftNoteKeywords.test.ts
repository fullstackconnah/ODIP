import { describe, it, expect } from 'vitest'
import {
  SHIFT_NOTE_FLAG_CATEGORIES,
  SHIFT_NOTE_FLAG_LABELS,
  formatFlaggedCategoryList,
  incidentTypeForFlaggedCategories,
} from './shiftNoteKeywords'

// NOTES-02 — partition-completeness style coverage for this file's own internal consistency
// (same idiom as Odip.Tests.Rostering.ShiftNoteKeywordVocabularyTests on the backend; the two
// sides can't cross-validate against each other — see this file's header comment for why). Only
// the category taxonomy/labels are covered here — the keyword/stem lists the banner text is
// ultimately driven by are backend-only (see ShiftNoteFlagging.cs), so this file carries no
// keyword data to check.
describe('SHIFT_NOTE_FLAG_CATEGORIES completeness', () => {
  it('has exactly the four documented categories', () => {
    expect(SHIFT_NOTE_FLAG_CATEGORIES).toEqual(['Falls', 'Medication', 'Injury', 'BehaviourOfConcern'])
  })

  it('every category has a label, and no extra/missing labels exist', () => {
    for (const category of SHIFT_NOTE_FLAG_CATEGORIES) {
      expect(SHIFT_NOTE_FLAG_LABELS[category]).toBeTruthy()
    }
    expect(Object.keys(SHIFT_NOTE_FLAG_LABELS).sort()).toEqual([...SHIFT_NOTE_FLAG_CATEGORIES].sort())
  })
})

describe('formatFlaggedCategoryList', () => {
  it('returns empty string for no categories', () => {
    expect(formatFlaggedCategoryList([])).toBe('')
  })

  it('returns a single label as-is', () => {
    expect(formatFlaggedCategoryList(['Falls'])).toBe('falls')
  })

  it('joins two labels with "and"', () => {
    expect(formatFlaggedCategoryList(['Falls', 'Medication'])).toBe('falls and medication')
  })

  it('joins three-plus labels with commas and a trailing "and"', () => {
    expect(formatFlaggedCategoryList(['Falls', 'Medication', 'Injury'])).toBe('falls, medication and injury')
  })
})

describe('incidentTypeForFlaggedCategories', () => {
  it('prioritises Injury for Falls', () => {
    expect(incidentTypeForFlaggedCategories(['Falls'])).toBe('Injury')
  })

  it('prioritises Injury for Injury', () => {
    expect(incidentTypeForFlaggedCategories(['Injury'])).toBe('Injury')
  })

  it('prioritises Injury over Medication when both are flagged', () => {
    expect(incidentTypeForFlaggedCategories(['Medication', 'Falls'])).toBe('Injury')
  })

  it('falls back to MedicationError when only Medication is flagged', () => {
    expect(incidentTypeForFlaggedCategories(['Medication'])).toBe('MedicationError')
  })

  it('falls back to BehaviourOfConcern when only that is flagged', () => {
    expect(incidentTypeForFlaggedCategories(['BehaviourOfConcern'])).toBe('BehaviourOfConcern')
  })

  it('falls back to Other when nothing is flagged', () => {
    expect(incidentTypeForFlaggedCategories([])).toBe('Other')
  })
})
