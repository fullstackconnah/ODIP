import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlanNotices } from './PlanNotices'

const { mockUsePermissions } = vi.hoisted(() => ({ mockUsePermissions: vi.fn() }))
vi.mock('@/lib/permissions', () => ({ usePermissions: mockUsePermissions }))

const notConfirmed = [{ code: 'registration-groups-not-confirmed', message: 'Registration groups have not been confirmed.' }]

describe('PlanNotices: the registration groups nobody has confirmed', () => {
  it('sends an Admin straight to Settings › Plan pricing', () => {
    mockUsePermissions.mockReturnValue({ isAdmin: true, isSuperAdmin: false })
    render(<MemoryRouter><PlanNotices notices={notConfirmed} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Confirm in Settings' })).toHaveAttribute('href', '/settings?section=pricing')
  })

  it('asks anyone else to ask an Admin', () => {
    mockUsePermissions.mockReturnValue({ isAdmin: false, isSuperAdmin: false })
    render(<MemoryRouter><PlanNotices notices={notConfirmed} /></MemoryRouter>)
    expect(screen.getByText(/Ask an Admin to confirm them\./)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
