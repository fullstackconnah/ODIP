import { describe, expect, it } from 'vitest'
import { requirementLabels } from './workerRequirements'

describe('requirementLabels', () => {
  it('says what a block asks of a worker in the words the plan builder uses, in a fixed order', () => {
    expect(requirementLabels({ workerGender: 'Female', driver: true, skills: ['FirstAid', 'MedicationCompetent', 'ManualHandling'] }))
      .toEqual(['Female worker', 'Driver', 'First aid', 'Medication competent', 'Manual handling'])
    expect(requirementLabels({ workerGender: 'Male', driver: false, skills: ['ManualHandling'] })).toEqual(['Male worker', 'Manual handling'])
  })

  it('says nothing for no preference, no driver and no skills, and for requirements that are missing', () => {
    expect(requirementLabels({ workerGender: 'NoPreference', driver: false, skills: [] })).toEqual([])
    expect(requirementLabels(undefined)).toEqual([])
    expect(requirementLabels(null)).toEqual([])
  })

  it('shows a skill it does not know as it came, never hides it', () => {
    expect(requirementLabels({ workerGender: 'NoPreference', driver: false, skills: ['FirstAid', 'SwimmingInstructor' as never] })).toEqual(['First aid', 'SwimmingInstructor'])
  })
})
