import { describe, it, expect } from 'vitest'
import {
  ADL_TYPES, PERSONAL_ADL_TYPES, COMMUNITY_DOMESTIC_ADL_TYPES, adlCategoryOf,
  CHECKLIST_ITEM_TYPES, COMMUNITY_MOBILITY_RISK_ITEM_TYPES, COMMUNITY_BEHAVIOUR_OF_CONCERN_ITEM_TYPES,
  CHECKLIST_ITEM_TYPE_LABELS, getChecklistItemGroup,
  COMMUNITY_ACCESS_RISK_ITEM_TYPES, ROAD_TRAFFIC_RISK_ITEM_TYPES, BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES,
  HEALTH_AND_PERSONAL_SAFETY_RISK_ITEM_TYPES, COMMUNITY_ACCESS_RISK_ITEM_TYPE_LABELS, getCommunityAccessRiskItemCategory,
} from './enums'
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

/**
 * INTAKE-03/04, review-round polish — frontend counterpart to the backend's
 * ChecklistItemTypeGroupsTests: COMMUNITY_MOBILITY_RISK_ITEM_TYPES and
 * COMMUNITY_BEHAVIOUR_OF_CONCERN_ITEM_TYPES must together cover every ChecklistItemType member
 * exactly once (no omission, no overlap). Both subsets are derived from CHECKLIST_ITEM_TYPES via
 * slice(), so coverage/no-overlap are structurally guaranteed here, but a future 22nd
 * ChecklistItemType member landing in CHECKLIST_ITEM_TYPES without a matching
 * CHECKLIST_ITEM_TYPE_LABELS entry (the label map every consumer actually renders from) would
 * still slip through unnoticed without this cross-check — mirrors the ADL block above exactly.
 */
describe('Checklist item type category partition (COMMUNITY_MOBILITY_RISK_ITEM_TYPES / COMMUNITY_BEHAVIOUR_OF_CONCERN_ITEM_TYPES)', () => {
  it('together cover every ChecklistItemType member from CHECKLIST_ITEM_TYPES exactly once, with no omission', () => {
    const union = [...COMMUNITY_MOBILITY_RISK_ITEM_TYPES, ...COMMUNITY_BEHAVIOUR_OF_CONCERN_ITEM_TYPES].sort()
    expect(union).toEqual([...CHECKLIST_ITEM_TYPES].sort())
  })

  it('together cover every ChecklistItemType member from CHECKLIST_ITEM_TYPE_LABELS\' keys exactly once', () => {
    const union = [...COMMUNITY_MOBILITY_RISK_ITEM_TYPES, ...COMMUNITY_BEHAVIOUR_OF_CONCERN_ITEM_TYPES].sort()
    expect(union).toEqual(Object.keys(CHECKLIST_ITEM_TYPE_LABELS).sort())
  })

  it('do not overlap', () => {
    const mobility = new Set(COMMUNITY_MOBILITY_RISK_ITEM_TYPES)
    const overlap = COMMUNITY_BEHAVIOUR_OF_CONCERN_ITEM_TYPES.filter((t) => mobility.has(t))
    expect(overlap).toEqual([])
  })

  it('have no internal duplicates', () => {
    expect(new Set(COMMUNITY_MOBILITY_RISK_ITEM_TYPES).size).toBe(COMMUNITY_MOBILITY_RISK_ITEM_TYPES.length)
    expect(new Set(COMMUNITY_BEHAVIOUR_OF_CONCERN_ITEM_TYPES).size).toBe(COMMUNITY_BEHAVIOUR_OF_CONCERN_ITEM_TYPES.length)
  })

  it('getChecklistItemGroup agrees with group membership for every ChecklistItemType member', () => {
    for (const type of CHECKLIST_ITEM_TYPES) {
      const expected = (COMMUNITY_MOBILITY_RISK_ITEM_TYPES as readonly string[]).includes(type) ? 'CommunityMobilityRisk' : 'CommunityBehaviourOfConcern'
      expect(getChecklistItemGroup(type)).toBe(expected)
    }
  })
})

