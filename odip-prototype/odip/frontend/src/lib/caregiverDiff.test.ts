import { describe, it, expect } from 'vitest'
import { computeCaregiverDiff } from './caregiverDiff'

describe('computeCaregiverDiff', () => {
  it('returns only changed scalar fields, with labels', () => {
    const rows = computeCaregiverDiff(
      { firstName: 'Sophie', personalInterests: 'Reading', phone: '0400' },
      { aboutMe: { personalInterests: 'Gardening' }, personalDetails: { firstName: 'Sophie', phone: '0400' } },
    )
    expect(rows).toEqual([{ field: 'personalInterests', label: expect.any(String), group: 'aboutMe', current: 'Reading', proposed: 'Gardening' }])
  })

  it('treats null/undefined/empty-string as equal', () => {
    expect(computeCaregiverDiff({ phone: null }, { personalDetails: { phone: '' } })).toEqual([])
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
      { healthConditions: [{ conditionType: 'Asthma', notes: 'stable' }] },
      { healthConditions: [{ conditionType: 'Asthma', notes: 'stable' }] },
    )
    expect(rows).toEqual([])
  })

  it('uses the real collection key properties (adlType, itemType)', () => {
    const adlRows = computeCaregiverDiff(
      { adlAssessments: [{ adlType: 'Bathing', level: 'Independent' }] },
      { adlAssessments: [{ adlType: 'Bathing', level: 'Assisted' }] },
    )
    expect(adlRows[0].field).toBe('adlAssessments.Bathing')

    const checklistRows = computeCaregiverDiff(
      { checklistItems: [{ itemType: 'Swimming', applicable: false }] },
      { checklistItems: [{ itemType: 'Swimming', applicable: true }] },
    )
    expect(checklistRows[0].field).toBe('checklistItems.Swimming')
  })
})
