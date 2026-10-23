import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TenantDetailView from './TenantDetailView'
import type { ProviderSettingsDto, TenantSummaryDto } from '@/api/types'

const tenant = { id: 't-1', name: 'Jo Care', emailDomain: null, isActive: true, createdAt: '2026-01-01T00:00:00Z', userCount: 0 } as TenantSummaryDto
const complete = { registrationNumber: '4050', abn: '51824753556', organisationName: 'Jo Care', address: '1 Example Street', state: 'WA' } as ProviderSettingsDto
const { settings } = vi.hoisted(() => ({ settings: { current: undefined as unknown } }))

vi.mock('@/api/hooks/admin', () => ({ useAdminTenantProviderSettings: () => ({ data: settings.current, isLoading: false }) }))
vi.mock('@/api/hooks/settings', () => ({ useAdminTenantUsers: () => ({ data: { data: [] }, isLoading: false }) }))

const show = () => render(<MemoryRouter><TenantDetailView tenant={tenant} onBack={vi.fn()} onEditTenant={vi.fn()} onAddUser={vi.fn()} onEditUser={vi.fn()} /></MemoryRouter>)
beforeEach(() => { settings.current = undefined })

// Setup always makes the provider row, so a blank registration number or ABN must read as "not finished", not as a profile with empty fields.
describe('Tenant detail: provider settings', () => {
  it.each([
    ['registration number', { registrationNumber: '' }],
    ['ABN', { abn: '' }],
  ])('says Incomplete, without opening the section, while the %s is blank', (_, blank) => {
    settings.current = { ...complete, ...blank }
    show()
    expect(screen.getByRole('button', { name: /Provider Settings/ })).toHaveTextContent('Incomplete')
  })

  it('says nothing once both are filled in, and nothing while the settings are absent', () => {
    settings.current = complete
    const { unmount } = show()
    expect(screen.getByRole('button', { name: /Provider Settings/ })).not.toHaveTextContent('Incomplete')
    unmount()
    settings.current = undefined
    show()
    expect(screen.getByRole('button', { name: /Provider Settings/ })).not.toHaveTextContent('Incomplete')
  })
})
