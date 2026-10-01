import { describe, expect, it } from 'vitest'
import { CREDENTIALS, credentialIssueCount, staffCredentials, type CredentialSource } from './credentials'

const TODAY = new Date(2026, 9, 1, 3, 40) // 1 Oct 2026: local parts, so the local day is the 1st in any zone
const OPTS = { warnDays: 30, today: TODAY }
const keys = (staff: CredentialSource) => staffCredentials(staff, OPTS).map(c => c.key)

describe('staffCredentials: which credentials apply', () => {
  it('lists none for a staff member with no flags and no dates', () => {
    expect(staffCredentials({}, OPTS)).toEqual([])
  })

  it('applies a flagged credential whether or not it has a date', () => {
    expect(keys({ isFirstAidQualified: true })).toEqual(['firstAid'])
    expect(keys({ isDriverEligible: true, driverLicenceExpiryDate: '2027-01-01' })).toEqual(['driver'])
    expect(keys({ isManualHandlingCompetent: true })).toEqual(['manualHandling'])
    expect(keys({ isMedicationCompetent: true })).toEqual(['medication'])
  })

  it('does not apply an unflagged credential, even when it carries a date', () => {
    expect(keys({ isFirstAidQualified: false, firstAidExpiryDate: '2020-01-01', driverLicenceExpiryDate: '2020-01-01' })).toEqual([])
  })

  // The one worker-screening rule (the Qualifications list's): it applies only once an expiry date exists.
  it.each<[string, CredentialSource & { workerScreeningNumber?: string | null }, boolean]>([
    ['a date only', { workerScreeningExpiryDate: '2027-01-01' }, true],
    ['a number and a date', { workerScreeningNumber: 'WWC-1', workerScreeningExpiryDate: '2027-01-01' }, true],
    ['a past date', { workerScreeningExpiryDate: '2020-01-01' }, true],
    ['a number and no date', { workerScreeningNumber: 'WWC-1', workerScreeningExpiryDate: null }, false],
    ['a number and an empty date', { workerScreeningNumber: 'WWC-1', workerScreeningExpiryDate: '' }, false],
    ['neither', {}, false],
  ])('worker screening with %s: applies = %s', (_name, staff, applies) => {
    expect(keys(staff).includes('workerScreening')).toBe(applies)
  })

  it('returns the credentials in the order of CREDENTIALS, each with the field an edit writes back', () => {
    const all = staffCredentials({
      isFirstAidQualified: true, isDriverEligible: true, isManualHandlingCompetent: true, isMedicationCompetent: true, workerScreeningExpiryDate: '2027-01-01',
    }, OPTS)
    expect(all.map(c => c.key)).toEqual(CREDENTIALS.map(c => c.key))
    expect(all.map(c => c.field)).toEqual(['firstAidExpiryDate', 'driverLicenceExpiryDate', 'manualHandlingExpiryDate', 'medicationCompetencyExpiryDate', 'workerScreeningExpiryDate'])
    expect(all.map(c => c.label)).toEqual(['First Aid', 'Driver Licence', 'Manual Handling', 'Medication Competency', 'Worker Screening'])
  })
})

describe('staffCredentials: state', () => {
  const staff: CredentialSource = {
    isFirstAidQualified: true, firstAidExpiryDate: '2026-08-22',
    isDriverEligible: true, driverLicenceExpiryDate: '2026-10-01',
    isManualHandlingCompetent: true, manualHandlingExpiryDate: '2026-10-11',
    isMedicationCompetent: true, medicationCompetencyExpiryDate: null,
    workerScreeningExpiryDate: '2027-10-01',
  }

  it('gives each credential its deadline state', () => {
    expect(staffCredentials(staff, OPTS).map(c => [c.key, c.state.status, c.state.days])).toEqual([
      ['firstAid', 'overdue', -40],
      ['driver', 'today', 0],
      ['manualHandling', 'soon', 10],
      ['medication', 'none', null],
      ['workerScreening', 'ok', 365],
    ])
  })

  it('uses the warning window it is given', () => {
    const narrow = staffCredentials(staff, { warnDays: 5, today: TODAY }).find(c => c.key === 'manualHandling')
    expect(narrow?.state.status).toBe('ok')
  })

  it('normalises a missing or empty date to null', () => {
    const c = staffCredentials({ isMedicationCompetent: true, medicationCompetencyExpiryDate: '' }, OPTS)[0]
    expect(c.expiryDate).toBeNull()
    expect(c.state.status).toBe('none')
  })
})

describe('credentialIssueCount', () => {
  it('counts every credential that needs action: expired, today, soon and no date; not current ones', () => {
    const staff: CredentialSource = {
      isFirstAidQualified: true, firstAidExpiryDate: '2026-08-22', // expired
      isDriverEligible: true, driverLicenceExpiryDate: '2026-10-01', // today
      isManualHandlingCompetent: true, manualHandlingExpiryDate: '2026-10-31', // soon (day 30)
      isMedicationCompetent: true, medicationCompetencyExpiryDate: null, // no date
      workerScreeningExpiryDate: '2026-11-01', // current (day 31)
    }
    expect(credentialIssueCount(staffCredentials(staff, OPTS))).toBe(4)
  })

  it('is 0 when everything is current or does not apply', () => {
    expect(credentialIssueCount(staffCredentials({ isFirstAidQualified: true, firstAidExpiryDate: '2030-01-01' }, OPTS))).toBe(0)
    expect(credentialIssueCount([])).toBe(0)
  })

  it('is the same figure the Qualifications list and the Dashboard read, because both build it from staffCredentials', () => {
    const people: CredentialSource[] = [
      { isFirstAidQualified: true, firstAidExpiryDate: '2026-08-22', workerScreeningExpiryDate: '2026-09-21' },
      { isMedicationCompetent: true },
      { isDriverEligible: true, driverLicenceExpiryDate: '2030-01-01' },
    ]
    const perPerson = people.map(p => credentialIssueCount(staffCredentials(p, OPTS)))
    expect(perPerson).toEqual([2, 1, 0])
    expect(perPerson.reduce((a, b) => a + b, 0)).toBe(3)
  })
})
