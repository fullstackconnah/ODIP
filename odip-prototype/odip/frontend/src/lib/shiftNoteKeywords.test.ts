import { describe, it, expect } from 'vitest'
import {
  SHIFT_NOTE_FLAG_CATEGORIES,
  SHIFT_NOTE_FLAG_LABELS,
  SHIFT_NOTE_FLAG_KEYWORDS,
  formatFlaggedCategoryList,
  incidentTypeForFlaggedCategories,
  type ShiftNoteFlagCategory,
} from './shiftNoteKeywords'

// NOTES-02 — partition-completeness style coverage for this file's own internal consistency
// (same idiom as Odip.Tests.Rostering.ShiftNoteKeywordVocabularyTests on the backend; the two
// sides can't cross-validate against each other — see this file's header comment for why).
describe('SHIFT_NOTE_FLAG_CATEGORIES completeness', () => {
  it('has exactly the four documented categories', () => {
    expect(SHIFT_NOTE_FLAG_CATEGORIES).toEqual(['Falls', 'Medication', 'Injury', 'BehaviourOfConcern'])
  })

  it('every category has a label', () => {
    for (const category of SHIFT_NOTE_FLAG_CATEGORIES) {
      expect(SHIFT_NOTE_FLAG_LABELS[category]).toBeTruthy()
    }
    expect(Object.keys(SHIFT_NOTE_FLAG_LABELS).sort()).toEqual([...SHIFT_NOTE_FLAG_CATEGORIES].sort())
  })

  it('every category has a non-empty keyword list with no duplicates', () => {
    for (const category of SHIFT_NOTE_FLAG_CATEGORIES) {
      const keywords = SHIFT_NOTE_FLAG_KEYWORDS[category]
      expect(keywords.length).toBeGreaterThan(0)
      expect(new Set(keywords.map(k => k.toLowerCase())).size).toBe(keywords.length)
    }
    expect(Object.keys(SHIFT_NOTE_FLAG_KEYWORDS).sort()).toEqual([...SHIFT_NOTE_FLAG_CATEGORIES].sort())
  })

  it('no stem is shared across two categories', () => {
    const seen = new Map<string, ShiftNoteFlagCategory>()
    for (const category of SHIFT_NOTE_FLAG_CATEGORIES) {
      for (const stem of SHIFT_NOTE_FLAG_KEYWORDS[category]) {
        const owner = seen.get(stem.toLowerCase())
        expect(owner === undefined || owner === category).toBe(true)
        seen.set(stem.toLowerCase(), category)
      }
    }
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
