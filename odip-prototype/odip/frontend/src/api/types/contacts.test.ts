import { describe, it, expect } from 'vitest'
import { unionRelevantFields, CONTACT_ROLE_FIELD_MAP, planTypeComplianceWarning } from './contacts'

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

  it('PF-10.2: FinancialAdministrator has the same field set as Solicitor and renders in a multi-role union', () => {
    expect(CONTACT_ROLE_FIELD_MAP.FinancialAdministrator).toEqual(CONTACT_ROLE_FIELD_MAP.Solicitor)
    expect(unionRelevantFields(['FinancialAdministrator'])).toEqual(['organisationName', 'scopeNotes', 'authorisationDocumentReference'])
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

// PF-2 (SPEC-02) — re-homed from the retired create wizard's test suite by PF-10.7. That suite's
// "PF-2 plan-type compliance warning" describe block covered both an "edit mode — backend-computed
// value" path (obsolete: IntakeWizardPage.tsx, this rule's only remaining production consumer,
// deliberately always live-computes via this function regardless of create/edit mode — see
// NdisFundingStep.tsx's own "scope simplification vs. the retired single-step wizard" doc for the
// same kind of deliberate simplification) and a "create mode — live client-side computation" path,
// which is this exact pure function. Unit-tested here directly, at the function level, rather than
// re-driving the whole wizard UI to exercise it end-to-end.
describe('planTypeComplianceWarning', () => {
  const PLAN_MANAGER_WARNING = 'This plan-managed participant has no active Plan Manager contact recorded.'
  const AGENCY_WARNING = 'This agency-managed participant has no active registered-provider contact with agency details recorded.'

  it('SelfManaged never warns, regardless of contact roles', () => {
    expect(planTypeComplianceWarning('SelfManaged', [])).toBeNull()
    expect(planTypeComplianceWarning('SelfManaged', null)).toBeNull()
    expect(planTypeComplianceWarning('SelfManaged', [{ roleType: 'NextOfKin' }])).toBeNull()
  })

  it('PlanManaged with no PlanManager role warns', () => {
    expect(planTypeComplianceWarning('PlanManaged', [])).toBe(PLAN_MANAGER_WARNING)
    expect(planTypeComplianceWarning('PlanManaged', [{ roleType: 'NextOfKin' }])).toBe(PLAN_MANAGER_WARNING)
  })

  it('PlanManaged with an active PlanManager role (via roleType or roleTypes) clears the warning', () => {
    expect(planTypeComplianceWarning('PlanManaged', [{ roleType: 'PlanManager' }])).toBeNull()
    expect(planTypeComplianceWarning('PlanManaged', [{ roleTypes: ['NextOfKin', 'PlanManager'] }])).toBeNull()
  })

  it('PlanManaged with only an INACTIVE PlanManager role still warns', () => {
    expect(planTypeComplianceWarning('PlanManaged', [{ roleType: 'PlanManager', status: 'Inactive' }])).toBe(PLAN_MANAGER_WARNING)
  })

  it('a row with no explicit status is treated as Active (matches the create-mode field array, which has no status concept before submit)', () => {
    expect(planTypeComplianceWarning('PlanManaged', [{ roleType: 'PlanManager', status: undefined }])).toBeNull()
  })

  it('AgencyManaged with no registered-provider ProviderContact role warns', () => {
    expect(planTypeComplianceWarning('AgencyManaged', [])).toBe(AGENCY_WARNING)
    // A ProviderContact row without registeredProviderFlag=true does not satisfy the condition.
    expect(planTypeComplianceWarning('AgencyManaged', [{ roleType: 'ProviderContact' }])).toBe(AGENCY_WARNING)
    expect(planTypeComplianceWarning('AgencyManaged', [{ roleType: 'ProviderContact', registeredProviderFlag: false }])).toBe(AGENCY_WARNING)
  })

  it('AgencyManaged with an active registered-provider ProviderContact role clears the warning', () => {
    expect(planTypeComplianceWarning('AgencyManaged', [{ roleType: 'ProviderContact', registeredProviderFlag: true }])).toBeNull()
    expect(planTypeComplianceWarning('AgencyManaged', [{ roleTypes: ['ProviderContact'], registeredProviderFlag: true }])).toBeNull()
  })

  it('a PlanManager role never satisfies the AgencyManaged condition, and vice versa', () => {
    expect(planTypeComplianceWarning('AgencyManaged', [{ roleType: 'PlanManager' }])).toBe(AGENCY_WARNING)
    expect(planTypeComplianceWarning('PlanManaged', [{ roleType: 'ProviderContact', registeredProviderFlag: true }])).toBe(PLAN_MANAGER_WARNING)
  })

  it('null/undefined planType never warns', () => {
    expect(planTypeComplianceWarning(null, [])).toBeNull()
    expect(planTypeComplianceWarning(undefined, [])).toBeNull()
  })
})
