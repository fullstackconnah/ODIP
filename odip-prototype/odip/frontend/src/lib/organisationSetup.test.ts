import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderSettingsDto, SetupStatusDto } from '@/api/types'
import { isSetupHidden, isValidAbn, organisationDetailsHint, organisationDetailsRecorded, setSetupHidden, setupCard } from './organisationSetup'

const provider = { organisationName: 'Synthetic Support', address: '1 Example Street', state: 'VIC', abn: '51824753556', registrationNumber: '' } as ProviderSettingsDto
const status: SetupStatusDto = { staffCount: 0, participantCount: 0, participantsWithPlanCount: 0, firstPublishedWeekStart: null, hasInvoice: false, employmentHeroAvailable: true }
const settled = { waiting: false, failed: false }

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('isValidAbn', () => {
  it.each([['51824753556', true], ['51 824 753 556', true], ['51\t824\t753\t556', true], ['51 824 753 556', true], [' \t51 824 753 556 ', true], ['51-824-753-556', false], ['51824753557', false], ['5182475355', false], ['518247535560', false], ['5182475355a', false], ['', false], [undefined, false], [null, false]])('%s -> %s', (abn, ok) => {
    expect(isValidAbn(abn)).toBe(ok)
  })
})

describe('organisationDetailsHint', () => {
  it('asks for a blank ABN, asks to check an invalid one, and is silent for a valid one', () => {
    expect(organisationDetailsHint({ ...provider, abn: ' ' })).toBe('Add your ABN to finish this step.')
    expect(organisationDetailsHint({ ...provider, abn: '12345' })).toBe('Check your ABN to finish this step.')
    expect(organisationDetailsHint(provider)).toBeNull()
    expect(organisationDetailsHint(null)).toBe('Add your ABN to finish this step.')
  })
})

describe('organisationDetailsRecorded', () => {
  it('is true only with a name, an address, a valid state and a valid ABN', () => {
    expect(organisationDetailsRecorded(provider)).toBe(true)
    expect(organisationDetailsRecorded({ ...provider, organisationName: ' ' })).toBe(false)
    expect(organisationDetailsRecorded({ ...provider, address: '' })).toBe(false)
    expect(organisationDetailsRecorded({ ...provider, state: 'Qld' })).toBe(false)
    expect(organisationDetailsRecorded(null)).toBe(false)
  })

  it('needs a valid ABN: blank or invalid is not done, a spaced valid one is', () => {
    expect(organisationDetailsRecorded({ ...provider, abn: '' })).toBe(false)
    expect(organisationDetailsRecorded({ ...provider, abn: '51824753557' })).toBe(false)
    expect(organisationDetailsRecorded({ ...provider, abn: '51 824 753 556' })).toBe(true)
  })

  it('ignores a blank registration number', () => {
    expect(organisationDetailsRecorded({ ...provider, registrationNumber: '' })).toBe(true)
    expect(organisationDetailsRecorded({ ...provider, registrationNumber: 'PR001' })).toBe(true)
  })
})

describe('setupCard', () => {
  it('waits, then hides on failure', () => {
    expect(setupCard(undefined, { waiting: true, failed: false }, '2026-11-04')).toBe('waiting')
    expect(setupCard(status, { waiting: false, failed: true }, '2026-11-04')).toBe('none')
  })
  it('shows the steps until a week is published, even when every count is above zero', () => {
    const counted = { ...status, staffCount: 20, participantCount: 40, participantsWithPlanCount: 40, hasInvoice: true }
    expect(setupCard(counted, settled, '2026-11-04')).toBe('steps')
  })
  it('shows the done card through the end of the published week, then nothing', () => {
    const published = { ...status, firstPublishedWeekStart: '2026-11-02' }
    expect(setupCard(published, settled, '2026-11-08')).toBe('done')
    expect(setupCard(published, settled, '2026-11-09')).toBe('none')
  })
  it('never goes back to the steps once published, even if the counts later drop', () => {
    expect(setupCard({ ...status, firstPublishedWeekStart: '2026-11-02' }, settled, '2026-11-04')).toBe('done')
    expect(setupCard({ ...status, firstPublishedWeekStart: '2026-09-02' }, settled, '2026-11-04')).toBe('none')
  })
})

describe('the hide flag', () => {
  it('is kept per organisation, a viewing SuperAdmin taking precedence over the signed-in user', () => {
    localStorage.setItem('odip_user', JSON.stringify({ tenantId: 'own-org' }))
    sessionStorage.setItem('odip_viewing_tenant', 'viewed-org')
    setSetupHidden(true)
    expect(localStorage.getItem('bunya-setup-hidden:viewed-org')).toBe('1')
    expect(isSetupHidden()).toBe(true)
    setSetupHidden(false)
    expect(localStorage.getItem('bunya-setup-hidden:viewed-org')).toBeNull()
    expect(isSetupHidden()).toBe(false)
  })
  it('falls back to the user organisation', () => {
    localStorage.setItem('odip_user', JSON.stringify({ tenantId: 'own-org' }))
    setSetupHidden(true)
    expect(localStorage.getItem('bunya-setup-hidden:own-org')).toBe('1')
  })
  it('shows the card, and never throws, when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(isSetupHidden()).toBe(false)
    expect(() => setSetupHidden(true)).not.toThrow()
  })
})
