import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import SettingsPage from './SettingsPage'

// Tenant detail -> Edit on a user. The detail's row (TenantUserDto) holds only id, name, role and active, but the panel reads and PUTs the
// first and last name, email, username and tenant, so the page must open it with the FULL record from GET /admin/users/{id}.
// Everything here is real (page, tenant detail, panel, hooks, query client); only the HTTP layer answers.

vi.mock('@/lib/permissions', async () => {
  const { SETTINGS_PERMS } = await import('@/test/fixtures/settingsPermissions')
  return { usePermissions: () => SETTINGS_PERMS.SuperAdmin }
})
vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => false }))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail: vi.fn() }))
vi.mock('@/lib/firebase', () => ({ auth: { name: 'auth-stub' } }))

const tenant = { id: 't-1', name: 'Jo Care', emailDomain: null, isActive: true, createdAt: '2026-01-01T00:00:00Z', userCount: 1 }
const fullUser = {
  id: 'u-1', firstName: 'Ann', lastName: 'One', fullName: 'Ann One', email: 'ann@jocare.example', username: 'ann.one', role: 'Coordinator',
  tenantId: 't-1', tenantName: 'Jo Care', isActive: false, createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null,
}
const detailRow = { id: 'u-1', fullName: 'Ann One', role: 'Coordinator', isActive: false }

let userFetch: () => Promise<unknown>
const put = vi.fn()
const post = vi.fn()

beforeEach(() => {
  userFetch = () => Promise.resolve({ data: { data: fullUser } })
  put.mockReset().mockResolvedValue({ data: { data: fullUser } })
  post.mockReset().mockResolvedValue({ data: { data: fullUser } })
  vi.spyOn(apiClient, 'get').mockImplementation(((url: string) => {
    if (url === '/admin/tenants') return Promise.resolve({ data: { data: [tenant] } })
    if (url === '/admin/tenants/t-1/users') return Promise.resolve({ data: { data: [detailRow] } })
    if (url === '/admin/users/u-1') return userFetch()
    return Promise.resolve({ data: { data: null } })
  }) as never)
  vi.spyOn(apiClient, 'put').mockImplementation(put as never)
  vi.spyOn(apiClient, 'post').mockImplementation(post as never)
})
afterEach(() => vi.restoreAllMocks())

async function openTenantDetail() {
  const u = userEvent.setup()
  const router = createMemoryRouter([{ path: '/settings', element: <SettingsPage /> }], { initialEntries: ['/settings?section=tenants'] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await u.click(await screen.findByRole('button', { name: 'View Users: Jo Care' }))
  return u
}

describe('Settings > Tenants > tenant detail user actions', () => {
  it('Edit on a user opens the panel in edit mode with that user filled in, and Save updates that user', async () => {
    const u = await openTenantDetail()
    await u.click(await screen.findByRole('button', { name: 'Edit: Ann One' }))

    expect(await screen.findByRole('dialog', { name: 'Edit User' })).toBeInTheDocument()
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Ann')
    expect(screen.getByLabelText(/last name/i)).toHaveValue('One')
    expect(screen.getByLabelText(/email/i)).toHaveValue('ann@jocare.example')

    await u.type(screen.getByLabelText(/first name/i), 'ie')
    await u.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(put).toHaveBeenCalledWith('/admin/users/u-1', expect.objectContaining({
      firstName: 'Annie', lastName: 'One', email: 'ann@jocare.example', username: 'ann.one', role: 'Coordinator', isActive: false,
    }))
    expect(post).not.toHaveBeenCalled()
  })

  it('does not open the panel until the full record has arrived, so there is nothing to save early', async () => {
    let arrive!: (v: unknown) => void
    userFetch = () => new Promise(r => { arrive = r })
    const u = await openTenantDetail()
    await u.click(await screen.findByRole('button', { name: 'Edit: Ann One' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    arrive({ data: { data: fullUser } })
    expect(await screen.findByRole('dialog', { name: 'Edit User' })).toBeInTheDocument()
  })

  it('says so, and opens nothing, when the user cannot be loaded', async () => {
    userFetch = () => Promise.reject(new Error('boom'))
    const u = await openTenantDetail()
    await u.click(await screen.findByRole('button', { name: 'Edit: Ann One' }))

    expect(await screen.findByText(/couldn.t open that user/i)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('New user from the tenant detail still opens a blank create panel with the tenant chosen', async () => {
    const u = await openTenantDetail()
    await u.click(await screen.findByRole('button', { name: /New user/ }))

    expect(await screen.findByRole('dialog', { name: 'New User' })).toBeInTheDocument()
    expect(screen.getByLabelText(/first name/i)).toHaveValue('')
    expect(screen.getByRole('button', { name: /Tenant/ })).toHaveTextContent('Jo Care')
  })

  it('Edit on the tenant still opens the tenant panel', async () => {
    const u = await openTenantDetail()
    await u.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(await screen.findByRole('dialog', { name: 'Edit Tenant' })).toBeInTheDocument()
  })
})