/**
 * PF-10.2, review-round polish — frontend counterpart to the backend's
 * CommunityAccessRiskItemTypeGroupsTests: ROAD_TRAFFIC_RISK_ITEM_TYPES,
 * BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES, and HEALTH_AND_PERSONAL_SAFETY_RISK_ITEM_TYPES must
 * together cover every CommunityAccessRiskItemType member exactly once (no omission, no overlap).
 * All three subsets are derived from COMMUNITY_ACCESS_RISK_ITEM_TYPES via slice(), so
 * coverage/no-overlap are structurally guaranteed here, but a future 23rd
 * CommunityAccessRiskItemType member landing in COMMUNITY_ACCESS_RISK_ITEM_TYPES without a
 * matching COMMUNITY_ACCESS_RISK_ITEM_TYPE_LABELS entry (the label map every consumer actually
 * renders from) would still slip through unnoticed without this cross-check — mirrors the
 * ADL/checklist blocks above exactly.
 */
describe('Community Access risk item type category partition (ROAD_TRAFFIC / BEHAVIOURS_OF_CONCERN / HEALTH_AND_PERSONAL_SAFETY)', () => {
  it('together cover every CommunityAccessRiskItemType member from COMMUNITY_ACCESS_RISK_ITEM_TYPES exactly once, with no omission', () => {
    const union = [...ROAD_TRAFFIC_RISK_ITEM_TYPES, ...BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES, ...HEALTH_AND_PERSONAL_SAFETY_RISK_ITEM_TYPES].sort()
    expect(union).toEqual([...COMMUNITY_ACCESS_RISK_ITEM_TYPES].sort())
  })

  it('together cover every CommunityAccessRiskItemType member from COMMUNITY_ACCESS_RISK_ITEM_TYPE_LABELS\' keys exactly once', () => {
    const union = [...ROAD_TRAFFIC_RISK_ITEM_TYPES, ...BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES, ...HEALTH_AND_PERSONAL_SAFETY_RISK_ITEM_TYPES].sort()
    expect(union).toEqual(Object.keys(COMMUNITY_ACCESS_RISK_ITEM_TYPE_LABELS).sort())
  })

  it('do not overlap', () => {
    const roadTraffic = new Set(ROAD_TRAFFIC_RISK_ITEM_TYPES)
    const boc = new Set(BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES)
    expect(BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES.filter((t) => roadTraffic.has(t))).toEqual([])
    expect(HEALTH_AND_PERSONAL_SAFETY_RISK_ITEM_TYPES.filter((t) => roadTraffic.has(t) || boc.has(t))).toEqual([])
  })

  it('have no internal duplicates', () => {
    expect(new Set(ROAD_TRAFFIC_RISK_ITEM_TYPES).size).toBe(ROAD_TRAFFIC_RISK_ITEM_TYPES.length)
    expect(new Set(BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES).size).toBe(BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES.length)
    expect(new Set(HEALTH_AND_PERSONAL_SAFETY_RISK_ITEM_TYPES).size).toBe(HEALTH_AND_PERSONAL_SAFETY_RISK_ITEM_TYPES.length)
  })

  it('is exactly 22 items total (5 Road & Traffic Safety + 8 Behaviours of Concern + 9 Health & Personal Safety)', () => {
    expect(COMMUNITY_ACCESS_RISK_ITEM_TYPES.length).toBe(22)
    expect(ROAD_TRAFFIC_RISK_ITEM_TYPES.length).toBe(5)
    expect(BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES.length).toBe(8)
    expect(HEALTH_AND_PERSONAL_SAFETY_RISK_ITEM_TYPES.length).toBe(9)
  })

  it('getCommunityAccessRiskItemCategory agrees with group membership for every CommunityAccessRiskItemType member', () => {
    for (const type of COMMUNITY_ACCESS_RISK_ITEM_TYPES) {
      const expected = (ROAD_TRAFFIC_RISK_ITEM_TYPES as readonly string[]).includes(type)
        ? 'RoadTraffic'
        : (BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES as readonly string[]).includes(type) ? 'BehavioursOfConcern' : 'HealthAndPersonalSafety'
      expect(getCommunityAccessRiskItemCategory(type)).toBe(expected)
    }
  })
})
