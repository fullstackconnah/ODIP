import { describe, expect, it } from 'vitest'
import { toUpdateStaffDto, type StaffListDto } from './staff'

// UpdateStaff is a full-replace PUT built from the list row by two pages (the qualifications page and the staff list's status change), about 20 fields each:
// a field added to the type and not to both copies would be erased by the next status click.

const row: StaffListDto = {
  id: 's1', firstName: 'Alex', lastName: 'Rivera', fullName: 'Alex Rivera', username: 'arivera', role: 'SupportWorker', position: 'SupportWorker',
  email: 'alex@example.com', mobile: null, region: 'North', isDriverEligible: true, isFirstAidQualified: true, isMedicationCompetent: false,
  isManualHandlingCompetent: true, isOvernightEligible: false, isActive: true, firstAidExpiryDate: '2027-01-31', driverLicenceExpiryDate: null,
  manualHandlingExpiryDate: '2027-02-28', medicationCompetencyExpiryDate: null, workerScreeningNumber: 'WS-1', workerScreeningExpiryDate: '2028-03-01',
  hasExpiredQualifications: false, notes: null,
}

describe('toUpdateStaffDto', () => {
  it('carries every editable field of the row, with the patch applied', () => {
    expect(toUpdateStaffDto(row, { isActive: false })).toEqual({
      firstName: 'Alex', lastName: 'Rivera', role: 'SupportWorker', position: 'SupportWorker', email: 'alex@example.com', region: 'North',
      isDriverEligible: true, isFirstAidQualified: true, isMedicationCompetent: false, isManualHandlingCompetent: true, isOvernightEligible: false,
      isActive: false, firstAidExpiryDate: '2027-01-31', manualHandlingExpiryDate: '2027-02-28', workerScreeningNumber: 'WS-1',
      workerScreeningExpiryDate: '2028-03-01',
    })
  })

  it('leaves out the list-only fields, sends nothing for what is empty on the row, and keeps an email the row lacks as an empty string', () => {
    const dto = toUpdateStaffDto({ ...row, email: null }, { firstAidExpiryDate: undefined })

    expect(dto.email).toBe('')
    expect(dto.firstAidExpiryDate).toBeUndefined()
    expect(dto.mobile).toBeUndefined()
    expect(dto.notes).toBeUndefined()
    for (const key of ['id', 'fullName', 'username', 'hasExpiredQualifications']) expect(dto).not.toHaveProperty(key)
  })
})
