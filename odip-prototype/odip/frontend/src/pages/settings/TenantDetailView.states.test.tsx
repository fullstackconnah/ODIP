import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TenantDetailView from './TenantDetailView'
import type { ProviderSettingsDto, TenantSummaryDto } from '@/api/types'

const tenant = { id: 't-1', name: 'Sample Support Co', emailDomain: 'sample.org', isActive: true, createdAt: '2026-01-01T00:00:00Z', userCount: 1 } as TenantSummaryDto

const { usersQuery, providerQuery } = vi.hoisted(() => ({ usersQuery: vi.fn(), providerQuery: vi.fn() }))
vi.mock('@/api/hooks/settings', () => ({ useAdminTenantUsers: usersQuery }))
vi.mock('@/api/hooks/admin', () => ({ useAdminTenantProviderSettings: providerQuery }))

const renderView = () =>
  render(<MemoryRouter><TenantDetailView tenant={tenant} onBack={vi.fn()} onEditTenant={vi.fn()} onAddUser={vi.fn()} onEditUser={vi.fn()} /></MemoryRouter>)

describe('TenantDetailView: loads that fail say so', () => {
  beforeEach(() => {
    usersQuery.mockReturnValue({ data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() })
    providerQuery.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() })
  })

  it('says the users could not load, with Try again, instead of "No users"', async () => {
    const refetch = vi.fn()
    usersQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    renderView()

    expect(screen.getByText(/Couldn't load this list/)).toBeInTheDocument()
    expect(screen.queryByText('No users in this tenant yet.')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('does not state a user count it does not have when the users failed to load', () => {
    usersQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() })
    renderView()

    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('keeps the counts when the users loaded', () => {
    usersQuery.mockReturnValue({ data: { data: [{ id: 'u-1', fullName: 'Priya Sharma', role: 'Admin', isActive: true }] }, isLoading: false, isError: false, refetch: vi.fn() })
    renderView()

    expect(screen.getAllByText('1')).toHaveLength(2)
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('keeps showing the provider settings when a background refetch fails', async () => {
    providerQuery.mockReturnValue({ data: { organisationName: 'Jo Care', registrationNumber: '4050', abn: '51824753556' } as ProviderSettingsDto, isLoading: false, isError: true, refetch: vi.fn() })
    renderView()
    await userEvent.setup().click(screen.getByRole('button', { name: /Provider Settings/ }))

    expect(screen.getByText('Jo Care')).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't load the provider settings/)).not.toBeInTheDocument()
  })

  it('keeps the empty and loading wording for a load that did not fail', () => {
    renderView()
    expect(screen.getByText('No users in this tenant yet.')).toBeInTheDocument()
  })

  it('says the provider settings could not load when the section is opened', async () => {
    providerQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() })
    renderView()
    await userEvent.setup().click(screen.getByRole('button', { name: /Provider Settings/ }))

    expect(screen.getByText(/Couldn't load the provider settings/)).toBeInTheDocument()
    expect(screen.queryByText('No provider settings configured for this tenant.')).not.toBeInTheDocument()
  })
})
