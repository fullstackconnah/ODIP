import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePermissions, type UserRole } from '@/lib/permissions'
import { SETTINGS_PERMS } from '@/test/fixtures/settingsPermissions'
import { LEGACY_TAB, notSavedText, requestedSection, shownSection, visibleSections, type SectionKey, type SettingsPerms } from './settingsSections'

/** The real usePermissions() for a role signed in the way the app does it (odip_user; odip_viewing_tenant while a SuperAdmin views an organisation). */
function permsOf(role: UserRole, viewingTenant?: string) {
  localStorage.clear(); sessionStorage.clear()
  localStorage.setItem('odip_user', JSON.stringify({ role }))
  if (viewingTenant) sessionStorage.setItem('odip_viewing_tenant', viewingTenant)
  return { ...renderHook(() => usePermissions()).result.current, microsoftSignIn: false, viewingAs: false }
}

afterEach(() => localStorage.clear())

const ROLES = {
  Admin: () => permsOf('Admin'),
  Coordinator: () => permsOf('Coordinator'),
  SuperAdmin: () => permsOf('SuperAdmin', 'tenant-1'),
  SuperAdminNoOrg: () => permsOf('SuperAdmin'),
}
type RoleCase = keyof typeof ROLES
const ROLE_CASES = Object.keys(ROLES) as RoleCase[]
const keysOf = (role: RoleCase) => visibleSections(ROLES[role]()).map(s => s.key)
const groupsOf = (role: RoleCase) => [...new Set(visibleSections(ROLES[role]()).map(s => s.group))]

describe('who sees which section', () => {
  it('gives each role its sections in rail order', () => {
    expect(keysOf('Admin')).toEqual(['profile', 'notifications', 'appearance', 'setup', 'workspace-visibility', 'organisation', 'billing', 'safety', 'alerts', 'security', 'pricing', 'budgets', 'templates', 'activities', 'holidays', 'import', 'export', 'integrations', 'failed-sends'])
    expect(keysOf('Coordinator')).toEqual(['profile', 'notifications', 'appearance', 'organisation', 'billing', 'safety', 'alerts', 'security', 'templates', 'activities', 'holidays'])
    expect(keysOf('SuperAdmin')).toEqual(['profile', 'notifications', 'appearance', 'setup', 'workspace-visibility', 'organisation', 'billing', 'safety', 'alerts', 'security', 'pricing', 'budgets', 'templates', 'activities', 'import', 'export', 'integrations', 'tenants', 'users', 'catalogue', 'holidays', 'failed-sends', 'alpha-signups', 'whats-new'])
    expect(keysOf('SuperAdminNoOrg')).toEqual(['profile', 'notifications', 'appearance', 'tenants', 'users', 'catalogue', 'holidays', 'failed-sends', 'alpha-signups', 'whats-new'])
  })

  it("shows Alpha sign-ups and What's new to a SuperAdmin only, What's new last in Platform", () => {
    expect(keysOf('Admin')).not.toContain('alpha-signups')
    expect(keysOf('Admin')).not.toContain('whats-new')
    const platform = visibleSections(ROLES.SuperAdmin()).filter(s => s.group === 'Platform')
    expect(platform.at(-1)?.key).toBe('whats-new')
  })

  it('groups them, with My account first for everyone and only My account and Platform for a SuperAdmin with no organisation', () => {
    expect(groupsOf('Admin')).toEqual(['My account', 'Organisation', 'Pricing and budgets', 'Content', 'Data'])
    expect(groupsOf('Coordinator')).toEqual(['My account', 'Organisation', 'Content'])
    expect(groupsOf('SuperAdmin')).toEqual(['My account', 'Organisation', 'Pricing and budgets', 'Content', 'Data', 'Platform'])
    expect(groupsOf('SuperAdminNoOrg')).toEqual(['My account', 'Platform'])
  })

  it('never lists a key twice for one role (Public holidays and Failed sends each have one home per role)', () => {
    for (const role of ROLE_CASES) expect(new Set(keysOf(role)).size, role).toBe(keysOf(role).length)
  })

  it('locks the Organisation sections for a Coordinator, and only for a Coordinator', () => {
    const locked = (role: RoleCase) => visibleSections(ROLES[role]()).filter(s => s.readOnly?.(ROLES[role]())).map(s => s.key)
    expect(locked('Coordinator')).toEqual(['organisation', 'billing', 'safety', 'alerts', 'security'])
    expect(locked('Admin')).toEqual([])
    expect(locked('SuperAdmin')).toEqual([])
  })
})

