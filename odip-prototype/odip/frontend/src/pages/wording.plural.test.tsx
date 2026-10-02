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
  useUpdateAccommodation: () => ({ mutate: vi.fn(), isPending: false }),
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

  it('Users pager: "Showing 1-1 of 1 user"', () => {
    mockUseAdminUsers.mockReturnValue({
      data: {
        items: [{ id: 'u1', firstName: 'User', lastName: 'One', fullName: 'User One', email: 'u1@example.com.au', username: 'u1', role: 'Coordinator',
          tenantId: 't1', tenantName: 'Sample Support Co', isActive: true, createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null }],
        totalCount: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false, hasPrevious: false,
      },
      isLoading: false,
    })

    render(<UsersTab onAddUser={vi.fn()} onEditUser={vi.fn()} />)

    expect(screen.getByText('Showing 1-1 of 1 user')).toBeInTheDocument()
  })
})
