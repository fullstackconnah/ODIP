import { describe, it, expect, afterEach } from 'vitest'
import { render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PrivateRoute } from '../App'
import { usePermissions, type UserRole } from './permissions'
import { SECTIONS } from '@/pages/settings/settingsSections'
import { SETTINGS_PERMS } from '@/test/fixtures/settingsPermissions'

function signIn(role: UserRole) {
  localStorage.setItem('odip_token', 't')
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

afterEach(() => localStorage.clear())

describe('canViewDeletedRecords (Settings → Deleted records)', () => {
  it.each([['Admin', true], ['SuperAdmin', true], ['Coordinator', false], ['SupportWorker', false], ['ReadOnly', false]] as const)('%s: %s', (role, expected) => {
    signIn(role)
    expect(renderHook(() => usePermissions()).result.current.canViewDeletedRecords).toBe(expected)
  })

  it('PrivateRoute requiresDeletedRecords sends a Coordinator home and lets an Admin in', () => {
    const at = (role: UserRole) => {
      localStorage.clear()
      signIn(role)
      return render(
        <MemoryRouter initialEntries={['/settings/deleted-records']}>
          <Routes>
            <Route path="/" element={<p>Home</p>} />
            <Route path="/settings/deleted-records" element={<PrivateRoute page="settings" requiresDeletedRecords><p>Deleted list</p></PrivateRoute>} />
          </Routes>
        </MemoryRouter>,
      )
    }
    const coordinator = at('Coordinator')
    expect(screen.queryByText('Deleted list')).toBeNull()
    expect(screen.getByText('Home')).toBeInTheDocument()
    coordinator.unmount()
    at('Admin')
    expect(screen.getByText('Deleted list')).toBeInTheDocument()
  })

  it('the Settings rail lists it for an Admin in an organisation, right after Data retention, and never for a Coordinator', () => {
    const keys = (role: keyof typeof SETTINGS_PERMS) => SECTIONS.filter(s => s.visible(SETTINGS_PERMS[role])).map(s => s.key)
    expect(keys('Admin')).toContain('deleted-records')
    expect(keys('SuperAdmin')).toContain('deleted-records')
    expect(keys('SuperAdminNoOrg')).not.toContain('deleted-records')
    expect(keys('Coordinator')).not.toContain('deleted-records')
    const admin = SECTIONS.filter(s => s.visible(SETTINGS_PERMS.Admin)).map(s => s.key)
    expect(admin.indexOf('deleted-records')).toBe(admin.indexOf('retention') + 1)
  })
})
