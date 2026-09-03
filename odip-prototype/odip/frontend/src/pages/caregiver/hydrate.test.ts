import { describe, it, expect } from 'vitest'
import { hydrateFormFromProjection } from './hydrate'
import type { CaregiverFormDto } from '@/api/types/caregiver'

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
    expect(result.consents).toEqual([{ consentType: 'PhotoVideo', granted: true, signedByName: null, signedDate: null }])
  })
})
