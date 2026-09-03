import { describe, it, expect } from 'vitest'
import { fieldsForEntry, sharedFieldsDisplayedOnProfile, DOCUMENT_MAPPING } from './documentMapping'
import { CAREGIVER_INTERNAL_FIELDS, caregiverEditableFields, caregiverReadOnlyFields } from './caregiverFields'

describe('caregiverFields', () => {
  it('every internal field id exists in the allocation contract (a renamed field cannot silently un-exclude)', () => {
    const known = new Set(DOCUMENT_MAPPING.map((e) => e.field))
    const missing = [...CAREGIVER_INTERNAL_FIELDS].filter((f) => !known.has(f))
    expect(missing).toEqual([])
  })

  it('every Profile-entry field is either editable-by-caregiver or internal — nothing unclassified', () => {
    const profile = fieldsForEntry('profile').map((e) => e.field)
    const editable = new Set(caregiverEditableFields().map((e) => e.field))
    const unclassified = profile.filter((f) => !editable.has(f) && !CAREGIVER_INTERNAL_FIELDS.has(f))
    expect(unclassified).toEqual([])
  })

  it('no editable field is internal', () => {
    for (const e of caregiverEditableFields()) expect(CAREGIVER_INTERNAL_FIELDS.has(e.field)).toBe(false)
  })

  it('read-only fields are exactly the shared intake fields shown on profile, minus internal', () => {
    const expected = sharedFieldsDisplayedOnProfile().filter((e) => !CAREGIVER_INTERNAL_FIELDS.has(e.field)).map((e) => e.field)
    expect(caregiverReadOnlyFields().map((e) => e.field)).toEqual(expected)
  })

  it('the known internal fields are excluded', () => {
    for (const f of ['behaviourRiskRating', 'preferredStaffId']) {
      expect(CAREGIVER_INTERNAL_FIELDS.has(f)).toBe(true)
      expect(caregiverEditableFields().some((e) => e.field === f)).toBe(false)
    }
  })
})
