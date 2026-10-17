import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import AccommodationCreatePage from './AccommodationCreatePage'
import type { AccommodationDetailDto } from '@/api/types/accommodation'

const { mockUseAccommodationDetail, mockCreateMutateAsync, mockUpdateMutateAsync } = vi.hoisted(() => ({
  mockUseAccommodationDetail: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
}))

// AccommodationCreatePage calls useUnsavedChangesWarning, which uses react-router 7's
// useBlocker — that throws under a plain declarative <MemoryRouter>/<Routes>, so tests need a
// data router (same pattern StaffCreatePage.test.tsx documents).
function renderCreatePage() {
  const router = createMemoryRouter(
    [
      { path: '/accommodation/new', element: <AccommodationCreatePage /> },
      { path: '/accommodation', element: <div>Accommodation list</div> },
      { path: '/accommodation/:id', element: <div>Accommodation detail</div> },
    ],
    { initialEntries: ['/accommodation/new'] },
  )
  return render(<RouterProvider router={router} />)
}

let mockCreateState: { isPending: boolean; isError: boolean; error: unknown }

vi.mock('@/api/hooks', () => ({
  useCreateAccommodation: () => ({ mutateAsync: mockCreateMutateAsync, ...mockCreateState }),
  useUpdateAccommodation: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false, isError: false, error: null }),
  useAccommodationDetail: mockUseAccommodationDetail,
}))

beforeEach(() => {
  mockCreateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockReset()
  mockUseAccommodationDetail.mockReturnValue({ data: undefined, isLoading: false })
  mockCreateState = { isPending: false, isError: false, error: null }
})

describe('AccommodationCreatePage — email validation (PP-70)', () => {
  it('blocks submission when the email is malformed', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText(/sunrise beach house/i), 'Test Property')
    await user.type(screen.getByPlaceholderText(/jane@example\.com/i), 'not-an-email')
    await user.click(screen.getByRole('button', { name: /create accommodation/i }))
    await new Promise(r => setTimeout(r, 50))

    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
  })

  it('accepts an empty email (optional field)', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockResolvedValue({ success: true, data: { id: 'acc-1' } })
    renderCreatePage()

    await user.type(screen.getByPlaceholderText(/sunrise beach house/i), 'Test Property')
    await user.click(screen.getByRole('button', { name: /create accommodation/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
  })
})

describe('AccommodationCreatePage — specific server error surfaced (PP-71)', () => {
  it('shows the server-provided message instead of the generic banner on a 403', () => {
    mockCreateState = {
      isPending: false,
      isError: true,
      error: { response: { status: 403, data: { errors: ["You don't have permission to add accommodation."] } } },
    }
    renderCreatePage()

    expect(screen.getByText(/you don't have permission to add accommodation/i)).toBeInTheDocument()
  })
})

// The one Back standard (UI survey s.1): the icon BackButton left of the title, named for where it goes.
describe('AccommodationCreatePage — Back', () => {
  it('is the icon Back before the title, a real link to /accommodation', () => {
    renderCreatePage()

    const back = screen.getByRole('link', { name: /back to accommodation/i })
    expect(back).toHaveAttribute('href', '/accommodation')
    expect(back).toHaveClass('min-w-[var(--tap-min)]')
    expect(back.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// C25: a failed or missing record must never open an empty form that a save would write over the real one.
describe('AccommodationCreatePage — editing a record that has not loaded', () => {
  const property = { id: 'a1', propertyName: 'Sea View', isActive: false } as AccommodationDetailDto

  function renderEditPage() {
    const router = createMemoryRouter([{ path: '/accommodation/:id/edit', element: <AccommodationCreatePage /> }], { initialEntries: ['/accommodation/a1/edit'] })
    return render(<RouterProvider router={router} />)
  }

  it('says it is loading while the record loads, with no form', () => {
    mockUseAccommodationDetail.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    renderEditPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading accommodation…')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('shows the error with Try again when the load fails, and no form', async () => {
    const refetch = vi.fn()
    mockUseAccommodationDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 500 } }, refetch })
    renderEditPage()
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load this accommodation/i)
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('says not found on a 404, with no form', () => {
    mockUseAccommodationDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 404 } }, refetch: vi.fn() })
    renderEditPage()
    expect(screen.getByText('Accommodation not found')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('saves the loaded isActive, so an inactive record stays inactive', async () => {
    mockUpdateMutateAsync.mockResolvedValue({ success: true })
    mockUseAccommodationDetail.mockReturnValue({ data: property, isLoading: false, isError: false, refetch: vi.fn() })
    renderEditPage()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }))
    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({ id: 'a1', data: expect.objectContaining({ propertyName: 'Sea View', isActive: false }) })
  })
})
