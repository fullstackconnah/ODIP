import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import VehicleCreatePage from './VehicleCreatePage'
import { refetchable } from '@/test/refetchable'
import type { VehicleDetailDto } from '@/api/types/vehicles'

const { mockUseVehicleDetail, mockCreateMutateAsync, mockUpdateMutateAsync } = vi.hoisted(() => ({
  mockUseVehicleDetail: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
}))

function renderCreatePage() {
  const router = createMemoryRouter(
    [
      { path: '/vehicles/new', element: <VehicleCreatePage /> },
      { path: '/vehicles', element: <div>Vehicles list</div> },
    ],
    { initialEntries: ['/vehicles/new'] },
  )
  return render(<RouterProvider router={router} />)
}

let mockCreateState: { isPending: boolean; isError: boolean; error: unknown }

vi.mock('@/api/hooks', () => ({
  useCreateVehicle: () => ({ mutateAsync: mockCreateMutateAsync, ...mockCreateState }),
  useUpdateVehicle: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false, isError: false, error: null }),
  useVehicleDetail: mockUseVehicleDetail,
}))

beforeEach(() => {
  mockCreateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockReset()
  mockUseVehicleDetail.mockReturnValue({ data: undefined, isLoading: false })
  mockCreateState = { isPending: false, isError: false, error: null }
})

describe('VehicleCreatePage — specific server error surfaced (PP-73)', () => {
  it('shows the server-provided message instead of the generic banner on a 403', () => {
    mockCreateState = {
      isPending: false,
      isError: true,
      error: { response: { status: 403, data: { errors: ["You don't have permission to add vehicles."] } } },
    }
    renderCreatePage()

    expect(screen.getByText(/you don't have permission to add vehicles/i)).toBeInTheDocument()
  })

  it('falls back to the generic banner when the server gives no message', () => {
    mockCreateState = { isPending: false, isError: true, error: { response: { status: 500 } } }
    renderCreatePage()

    expect(screen.getByText(/failed to create vehicle\. please check your input and try again\./i)).toBeInTheDocument()
  })
})

// Density polish (touch): the "← Back to Vehicles" text link was a 19px tap target. It takes the shared TAP_FLOOR
// (a --tap-min height floor, inline-flex + centring under `pointer: coarse` only), so it is 44px tall on touch and
// exactly what it was, box for box, on a mouse (--tap-min is 0px there).
describe('VehicleCreatePage — Back link touch target', () => {
  it('floors the "Back to Vehicles" link at --tap-min and keeps its destination and hover colour', () => {
    renderCreatePage()

    const back = screen.getByRole('link', { name: /back to vehicles/i })
    expect(back).toHaveAttribute('href', '/vehicles')
    expect(back).toHaveClass('pointer-coarse:inline-flex', 'min-h-[var(--tap-min)]', 'pointer-coarse:items-center', 'hover:text-[var(--color-foreground)]', 'transition-colors')
    expect(back.className).not.toMatch(/44px/)
  })
})

// The edit form fills itself from the loaded vehicle. A background refetch hands over a new object, and the form used to fill again from it, replacing what the
// person had typed with the server's values.
describe('VehicleCreatePage — editing', () => {
  const vehicle = { id: 'v1', vehicleName: 'Blue Van 1', registration: 'ABC123', vehicleType: 'Van', totalSeats: 8, wheelchairPositions: 1, isInternal: true, isActive: true } as VehicleDetailDto

  function renderEditPage() {
    const router = createMemoryRouter([{ path: '/vehicles/:id/edit', element: <VehicleCreatePage /> }], { initialEntries: ['/vehicles/v1/edit'] })
    return render(<RouterProvider router={router} />)
  }

  it('fills the form from the vehicle once, and keeps what was typed when the vehicle is fetched again', async () => {
    const user = userEvent.setup()
    const query = refetchable(vehicle)
    mockUseVehicleDetail.mockImplementation(() => ({ data: query.useValue(), isLoading: false }))
    renderEditPage()

    const name = screen.getByPlaceholderText('e.g. Blue Van 1')
    expect(name).toHaveValue('Blue Van 1')
    await user.clear(name)
    await user.type(name, 'My rename')

    act(() => query.refetchWith({ ...vehicle, vehicleName: 'Renamed on the server' }))

    expect(name).toHaveValue('My rename')
  })

  // Opened from a copy the app cached more than 30 s ago, the form is filled at once and the refetch brings the current record: with nothing typed, the form must show it.
  it('takes the fresh copy of the vehicle when nothing has been typed', () => {
    const query = refetchable(vehicle)
    mockUseVehicleDetail.mockImplementation(() => ({ data: query.useValue(), isLoading: false }))
    renderEditPage()
    const name = screen.getByPlaceholderText('e.g. Blue Van 1')
    expect(name).toHaveValue('Blue Van 1')

    act(() => query.refetchWith({ ...vehicle, vehicleName: 'Renamed on the server' }))

    expect(name).toHaveValue('Renamed on the server')
  })
})
