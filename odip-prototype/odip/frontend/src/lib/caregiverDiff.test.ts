import { describe, it, expect } from 'vitest'
import { computeCaregiverDiff } from './caregiverDiff'

describe('computeCaregiverDiff', () => {
  it('returns only changed scalar fields, with labels', () => {
    const rows = computeCaregiverDiff(
      { firstName: 'Sophie', lastName: 'Brown', likesDislikes: 'Reading', phone: '0400' },
      { aboutMe: { likesDislikes: 'Gardening' }, personalDetails: { firstName: 'Sophie', lastName: 'Brown', phone: '0400' } },
    )
    expect(rows).toEqual([{ field: 'likesDislikes', label: expect.any(String), group: 'aboutMe', current: 'Reading', proposed: 'Gardening' }])
  })

  it('treats null/undefined/empty-string as equal', () => {
    expect(computeCaregiverDiff(
      { phone: null, firstName: 'Sophie', lastName: 'Brown' },
      { personalDetails: { firstName: 'Sophie', lastName: 'Brown', phone: '' } },
    )).toEqual([])
  })

  it('diffs collections by item type', () => {
    const rows = computeCaregiverDiff(
      { consents: [{ consentType: 'PhotoVideo', granted: false }] },
      { consents: [{ consentType: 'PhotoVideo', granted: true }] },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].field).toBe('consents.PhotoVideo')
  })

  it('returns [] for a null payload', () => {
    expect(computeCaregiverDiff({ a: 1 }, null)).toEqual([])
  })

  it('does not report a collection item unchanged when it matches the current row', () => {
    const rows = computeCaregiverDiff(
      { healthConditions: [{ conditionType: 'Asthma', has: true, notes: 'stable' }] },
      { healthConditions: [{ conditionType: 'Asthma', has: true, notes: 'stable' }] },
    )
    expect(rows).toEqual([])
  })

  it('uses the real collection key properties (adlType, itemType)', () => {
    const adlRows = computeCaregiverDiff(
      { adlAssessments: [{ adlType: 'Bathing', level: 'Independent' }] },
      { adlAssessments: [{ adlType: 'Bathing', level: 'Assistance' }] },
    )
    expect(adlRows[0].field).toBe('adlAssessments.Bathing')

    const checklistRows = computeCaregiverDiff(
      { checklistItems: [{ itemType: 'FallsRisk', value: 'No' }] },
      { checklistItems: [{ itemType: 'FallsRisk', value: 'Yes' }] },
    )
    expect(checklistRows[0].field).toBe('checklistItems.FallsRisk')
  })
})

describe('computeCaregiverDiff against the base the caregiver loaded', () => {
  const live = { firstName: 'Sophie', lastName: 'Brown', phone: '0400000002', likesDislikes: 'Reading' }
  const pd = (phone: string) => ({ firstName: 'Sophie', lastName: 'Brown', phone })

  it('lists only what the caregiver changed from the base, and flags a row staff changed since', () => {
    const rows = computeCaregiverDiff(
      live,
      { personalDetails: pd('0400000003'), aboutMe: { likesDislikes: 'Reading' } },
      { personalDetails: pd('0400000001'), aboutMe: { likesDislikes: 'Reading' } },
    )
    expect(rows).toEqual([expect.objectContaining({ field: 'phone', current: '0400000002', proposed: '0400000003', staffChanged: true })])
  })

  it('does not flag a row staff left alone', () => {
    const rows = computeCaregiverDiff(live, { personalDetails: pd('0400000003') }, { personalDetails: pd('0400000002') })
    expect(rows).toHaveLength(1)
    expect(rows[0].staffChanged).toBeFalsy()
  })

  it('compares a collection row column by column, so a live row with extra columns is not a change', () => {
    const rows = computeCaregiverDiff(
      { consents: [{ consentType: 'PhotoVideo', granted: true, signedByName: 'Staff', id: 'x1' }] },
      { consents: [{ consentType: 'PhotoVideo', granted: null }] },
      { consents: [{ consentType: 'PhotoVideo', granted: null }] },
    )
    expect(rows).toEqual([])
  })

  it('lists a collection row when a column differs from the base', () => {
    const rows = computeCaregiverDiff(
      { consents: [{ consentType: 'PhotoVideo', granted: true, id: 'x1' }] },
      { consents: [{ consentType: 'PhotoVideo', granted: false }] },
      { consents: [{ consentType: 'PhotoVideo', granted: null }] },
    )
    expect(rows).toEqual([expect.objectContaining({ field: 'consents.PhotoVideo', staffChanged: true })])
  })
})
