import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePermissions, type UserRole } from './permissions'

afterEach(() => localStorage.clear())

describe('canManageIntegrations (Settings → Integrations)', () => {
  it.each([
    ['Admin', undefined, true],
    ['SuperAdmin', 'tenant-1', true],
    ['SuperAdmin', undefined, false],
    ['Coordinator', undefined, false],
    ['SupportWorker', undefined, false],
    ['ReadOnly', undefined, false],
  ] as const)('%s viewing %s: %s', (role: UserRole, tenant: string | undefined, expected: boolean) => {
    localStorage.setItem('odip_token', 't')
    localStorage.setItem('odip_user', JSON.stringify({ role }))
    if (tenant) localStorage.setItem('odip_viewing_tenant', tenant)
    expect(renderHook(() => usePermissions()).result.current.canManageIntegrations).toBe(expected)
  })
})
