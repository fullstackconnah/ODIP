import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TaskCreatePage from './TaskCreatePage'

const { mockCreateMutateAsync, mockUpdateMutateAsync } = vi.hoisted(() => ({
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
}))

// Only the API layer is mocked — FormField, Card are the real components, so this exercises the
// actual Owner picker wiring (UX-01: migrated from a native <select> to SearchableSelect) and the
// Trip picker (GEN-1: also migrated from a native <select> to SearchableSelect).
vi.mock('@/api/hooks', () => ({
  useCreateTask: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false, isError: false }),
  useUpdateTask: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false, isError: false }),
  useTrips: () => ({ data: [{ id: 'trip-1', tripName: 'Gold Coast Beach Break' }] }),
  useStaff: () => ({ data: [
    { id: 'staff-1', fullName: 'Alex Rivera' },
    { id: 'staff-2', fullName: 'Jo Lee' },
  ] }),
}))

// TaskCreatePage calls useUnsavedChangesWarning, which uses react-router 7's useBlocker — that
// throws under a plain declarative <MemoryRouter>/<Routes>, so tests need a data router (same
// requirement IncidentCreatePage.test.tsx/the retired create-wizard's test suite document).
function renderCreatePage() {
  const router = createMemoryRouter(
    [
      { path: '/tasks/new', element: <TaskCreatePage /> },
      { path: '/tasks', element: <div>Tasks list</div> },
    ],
    { initialEntries: ['/tasks/new'] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  mockCreateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockReset()
  mockCreateMutateAsync.mockResolvedValue({ success: true, data: { id: 'new-task-1' } })
})

describe('TaskCreatePage — UX-01 Owner picker (SearchableSelect)', () => {
  // The Owner field's SearchableSelect is wrapped in react-hook-form's <Controller>, which does
  // not forward FormField's aria-labelledby clone to the render-prop child, so it isn't reachable
  // via getByRole(..., { name }) (same pre-existing gap the retired create-wizard's test suite documents
  // for Preferred Staff Member) — query the combobox by its current displayed value instead.

  it('shows a combobox (not a native select) for Owner, defaulting to Unassigned', () => {
    renderCreatePage()

    expect(screen.getByDisplayValue('Unassigned')).toHaveAttribute('role', 'combobox')
  })

  it('submits the selected ownerId once an owner is picked', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('Title *'), 'Confirm accommodation booking')
    await user.click(screen.getByPlaceholderText('Select a trip...'))
    await user.click(screen.getByRole('option', { name: 'Gold Coast Beach Break' }))

    await user.click(screen.getByDisplayValue('Unassigned'))
    await user.click(screen.getByRole('option', { name: 'Jo Lee' }))

    await user.click(screen.getByRole('button', { name: /create task/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({ ownerId: 'staff-2' })
  })

  it('selects an owner via keyboard only (ArrowDown + Enter)', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    const owner = screen.getByDisplayValue('Unassigned')
    await user.click(owner)
    // First enabled option is 'Unassigned' (value '') — one more ArrowDown reaches staff-1.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(owner).toHaveValue('Alex Rivera')
  })
})
