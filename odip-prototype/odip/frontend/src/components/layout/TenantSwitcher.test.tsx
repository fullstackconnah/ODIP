import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TenantSwitcher from './TenantSwitcher'

const { mockUseAdminTenantsSummary } = vi.hoisted(() => ({
  mockUseAdminTenantsSummary: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useAdminTenantsSummary: mockUseAdminTenantsSummary,
}))

const TENANTS = [
  { id: 'tenant-1', name: 'Demo', isActive: true },
  { id: 'tenant-2', name: 'Acme', isActive: true },
]

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('odip_viewing_tenant', 'tenant-1')
  mockUseAdminTenantsSummary.mockReturnValue({ data: TENANTS })
})

describe('TenantSwitcher — trigger a11y and keyboard dismissal (PP-74)', () => {
  it('exposes aria-haspopup and toggles aria-expanded on the trigger', async () => {
    const user = userEvent.setup()
    render(<TenantSwitcher />)

    const trigger = screen.getByRole('button', { name: /demo/i })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes the dropdown on Escape', async () => {
    const user = userEvent.setup()
    render(<TenantSwitcher />)

    const trigger = screen.getByRole('button', { name: /demo/i })
    await user.click(trigger)
    expect(screen.getByText(/viewing as tenant/i)).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByText(/viewing as tenant/i)).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})
