import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TenantsTab from './TenantsTab'
import TenantDetailView from './TenantDetailView'
import type { TenantSummaryDto, TenantUserDto } from '@/api/types'

const tenant = { id: 't-1', name: 'Sample Support Co', emailDomain: 'sample.org', isActive: true, createdAt: '2026-01-01T00:00:00Z', userCount: 1 } as TenantSummaryDto
const user = { id: 'u-1', fullName: 'Priya Sharma', role: 'Admin', isActive: true } as TenantUserDto

vi.mock('@/api/hooks/admin', () => ({
  useAdminTenantsSummary: () => ({ data: [tenant], isLoading: false, isError: false, refetch: vi.fn() }),
  useAdminTenantProviderSettings: () => ({ data: undefined, isLoading: false }),
}))
vi.mock('@/api/hooks/settings', () => ({
  useAdminTenantUsers: () => ({ data: { data: [user] }, isLoading: false }),
}))

// The tenant tables' row actions are the house sm Buttons, named for their row (every row has the same ones).
describe('Tenant tables: row actions', () => {
  it('names Edit and View Users for the tenant and runs each', async () => {
    const onEditTenant = vi.fn()
    const onViewTenantDetail = vi.fn()
    render(<MemoryRouter><TenantsTab onAddTenant={vi.fn()} onEditTenant={onEditTenant} onViewTenantDetail={onViewTenantDetail} /></MemoryRouter>)

    const edit = screen.getByRole('button', { name: 'Edit: Sample Support Co' })
    const view = screen.getByRole('button', { name: 'View Users: Sample Support Co' })
    for (const button of [edit, view]) expect(button).toHaveClass('h-[var(--control-h-sm)]')
    await userEvent.setup().click(edit)
    await userEvent.setup().click(view)

    expect(onEditTenant).toHaveBeenCalledWith(tenant)
    expect(onViewTenantDetail).toHaveBeenCalledWith(tenant)
  })

  it('searches with the house SearchInput', () => {
    render(<MemoryRouter><TenantsTab onAddTenant={vi.fn()} onEditTenant={vi.fn()} onViewTenantDetail={vi.fn()} /></MemoryRouter>)

    expect(screen.getByRole('textbox', { name: 'Search by name or domain...' })).toHaveClass('bg-[var(--color-input)]')
  })

  it('names a tenant user\'s Edit for the user and runs it', async () => {
    const onEditUser = vi.fn()
    render(<MemoryRouter><TenantDetailView tenant={tenant} onBack={vi.fn()} onEditTenant={vi.fn()} onAddUser={vi.fn()} onEditUser={onEditUser} /></MemoryRouter>)

    const edit = screen.getByRole('button', { name: 'Edit: Priya Sharma' })
    expect(edit).toHaveClass('h-[var(--control-h-sm)]')
    await userEvent.setup().click(edit)

    expect(onEditUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-1' }))
  })
})
