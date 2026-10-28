import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePermissions, type UserRole } from './permissions'

function signIn(role: UserRole, viewingTenant?: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role, fullName: 'Dana Whitlock', username: 'dana.whitlock', tenantName: 'Sunrise Support' }))
  if (viewingTenant) sessionStorage.setItem('odip_viewing_tenant', viewingTenant)
}

afterEach(() => localStorage.clear())

describe('hasOrganisation (Settings shows the organisation groups only then)', () => {
  it.each([
    ['Admin', undefined, true],
    ['Coordinator', undefined, true],
    ['SuperAdmin', 'tenant-1', true],
    ['SuperAdmin', undefined, false],
    ['SupportWorker', undefined, false],
    ['ReadOnly', undefined, false],
  ] as const)('%s viewing %s: %s', (role, tenant, expected) => {
    signIn(role, tenant)
    expect(renderHook(() => usePermissions()).result.current.hasOrganisation).toBe(expected)
  })
})

describe('username and tenantName (Settings › Profile)', () => {
  it('reads them from odip_user, and null when the sign-in response had none', () => {
    signIn('Admin')
    expect(renderHook(() => usePermissions()).result.current).toMatchObject({ username: 'dana.whitlock', tenantName: 'Sunrise Support' })
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    expect(renderHook(() => usePermissions()).result.current).toMatchObject({ username: null, tenantName: null })
  })
})
