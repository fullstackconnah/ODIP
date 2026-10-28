import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AccommodationPage from './AccommodationPage'
import UsersTab from './settings/UsersTab'

const { mockUseAccommodation, mockUseAdminUsers } = vi.hoisted(() => ({
  mockUseAccommodation: vi.fn(),
  mockUseAdminUsers: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useAccommodation: mockUseAccommodation,
  useDeleteAccommodation: () => ({ mutate: vi.fn(), isPending: false }),
  useRestoreAccommodation: () => ({ mutate: vi.fn(), isPending: false }),
  useAdminUsers: mockUseAdminUsers,
  useAdminTenantsSummary: () => ({ data: [] }),
  useEnsureUserSignInAccount: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ canWrite: true }) }))

afterEach(() => vi.clearAllMocks())

// L4-11. DESIGN.md says every count noun goes through plural(); these two hard-coded ones read wrong at one.
describe('hard-coded plurals', () => {
  it('Accommodation subtitle: "1 property", "2 properties"', () => {
    const property = (id: string) => ({
      id, propertyName: `House ${id}`, location: 'Gold Coast', region: null, isActive: true, isWheelchairAccessible: false,
      isFullyModified: false, isSemiModified: false, bedCount: 2, bedroomCount: 1, maxCapacity: 4,
    })
    mockUseAccommodation.mockReturnValue({ data: [property('a')], isLoading: false })
    const { unmount } = render(<MemoryRouter><AccommodationPage /></MemoryRouter>)
    expect(screen.getByText('1 property')).toBeInTheDocument()
    unmount()

    mockUseAccommodation.mockReturnValue({ data: [property('a'), property('b')], isLoading: false })
    render(<MemoryRouter><AccommodationPage /></MemoryRouter>)
    expect(screen.getByText('2 properties')).toBeInTheDocument()
  })

  // The Users list uses the house DataTable pager: counts without a noun, and only when there is more than one page.
  it('Users pager: two pages read "Showing 1-20 of 21"', () => {
    mockUseAdminUsers.mockReturnValue({
      data: {
        items: [{ id: 'u1', firstName: 'User', lastName: 'One', fullName: 'User One', email: 'u1@example.com.au', username: 'u1', role: 'Coordinator',
          tenantId: 't1', tenantName: 'Sample Support Co', isActive: true, createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null }],
        totalCount: 21, page: 1, pageSize: 20, totalPages: 2, hasNext: true, hasPrevious: false,
      },
      isLoading: false,
    })

    render(<UsersTab onAddUser={vi.fn()} onEditUser={vi.fn()} />)

    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && /^Showing 1[-–]20 of 21$/.test(el.textContent ?? ''))).toBeInTheDocument()
  })
})
