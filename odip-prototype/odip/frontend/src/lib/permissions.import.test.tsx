import { describe, it, expect, afterEach } from 'vitest'
import { render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PrivateRoute } from '../App'
import { usePermissions, type UserRole } from './permissions'

function signIn(role: UserRole, viewingTenant?: string) {
  localStorage.setItem('odip_token', 't')
  localStorage.setItem('odip_user', JSON.stringify({ role }))
  if (viewingTenant) localStorage.setItem('odip_viewing_tenant', viewingTenant)
}

afterEach(() => localStorage.clear())

describe('canImportData (Settings → Import data)', () => {
  it.each([
    ['Admin', undefined, true],
    ['SuperAdmin', 'tenant-1', true],
    ['SuperAdmin', undefined, false],
    ['Coordinator', undefined, false],
    ['SupportWorker', undefined, false],
    ['ReadOnly', undefined, false],
  ] as const)('%s viewing %s: %s', (role, tenant, expected) => {
    signIn(role, tenant)
    expect(renderHook(() => usePermissions()).result.current.canImportData).toBe(expected)
  })

  it('PrivateRoute requiresDataImport sends a Coordinator home and lets an Admin in', () => {
    const at = (role: UserRole) => {
      localStorage.clear()
      signIn(role)
      return render(
        <MemoryRouter initialEntries={['/settings/import/participants']}>
          <Routes>
            <Route path="/" element={<p>Home</p>} />
            <Route path="/settings/import/:kind" element={<PrivateRoute page="settings" requiresDataImport><p>Wizard</p></PrivateRoute>} />
          </Routes>
        </MemoryRouter>,
      )
    }
    at('Coordinator').unmount()
    expect(screen.queryByText('Wizard')).toBeNull()
    at('Admin')
    expect(screen.getByText('Wizard')).toBeInTheDocument()
  })
})
