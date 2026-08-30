import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UserSwitcher from './UserSwitcher'

const { mockUseAdminTenantUsers } = vi.hoisted(() => ({
  mockUseAdminTenantUsers: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useAdminTenantUsers: mockUseAdminTenantUsers,
}))

const TENANT_USERS = [
  { id: 'user-support-1', fullName: 'Jamie Support', role: 'SupportWorker', isActive: true },
  { id: 'user-coord-1', fullName: 'Casey Coordinator', role: 'Coordinator', isActive: true },
]

const SUPERADMIN_USER = { id: 'superadmin-1', fullName: 'Sam SuperAdmin', role: 'SuperAdmin', tenantId: null }

function setSuperAdminSignedIn() {
  localStorage.setItem('odip_user', JSON.stringify(SUPERADMIN_USER))
  localStorage.setItem('odip_viewing_tenant', 'tenant-1')
}

beforeEach(() => {
  localStorage.clear()
  mockUseAdminTenantUsers.mockReturnValue({ data: { success: true, data: TENANT_USERS } })
  // jsdom doesn't implement navigation — stub reload so selectUser/clearUser's
  // window.location.reload() call doesn't throw and so tests can assert it fired.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: vi.fn() },
  })
})

describe('UserSwitcher — RIDER: id-based self-exclusion under view-as', () => {
  it('selectUser overrides id (not just fullName/role) in the stored odip_user blob', async () => {
    setSuperAdminSignedIn()
    const user = userEvent.setup()
    render(<UserSwitcher />)

    await user.click(screen.getByRole('button', { name: /view as user/i }))
    await user.click(screen.getByRole('button', { name: /jamie support/i }))

    const storedUser = JSON.parse(localStorage.getItem('odip_user') || '{}')
    // The bug this rider fixes: only fullName/role were overridden, leaving `id` at the
    // SuperAdmin's own id — usePermissions() reads `id` as the self-exclusion source (e.g. the
    // medication witness picker), so an impersonated user was never excluded from their own
    // picker under view-as.
    expect(storedUser.id).toBe('user-support-1')
    expect(storedUser.fullName).toBe('Jamie Support')
    expect(storedUser.role).toBe('SupportWorker')

    expect(localStorage.getItem('odip_viewing_user')).toBe('user-support-1')
    expect(window.location.reload).toHaveBeenCalledTimes(1)

    // Original SuperAdmin identity (id included) preserved for restore-on-switch-back.
    const savedAdmin = JSON.parse(localStorage.getItem('odip_superadmin_user') || '{}')
    expect(savedAdmin.id).toBe('superadmin-1')
  })

  it('preserves the original SuperAdmin id only on the FIRST impersonation in a session', async () => {
    setSuperAdminSignedIn()
    const user = userEvent.setup()
    render(<UserSwitcher />)

    await user.click(screen.getByRole('button', { name: /view as user/i }))
    await user.click(screen.getByRole('button', { name: /^jamie support/i }))

    // Reopen (trigger now reads back "Jamie Support" from localStorage on this re-render — no
    // real page reload happened, reload() is stubbed) and switch to a different impersonated
    // user: odip_superadmin_user must still hold the ORIGINAL SuperAdmin identity, not get
    // clobbered with the first impersonated user's. The trigger's own accessible name now starts
    // with the "USR" badge, not the user's name, so it's unambiguous against the dropdown row.
    await user.click(screen.getByRole('button', { name: /^usr/i }))
    await user.click(screen.getByRole('button', { name: /^casey coordinator/i }))

    const savedAdmin = JSON.parse(localStorage.getItem('odip_superadmin_user') || '{}')
    expect(savedAdmin.id).toBe('superadmin-1') // never overwritten with the impersonated user's id
  })

  it('clearUser restores the original id on switch-back', async () => {
    setSuperAdminSignedIn()
    const user = userEvent.setup()
    render(<UserSwitcher />)

    await user.click(screen.getByRole('button', { name: /view as user/i }))
    await user.click(screen.getByRole('button', { name: /^jamie support/i }))
    expect(JSON.parse(localStorage.getItem('odip_user') || '{}').id).toBe('user-support-1')

    // Reopen the dropdown (selectUser closed it) to reach "Exit view".
    await user.click(screen.getByRole('button', { name: /^usr/i }))
    await user.click(screen.getByRole('button', { name: /exit view/i }))

    const restoredUser = JSON.parse(localStorage.getItem('odip_user') || '{}')
    expect(restoredUser.id).toBe('superadmin-1')
    expect(restoredUser.role).toBe('SuperAdmin')
    expect(localStorage.getItem('odip_superadmin_user')).toBeNull()
    expect(localStorage.getItem('odip_viewing_user')).toBeNull()
  })
})
