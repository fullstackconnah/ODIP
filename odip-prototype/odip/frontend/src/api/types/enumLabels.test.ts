import { describe, it, expect } from 'vitest'
import { PLAN_TYPES, SUPPORT_RATIOS, PLAN_TYPE_LABELS, SUPPORT_RATIO_LABELS, POSITIONS, POSITION_LABELS, TASK_TYPES } from './enums'
import { TASK_TYPE_LABELS } from './tasks'

/** Landing-spotted: the participant page header printed "PlanManaged" and "TwoToOne", and the claim page "AgencyManaged". */
describe('plan type and support ratio labels', () => {
  it('has a label for every plan type, in words, the way the intake form spells them', () => {
    expect(Object.keys(PLAN_TYPE_LABELS).sort()).toEqual([...PLAN_TYPES].sort())
    expect(PLAN_TYPE_LABELS).toEqual({ SelfManaged: 'Self Managed', PlanManaged: 'Plan Managed', AgencyManaged: 'Agency Managed' })
  })

  it('has a label for every support ratio, as a ratio ("2:1") and never the raw enum name', () => {
    expect(Object.keys(SUPPORT_RATIO_LABELS).sort()).toEqual([...SUPPORT_RATIOS].sort())
    expect(SUPPORT_RATIO_LABELS.TwoToOne).toBe('2:1')
    expect(SUPPORT_RATIO_LABELS.OneToOne).toBe('1:1')
    expect(SUPPORT_RATIO_LABELS.SharedSupport).toBe('Shared Support')
    for (const ratio of SUPPORT_RATIOS) expect(SUPPORT_RATIO_LABELS[ratio], ratio).not.toMatch(/^[A-Z][a-z]+[A-Z]/)
  })
})

/** Platform review V2-B: the staff list printed "SupportWorker" and the task list "AccommodationConfirmation". */
describe('position and task type labels', () => {
  it('has a label in words for every position', () => {
    expect(Object.keys(POSITION_LABELS).sort()).toEqual([...POSITIONS].sort())
    expect(POSITION_LABELS.SupportWorker).toBe('Support worker')
    expect(POSITION_LABELS.SeniorSupportWorker).toBe('Senior support worker')
    for (const position of POSITIONS) expect(POSITION_LABELS[position], position).not.toMatch(/[a-z][A-Z]/)
  })

  it('has a label in words for every task type, the obligation-engine ones as before', () => {
    expect(Object.keys(TASK_TYPE_LABELS).sort()).toEqual([...TASK_TYPES].sort())
    expect(TASK_TYPE_LABELS.AccommodationConfirmation).toBe('Accommodation confirmation')
    expect(TASK_TYPE_LABELS.LeaveCoverage).toBe('Leave coverage')
    for (const type of TASK_TYPES) expect(TASK_TYPE_LABELS[type], type).not.toMatch(/[a-z][A-Z]/)
  })
})
