import { describe, it, expect } from 'vitest'
import { hydrateFormFromProjection } from './hydrate'
import type { CaregiverFormDto } from '@/api/types/caregiver'
import { PROFILE_STEP_SCHEMAS_BY_KEY, type ParticipantFormData } from '@/lib/participantSchema'
import { buildProfileStepPatch } from '@/lib/participantPatchGroups'
import projection from '@/test/fixtures/golden/caregiver-projection.json'

function makeDto(overrides: Partial<CaregiverFormDto> = {}): CaregiverFormDto {
  return {
    status: 'Draft',
    caregiverName: null,
    caregiverRelationship: null,
    expiresAt: '2026-09-17T00:00:00Z',
    rejectionNote: null,
    current: {},
    editable: [],
    draft: null,
    ...overrides,
  }
}

describe('hydrateFormFromProjection', () => {
  it('when no draft exists, uses the projection values (plus the caregiver identity fields)', () => {
    const dto = makeDto({ current: { firstName: 'Sophie', personalInterests: 'Reading' }, caregiverName: 'Jane', caregiverRelationship: 'Mother' })
    const result = hydrateFormFromProjection(dto)
    expect(result).toMatchObject({ firstName: 'Sophie', personalInterests: 'Reading', caregiverName: 'Jane', caregiverRelationship: 'Mother' })
  })

  it('when a draft exists, its scalar group values override the projection and its collections replace the projection ones', () => {
    const dto = makeDto({
      current: { firstName: 'Sophie', personalInterests: 'Reading', consents: [{ consentType: 'PhotoVideo', granted: false }] },
      draft: {
        aboutMe: { goals: 'Learn to swim' } as never,
        personalDetails: { firstName: 'Sophie', lastName: 'Rivers' } as never,
        consents: [{ consentType: 'PhotoVideo', granted: true, signedByName: null, signedDate: null }],
      },
    })
    const result = hydrateFormFromProjection(dto)
    expect(result.goals).toBe('Learn to swim')
    expect(result.firstName).toBe('Sophie')
    expect(result.lastName).toBe('Rivers')
    expect(result.consents).toEqual([{ consentType: 'PhotoVideo', granted: 'true', signedByName: undefined, signedDate: undefined }])
  })
})

// The API sends null for a blank text answer and true/false for a yes/no answer; the wizard's step
// checks take text and the strings 'true'/'false', and its step patches turn anything else into null.
describe('hydrateFormFromProjection with the API\'s raw null and boolean values', () => {
  const STEPS = ['keyIdentifiers', 'culturalDepth', 'medical', 'mobility', 'behaviourCognition', 'dailyLiving']
  const current = {
    pensionCardNumber: null, medicareNumber: '2123 45670 1',
    memoryAids: true, impairedUnderstanding: false, isCald: null,
    hidpaSupportCategories: 'DysphagiaManagement, EpilepsyManagement',   // a flags enum arrives as one comma-separated string
    consents: [{ consentType: 'PhotoVideo', granted: true, signedByName: null, signedDate: null }],
    healthConditions: [{ conditionType: 'Epilepsy', has: true, severity: null, planProvided: false, trainingRequired: null, notes: null }],
  }

  it('gives values that every caregiver step check accepts', () => {
    const values = hydrateFormFromProjection(makeDto({ current }))
    for (const step of STEPS) expect(PROFILE_STEP_SCHEMAS_BY_KEY[step].safeParse(values).success, step).toBe(true)
  })

  it('keeps the recorded yes/no answers when the steps build their patch', () => {
    const values = hydrateFormFromProjection(makeDto({ current })) as ParticipantFormData
    expect(buildProfileStepPatch('behaviourCognition', values, false)).toMatchObject({ behaviourCommunication: { memoryAids: true, impairedUnderstanding: false, bocChartProvided: null } })
    expect(buildProfileStepPatch('culturalDepth', values, false)?.consents).toEqual([expect.objectContaining({ consentType: 'PhotoVideo', granted: true })])
    expect(buildProfileStepPatch('medical', values, false)?.medical).toMatchObject({ hidpaSupportCategories: 'DysphagiaManagement, EpilepsyManagement' })
    expect(buildProfileStepPatch('medical', values, false)?.healthConditions).toEqual([expect.objectContaining({ conditionType: 'Epilepsy', has: true, planProvided: false })])
  })

  it('does the same for the answers in a saved draft, which the draft overrides', () => {
    const draft = { behaviourCommunication: { memoryAids: false, ridsLogged: true } } as never
    const values = hydrateFormFromProjection(makeDto({ current, draft })) as ParticipantFormData
    expect(buildProfileStepPatch('behaviourCognition', values, false)).toMatchObject({ behaviourCommunication: { memoryAids: false, impairedUnderstanding: false, ridsLogged: true } })
  })
})

// The projection the API really sends, written by CaregiverFieldPolicy.BuildProjection (CaregiverProjectionFixtureTests keeps the file true): null for a blank text, true/false for a yes/no answer,
// every enum by name, every fixed list in full. The hand-made `current` above holds what its author believed the API sends; this is what the page opens with.
describe('hydrateFormFromProjection on the projection the API really sends', () => {
  const STEPS = ['keyIdentifiers', 'culturalDepth', 'medical', 'mobility', 'behaviourCognition', 'dailyLiving']
  const recorded = projection as Record<string, unknown>
  const hydrated = () => hydrateFormFromProjection(makeDto({ current: recorded })) as ParticipantFormData

  it('hydrates without throwing and every caregiver step check accepts the values', () => {
    const values = hydrated()
    for (const step of STEPS) expect(PROFILE_STEP_SCHEMAS_BY_KEY[step].safeParse(values).success, step).toBe(true)
  })

  it('builds the patch of every step without throwing', () => {
    const values = hydrated()
    for (const step of STEPS) expect(() => buildProfileStepPatch(step, values, true), step).not.toThrow()
  })

  it('sends every recorded value back unchanged in the patches', () => {
    const values = hydrated()
    const sentBack: string[] = []
    for (const step of STEPS) {
      for (const [group, sent] of Object.entries(buildProfileStepPatch(step, values, true) ?? {})) {
        if (Array.isArray(sent)) {
          // The fixed lists: each row, found by its key, keeps every value it was recorded with.
          const [list, key] = [recorded[group] as Record<string, unknown>[], Object.keys(sent[0] as object)[0]]
          for (const row of sent as Record<string, unknown>[]) {
            const was = list.find((r) => r[key] === row[key])
            for (const [field, value] of Object.entries(row)) if (was?.[field] != null) expect(value, `${group}[${String(row[key])}].${field}`).toEqual(was[field])
          }
          continue
        }
        for (const [field, value] of Object.entries(sent as Record<string, unknown>)) {
          if (recorded[field] == null) continue
          expect(value, `${step}.${group}.${field}`).toEqual(recorded[field])
          sentBack.push(field)
        }
      }
    }
    // Not vacuous: the answers the review cared about are among what was compared.
    expect(sentBack).toEqual(expect.arrayContaining(['hidpaSupportCategories', 'ambulantStatus', 'memoryAids', 'isCald', 'medicareNumber']))
  })
})