// Old ?tab= key → where each role lands at md and up. 'profile' is the fallback for a key the role can't see (below md it is the list).
// Columns: Admin, Coordinator, SuperAdmin viewing an organisation, SuperAdmin with none. 14 keys from main plus export, integrations and
// retention (retention has no section yet; ?tab=integrations is baked into sent emails).
const LEGACY: [string, SectionKey, SectionKey, SectionKey, SectionKey][] = [
  ['templates', 'templates', 'templates', 'templates', 'profile'],
  ['activities', 'activities', 'activities', 'activities', 'profile'],
  ['qualifications', 'alerts', 'alerts', 'alerts', 'profile'],
  ['appearance', 'appearance', 'appearance', 'appearance', 'appearance'],
  ['provider', 'organisation', 'organisation', 'organisation', 'profile'],
  ['import', 'import', 'profile', 'import', 'profile'],
  ['pricing', 'pricing', 'profile', 'pricing', 'profile'],
  ['budgets', 'budgets', 'profile', 'budgets', 'profile'],
  ['catalogue', 'profile', 'profile', 'catalogue', 'catalogue'],
  ['holidays', 'holidays', 'holidays', 'holidays', 'holidays'],
  ['tenants', 'profile', 'profile', 'tenants', 'tenants'],
  ['users', 'profile', 'profile', 'users', 'users'],
  ['notifications', 'notifications', 'notifications', 'notifications', 'notifications'],
  ['notifications-admin', 'failed-sends', 'profile', 'failed-sends', 'failed-sends'],
  ['export', 'export', 'profile', 'export', 'profile'],
  ['integrations', 'integrations', 'profile', 'integrations', 'profile'],
  ['retention', 'profile', 'profile', 'profile', 'profile'],
]

describe('every legacy ?tab= key, for every role that opens Settings (the plan builder and sent emails rely on them)', () => {
  it.each(LEGACY)('?tab=%s lands on: Admin %s, Coordinator %s, SuperAdmin %s, SuperAdmin with no organisation %s', (tab, ...expected) => {
    const params = new URLSearchParams({ tab })
    expect(ROLE_CASES.map(role => shownSection(params, visibleSections(ROLES[role]()), false)?.key)).toEqual(expected)
  })

  it('maps exactly the three renamed keys; every other old key is its own section key', () => {
    expect(LEGACY_TAB).toEqual({ provider: 'organisation', qualifications: 'alerts', 'notifications-admin': 'failed-sends' })
  })

  it('opens the list below md, not Profile, when the role cannot see the key', () => {
    expect(shownSection(new URLSearchParams({ tab: 'pricing' }), visibleSections(ROLES.Coordinator()), true)).toBeNull()
    expect(shownSection(new URLSearchParams(), visibleSections(ROLES.Admin()), true)).toBeNull()
    expect(shownSection(new URLSearchParams(), visibleSections(ROLES.Admin()), false)?.key).toBe('profile')
  })

  it('lets ?section= win over ?tab=, and does not map a legacy key given as ?section=', () => {
    const admin = visibleSections(ROLES.Admin())
    expect(requestedSection(new URLSearchParams('section=budgets&tab=pricing'), admin)?.key).toBe('budgets')
    expect(requestedSection(new URLSearchParams('section=provider'), admin)).toBeNull()
    expect(requestedSection(new URLSearchParams('section=nonsense'), admin)).toBeNull()
  })
})

describe('Microsoft sign-in section', () => {
  const keys = (role: RoleCase, microsoftSignIn: boolean, viewingAs = false) => visibleSections({ ...ROLES[role](), microsoftSignIn, viewingAs }).map(s => s.key)

  it('is visible to an Admin with an organisation when the flag is on, and to no SuperAdmin, Coordinator or flag-off Admin', () => {
    expect(keys('Admin', true)).toContain('microsoft')
    expect(keys('Admin', true).indexOf('microsoft')).toBe(keys('Admin', true).indexOf('organisation') + 1)
    expect(keys('Admin', false)).not.toContain('microsoft')
    for (const role of ['Coordinator', 'SuperAdmin', 'SuperAdminNoOrg'] as const) expect(keys(role, true), role).not.toContain('microsoft')
  })

  // A SuperAdmin viewing as an Admin carries that Admin's role in the browser, but the server still sees a SuperAdmin and refuses every Microsoft endpoint.
  it('is hidden while a SuperAdmin views as someone', () => {
    expect(keys('Admin', true, true)).not.toContain('microsoft')
  })
})

describe('the permissions fixture other Settings tests mock with', () => {
  const FLAGS = ['isAdmin', 'isCoordinator', 'isSuperAdmin', 'hasOrganisation', 'canEditProviderSettings', 'canImportData', 'showBankDetails', 'canManageNotifications', 'canManageIntegrations'] as const
  const pick = (p: SettingsPerms & { showBankDetails: boolean; canManageNotifications: boolean }) => Object.fromEntries(FLAGS.map(f => [f, p[f]]))

  it.each(ROLE_CASES)('matches the real usePermissions() for %s', role => {
    expect(pick(SETTINGS_PERMS[role])).toEqual(pick(ROLES[role]()))
  })
})

describe('notSavedText (the save foot failure line)', () => {
  it('says the reason the server gave, when it gave one', () => {
    expect(notSavedText({ response: { status: 400, data: { errors: ['Unknown event type or channel.'] } } })).toBe('Not saved. Unknown event type or channel.')
  })

  it('uses the section sentence for a 400 that names no field, and a short line for a 403', () => {
    expect(notSavedText({ response: { status: 400, data: {} } }, 'Fill in the address.')).toBe('Not saved. Fill in the address.')
    expect(notSavedText({ response: { status: 403, data: {} } })).toBe('Not saved. Only an Admin can change these.')
  })

  it('asks to check the connection when there is no answer', () => {
    expect(notSavedText(new Error('Network Error'))).toBe('Not saved. Check your connection and try again.')
  })
})
