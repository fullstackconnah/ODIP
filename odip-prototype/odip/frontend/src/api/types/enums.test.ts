import { describe, it, expect } from 'vitest'
import { ADL_TYPES, PERSONAL_ADL_TYPES, COMMUNITY_DOMESTIC_ADL_TYPES, adlCategoryOf } from './enums'
import { ADL_TYPE_LABELS } from './adl-assessments'

/**
 * INTAKE sub-wave C2, review-round polish — frontend counterpart to the backend's
 * AdlTypeGroupsTests: PERSONAL_ADL_TYPES and COMMUNITY_DOMESTIC_ADL_TYPES must together cover
 * every AdlType member exactly once (no omission, no overlap), so a future 21st AdlType member
 * that nobody remembers to add to either list fails loudly here instead of silently
 * misclassifying (falling through to 'CommunityDomestic' by default in adlCategoryOf, or never
 * rendering in either of the wizard/detail-page's two grouped sections). Cross-checked against
 * both ADL_TYPES (the source-of-truth declaration order) and ADL_TYPE_LABELS' keys (the label
 * map every consumer actually renders from), so a mismatch between any of the three is caught.
 */
describe('ADL type category partition (PERSONAL_ADL_TYPES / COMMUNITY_DOMESTIC_ADL_TYPES)', () => {
  it('together cover every AdlType member from ADL_TYPES exactly once, with no omission', () => {
    const union = [...PERSONAL_ADL_TYPES, ...COMMUNITY_DOMESTIC_ADL_TYPES].sort()
    expect(union).toEqual([...ADL_TYPES].sort())
  })

  it('together cover every AdlType member from ADL_TYPE_LABELS\' keys exactly once', () => {
    const union = [...PERSONAL_ADL_TYPES, ...COMMUNITY_DOMESTIC_ADL_TYPES].sort()
    expect(union).toEqual(Object.keys(ADL_TYPE_LABELS).sort())
  })

  it('do not overlap', () => {
    const personal = new Set(PERSONAL_ADL_TYPES)
    const overlap = COMMUNITY_DOMESTIC_ADL_TYPES.filter((t) => personal.has(t))
    expect(overlap).toEqual([])
  })

  it('have no internal duplicates', () => {
    expect(new Set(PERSONAL_ADL_TYPES).size).toBe(PERSONAL_ADL_TYPES.length)
    expect(new Set(COMMUNITY_DOMESTIC_ADL_TYPES).size).toBe(COMMUNITY_DOMESTIC_ADL_TYPES.length)
  })

  it('adlCategoryOf agrees with group membership for every AdlType member', () => {
    for (const type of ADL_TYPES) {
      const expected = (PERSONAL_ADL_TYPES as readonly string[]).includes(type) ? 'Personal' : 'CommunityDomestic'
      expect(adlCategoryOf(type)).toBe(expected)
    }
  })
})
