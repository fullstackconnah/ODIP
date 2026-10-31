import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DashboardPage from './DashboardPage'
import { asRole, installDashboardDefaults, renderPage } from './dashboard/dashboardTestKit'

vi.mock('@/api/hooks', async () => (await import('./dashboard/dashboardHookMocks')).hooks)
vi.mock('./dashboard/useDecisionGroups', async () => ({ useDecisionGroups: (await import('./dashboard/dashboardHookMocks')).mockUseDecisionGroups }))

installDashboardDefaults()

describe('dashboard platform entry', () => {
  it('lets a coordinator open the roster and start an existing trip workflow', () => {
    asRole('Coordinator')
    render(<MemoryRouter><Routes><Route path="/" element={<DashboardPage />} /><Route path="/trips/new" element={<h1>Create trip</h1>} /></Routes></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Open roster' })).toHaveAttribute('href', '/rostering')
    // The New menu is a secondary button: the dashboard's one solid primary is the group's bulk action.
    expect(screen.getByRole('button', { name: 'New' })).toHaveClass('bg-[var(--color-card)]')
    expect(screen.getByRole('button', { name: 'New' }).className).not.toContain('bg-[var(--color-primary)]')
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    fireEvent.click(screen.getByRole('option', { name: /New trip/ }))
    expect(screen.getByRole('heading', { name: 'Create trip' })).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('keeps read-only navigation useful without offering create or refused roster destinations', () => {
    asRole('ReadOnly')
    renderPage()
    expect(screen.queryByRole('link', { name: 'Open roster' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument()
    // The shortcuts are the header's; the right-hand rail that repeated the sidebar is gone (the top bar's Find a page is the directory).
    expect(screen.queryByRole('complementary', { name: 'Platform entry points' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your platform' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Explore the platform' })).not.toBeInTheDocument()
  })

  it('requires a selected organisation before offering a superadmin create shortcut', () => {
    asRole('SuperAdmin')
    const view = renderPage()
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument()
    view.unmount()
    sessionStorage.setItem('odip_viewing_tenant', 'synthetic-tenant')
    renderPage()
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
  })
})
