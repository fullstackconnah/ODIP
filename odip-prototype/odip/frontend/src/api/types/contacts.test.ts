import { describe, it, expect } from 'vitest'
import { unionRelevantFields, CONTACT_ROLE_FIELD_MAP } from './contacts'

/**
 * PF-5 (SPEC-02): unionRelevantFields dedups CONTACT_ROLE_FIELD_MAP entries across a multi-role
 * selection — a pure function, tested here in isolation per the spec's Implementation §5.
 */
describe('unionRelevantFields', () => {
  it('returns a single role\'s own field list unchanged when only one role is selected', () => {
    expect(unionRelevantFields(['Guardian'])).toEqual(CONTACT_ROLE_FIELD_MAP.Guardian)
  })

  it('returns an empty array for a role with no role-specific fields (e.g. NextOfKin)', () => {
    expect(unionRelevantFields(['NextOfKin'])).toEqual([])
  })

  it('returns an empty array for an empty selection', () => {
    expect(unionRelevantFields([])).toEqual([])
  })

  it('dedupes a field shared by two selected roles (e.g. organisationName) to a single entry', () => {
    // PlanManager: ['organisationName', 'startDate', 'endDate']; Specialist: ['discipline',
    // 'organisationName', 'frequencyOfContact'] — organisationName appears in both.
    const union = unionRelevantFields(['PlanManager', 'Specialist'])
    expect(union.filter(f => f === 'organisationName')).toHaveLength(1)
  })

  it('preserves first-seen order: the first role\'s fields, then the second role\'s new fields', () => {
    const union = unionRelevantFields(['PlanManager', 'Specialist'])
    expect(union).toEqual(['organisationName', 'startDate', 'endDate', 'discipline', 'frequencyOfContact'])
  })

  it('unions three roles with partial overlap into the full deduplicated field set', () => {
    // Guardian: appointingTribunal/orderScopeDomains/orderStartDate/orderReviewDate/orderEndDate
    // PlanManager: organisationName/startDate/endDate
    // ProviderContact: organisationName/roleTitle/registeredProviderFlag/registrationNumber
    const union = unionRelevantFields(['Guardian', 'PlanManager', 'ProviderContact'])
    expect(union).toEqual([
      'appointingTribunal', 'orderScopeDomains', 'orderStartDate', 'orderReviewDate', 'orderEndDate',
      'organisationName', 'startDate', 'endDate',
      'roleTitle', 'registeredProviderFlag', 'registrationNumber',
    ])
  })
})
