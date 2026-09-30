import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import VehiclesPage from './VehiclesPage'

const { mockUseVehicles, mockUsePermissions } = vi.hoisted(() => ({
  mockUseVehicles: vi.fn(),
  mockUsePermissions: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useVehicles: mockUseVehicles,
  useDeleteVehicle: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateVehicle: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: mockUsePermissions,
}))

function makeVehicle(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'v-1',
    vehicleName: 'Coaster 1',
    registration: 'ABC123',
    vehicleType: 'Bus',
    isInternal: true,
    isActive: true,
    totalSeats: 12,
    wheelchairPositions: 2,
    serviceDueDate: null,
    registrationDueDate: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockUsePermissions.mockReturnValue({ canWrite: true })
})

describe('VehiclesPage — card grid', () => {
  it('collapses to one column on a phone through a min(22rem,100%) track floor, with short cards aligned to the top', () => {
    mockUseVehicles.mockReturnValue({ data: [makeVehicle()], isLoading: false })
    render(
      <MemoryRouter>
        <VehiclesPage />
      </MemoryRouter>,
    )

    // jsdom has no layout, so the class is the only observable proof: a bare minmax(22rem,1fr)
    // floor (352px) overflows a 320-360px phone viewport.
    const grid = screen.getByRole('heading', { name: 'Coaster 1' }).closest('.grid')!
    expect(grid).toHaveClass('items-start', 'grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))]')
  })
})
