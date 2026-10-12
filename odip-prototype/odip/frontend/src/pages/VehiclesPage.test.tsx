import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import VehiclesPage from './VehiclesPage'

const { mockUseVehicles, mockUsePermissions, mockRestore } = vi.hoisted(() => ({
  mockRestore: vi.fn(),
  mockUseVehicles: vi.fn(),
  mockUsePermissions: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useVehicles: mockUseVehicles,
  useDeleteVehicle: () => ({ mutate: vi.fn(), isPending: false }),
  useRestoreVehicle: () => ({ mutate: mockRestore, isPending: false }),
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

describe('VehiclesPage — write controls by role', () => {
  it('offers a role that cannot write no "Add your first vehicle" on the empty page', () => {
    mockUsePermissions.mockReturnValue({ canWrite: false })
    mockUseVehicles.mockReturnValue({ data: [], isLoading: false })
    render(<MemoryRouter><VehiclesPage /></MemoryRouter>)

    expect(screen.getByText('No vehicles found')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Add your first vehicle/ })).not.toBeInTheDocument()
  })
})

// Q2 fix round: there is no vehicle detail page, so a role that cannot write gets View (the form as a view) instead of Edit and Archive.
describe('VehiclesPage — View for a role that cannot write', () => {
  it.each([[false, true], [true, false]] as const)('canWrite %s: View offered %s', (canWrite, view) => {
    mockUsePermissions.mockReturnValue({ canWrite })
    mockUseVehicles.mockReturnValue({ data: [makeVehicle()], isLoading: false })
    render(<MemoryRouter><VehiclesPage /></MemoryRouter>)

    expect(screen.queryByRole('link', { name: 'View' }) !== null).toBe(view)
    if (view) expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/vehicles/v-1/edit')
    expect(screen.queryByRole('link', { name: /Edit/ }) !== null).toBe(!view)
  })
})

describe('VehiclesPage — Restore changes only the archived state (TRIPS-2)', () => {
  it('restores through the restore endpoint by id, never a PUT of the list row', () => {
    mockUseVehicles.mockReturnValue({ data: [makeVehicle({ isActive: false })], isLoading: false })
    render(<MemoryRouter><VehiclesPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('radio', { name: 'Archived' }))
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Restore' }))

    expect(mockRestore).toHaveBeenCalledWith('v-1', expect.anything())
  })
})
