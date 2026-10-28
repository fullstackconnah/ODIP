import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderSettingsDto, SetupStatusDto } from '@/api/types'
import { isSetupHidden, organisationDetailsRecorded, setSetupHidden, setupCard } from './organisationSetup'

const provider = { organisationName: 'Synthetic Support', address: '1 Example Street', state: 'VIC' } as ProviderSettingsDto
const status: SetupStatusDto = { staffCount: 0, participantCount: 0, participantsWithPlanCount: 0, firstPublishedWeekStart: null, hasInvoice: false, employmentHeroAvailable: true }
const settled = { waiting: false, failed: false }

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('organisationDetailsRecorded', () => {
  it('is true only with a name, an address and a valid state', () => {
    expect(organisationDetailsRecorded(provider)).toBe(true)
    expect(organisationDetailsRecorded({ ...provider, organisationName: ' ' })).toBe(false)
    expect(organisationDetailsRecorded({ ...provider, address: '' })).toBe(false)
    expect(organisationDetailsRecorded({ ...provider, state: 'Qld' })).toBe(false)
    expect(organisationDetailsRecorded(null)).toBe(false)
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
