import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import VehiclesPage from './VehiclesPage'

const { mockUseVehicles, mockUsePermissions, mockRestore, mockDelete } = vi.hoisted(() => ({
  mockRestore: vi.fn(),
  mockDelete: vi.fn(),
  mockUseVehicles: vi.fn(),
  mockUsePermissions: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useVehicles: mockUseVehicles,
  useDeleteVehicle: () => ({ mutateAsync: mockDelete, isPending: false }),
  useRestoreVehicle: () => ({ mutateAsync: mockRestore, isPending: false }),
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
  mockRestore.mockReset().mockResolvedValue({})
  mockDelete.mockReset().mockResolvedValue({})
})

describe('VehiclesPage — card grid', () => {
  it('collapses to one column on a phone through a min(22rem,100%) track floor, and stretches the cards in a row to one height', () => {
    mockUseVehicles.mockReturnValue({ data: [makeVehicle()], isLoading: false })
    render(
      <MemoryRouter>
        <VehiclesPage />
      </MemoryRouter>,
    )

    // jsdom has no layout, so the class is the only observable proof: a bare minmax(22rem,1fr)
    // floor (352px) overflows a 320-360px phone viewport.
    const grid = screen.getByRole('heading', { name: 'Coaster 1' }).closest('.grid')!
    expect(grid).toHaveClass('grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))]')
    expect(grid).not.toHaveClass('items-start')
  })
})

describe('VehiclesPage — wheelchair positions', () => {
  it('says "1 wheelchair position": one wording with the trip tabs, never "1 positions"', () => {
    mockUseVehicles.mockReturnValue({ data: [makeVehicle({ wheelchairPositions: 1 })], isLoading: false })
    render(
      <MemoryRouter>
        <VehiclesPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('1 wheelchair position')).toBeInTheDocument()
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

    expect(mockRestore).toHaveBeenCalledWith('v-1')
  })
})

// V4: one card pattern with Accommodation. The list is already filtered to the tab, so a status pill on every card said nothing.
describe('VehiclesPage — card pattern', () => {
  it('shows no status pill that only repeats the tab, and labelled Edit and Archive', () => {
    mockUseVehicles.mockReturnValue({ data: [makeVehicle()], isLoading: false })
    render(<MemoryRouter><VehiclesPage /></MemoryRouter>)

    expect(screen.getAllByText('Active')).toHaveLength(1) // the tab, not a pill on the card
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/vehicles/v-1/edit')
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
  })

  it('folds the fleet totals into the subtitle instead of stat tiles', () => {
    mockUseVehicles.mockReturnValue({ data: [makeVehicle(), makeVehicle({ id: 'v-2', vehicleName: 'Van 2', totalSeats: 8 })], isLoading: false })
    render(<MemoryRouter><VehiclesPage /></MemoryRouter>)

    expect(screen.getByText('2 active vehicles, 20 seats')).toBeInTheDocument()
    expect(screen.queryByText('Total Fleet Capacity')).not.toBeInTheDocument()
  })
})

// V4: the same search as Accommodation.
describe('VehiclesPage — search', () => {
  it('filters the cards by name or registration, and says so when nothing matches', () => {
    mockUseVehicles.mockReturnValue({ data: [makeVehicle(), makeVehicle({ id: 'v-2', vehicleName: 'Van 2', registration: 'XYZ789' })], isLoading: false })
    render(<MemoryRouter><VehiclesPage /></MemoryRouter>)

    fireEvent.change(screen.getByPlaceholderText('Search vehicles...'), { target: { value: 'xyz' } })
    expect(screen.queryByRole('heading', { name: 'Coaster 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Van 2' })).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search vehicles...'), { target: { value: 'nothing like it' } })
    expect(screen.getByText('No results for your search')).toBeInTheDocument()
  })
})

// Q4a follow-up: the confirm only closed on success, so a refusal left it open and said nothing.
describe('VehiclesPage — a refused archive or restore', () => {
  it('closes the confirm and shows the server message', async () => {
    mockDelete.mockRejectedValue({ response: { data: { message: 'Vehicle is assigned to an upcoming trip.' } } })
    mockUseVehicles.mockReturnValue({ data: [makeVehicle()], isLoading: false })
    render(<MemoryRouter><VehiclesPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }))

    expect(await screen.findByText('Vehicle is assigned to an upcoming trip.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('closes the confirm on a refused restore too, with a fallback message', async () => {
    mockRestore.mockRejectedValue(new Error('network'))
    mockUseVehicles.mockReturnValue({ data: [makeVehicle({ isActive: false })], isLoading: false })
    render(<MemoryRouter><VehiclesPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('radio', { name: 'Archived' }))
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Restore' }))

    expect(await screen.findByText('Could not restore "Coaster 1". Please try again.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })
})
