import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TripCreatePage from './TripCreatePage'

const { mockCreateMutateAsync, mockCreateTrip } = vi.hoisted(() => ({
  mockCreateMutateAsync: vi.fn(),
  mockCreateTrip: vi.fn((): { mutateAsync: typeof mockCreateMutateAsync; isPending: boolean; isError: boolean; error: unknown } => ({
    mutateAsync: mockCreateMutateAsync, isPending: false, isError: false, error: null,
  })),
}))

vi.mock('@/api/hooks', () => ({
  useCreateTrip: mockCreateTrip,
  useStaff: () => ({ data: [] }),
  useEventTemplates: () => ({ data: [] }),
}))

// TripCreatePage calls useUnsavedChangesWarning, which uses react-router 7's useBlocker — that
// throws under a plain declarative <MemoryRouter>/<Routes>, so tests need a data router (same
// requirement TaskCreatePage.test.tsx/IncidentCreatePage.test.tsx document).
function renderCreatePage() {
  const router = createMemoryRouter(
    [
      { path: '/trips/new', element: <TripCreatePage /> },
      { path: '/trips', element: <div>Trips list</div> },
      { path: '/trips/:id', element: <div>Trip detail</div> },
    ],
    { initialEntries: ['/trips/new'] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  mockCreateMutateAsync.mockReset()
})

describe('TripCreatePage — density layout', () => {
  it('caps the form at 1600px (density spec §2: forms cap, data pages do not)', () => {
    const { container } = renderCreatePage()

    const form = container.querySelector('form') as HTMLFormElement
    expect(form.parentElement!.className).toMatch(/max-w-\[1600px\]/)
  })

  it('labels the notes field once — no duplicate "Notes" card title — with a 3-row textarea', () => {
    renderCreatePage()

    expect(screen.getAllByText('Notes')).toHaveLength(1)
    expect(screen.getByLabelText('Notes')).toHaveAttribute('rows', '3')
  })
})

describe('TripCreatePage — PP-65 create-failure error message', () => {
  it('shows the server-provided message instead of the generic banner', () => {
    mockCreateTrip.mockReturnValue({
      mutateAsync: mockCreateMutateAsync,
      isPending: false,
      isError: true,
      error: { response: { data: { message: 'A trip with this code already exists.' } } },
    })
    renderCreatePage()

    expect(screen.getByText('A trip with this code already exists.')).toBeInTheDocument()
  })

  it('falls back to the generic message when the server gives no specific one', () => {
    mockCreateTrip.mockReturnValue({
      mutateAsync: mockCreateMutateAsync,
      isPending: false,
      isError: true,
      error: {},
    })
    renderCreatePage()

    expect(screen.getByText('Failed to create trip. Please check your input and try again.')).toBeInTheDocument()
  })

  it('submits the trip and navigates to the new trip on success', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockResolvedValue({ success: true, data: { id: 'trip-99' } })
    renderCreatePage()

    await user.type(screen.getByLabelText('Trip Name *'), 'Beach Getaway 2026')
    await user.type(screen.getByLabelText('Start Date *'), '2026-10-01')
    await user.click(screen.getByRole('button', { name: /create trip/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Trip detail')).toBeInTheDocument()
  })
})

// Density polish (touch): the "← Back to Trips" text link was a 19px tap target. It takes the shared TAP_FLOOR
// (a --tap-min height floor, inline-flex + centring under `pointer: coarse` only), so it is 44px tall on touch and
// exactly what it was, box for box, on a mouse (--tap-min is 0px there).
describe('TripCreatePage — Back link touch target', () => {
  it('floors the "Back to Trips" link at --tap-min and keeps its destination and hover colour', () => {
    renderCreatePage()

    const back = screen.getByRole('link', { name: /back to trips/i })
    expect(back).toHaveAttribute('href', '/trips')
    expect(back).toHaveClass('pointer-coarse:inline-flex', 'min-h-[var(--tap-min)]', 'pointer-coarse:items-center', 'hover:text-[var(--color-foreground)]', 'transition-colors')
    expect(back.className).not.toMatch(/44px/)
  })
})
