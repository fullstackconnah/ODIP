import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import VehicleCreatePage from './VehicleCreatePage'

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
