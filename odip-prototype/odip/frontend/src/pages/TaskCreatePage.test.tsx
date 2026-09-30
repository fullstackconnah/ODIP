import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TaskCreatePage from './TaskCreatePage'
import type { TaskDto } from '@/api/types'

const { mockCreateMutateAsync, mockUpdateMutateAsync, mockUseTask } = vi.hoisted(() => ({
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockUseTask: vi.fn((): { data: TaskDto | undefined; isError: boolean } => ({ data: undefined, isError: false })),
}))

// Only the API layer is mocked — FormField, Card are the real components, so this exercises the
// actual Owner picker wiring (UX-01: migrated from a native <select> to SearchableSelect) and the
// Trip picker (GEN-1: also migrated from a native <select> to SearchableSelect).
vi.mock('@/api/hooks', () => ({
  useCreateTask: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false, isError: false }),
  useUpdateTask: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false, isError: false }),
  useTask: mockUseTask,
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

function renderEditPage(id = 'task-1') {
  const router = createMemoryRouter(
    [
      { path: '/tasks/:id/edit', element: <TaskCreatePage /> },
      { path: '/tasks', element: <div>Tasks list</div> },
    ],
    { initialEntries: [`/tasks/${id}/edit`] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  mockCreateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockReset()
  mockUseTask.mockReset()
  mockUseTask.mockReturnValue({ data: undefined, isError: false })
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

describe('TaskCreatePage — edit mode single-task fetch (PP-10/PP-11)', () => {
  it('loads the form from useTask(id) instead of the whole task list', () => {
    mockUseTask.mockReturnValue({
      data: {
        id: 'task-1', tripInstanceId: 'trip-1', tripName: 'Gold Coast Beach Break',
        participantBookingId: null, accommodationReservationId: null, vehicleAssignmentId: null, staffAssignmentId: null,
        taskType: 'Other', title: 'Confirm accommodation booking', ownerId: null, ownerName: null,
        priority: 'Medium', dueDate: null, status: 'NotStarted', completedDate: null, notes: null,
      },
      isError: false,
    })
    renderEditPage()

    expect(mockUseTask).toHaveBeenCalledWith('task-1')
    expect(screen.getByDisplayValue('Confirm accommodation booking')).toBeInTheDocument()
  })

  it('shows a visible not-found message instead of silently falling back to create-mode defaults', () => {
    mockUseTask.mockReturnValue({ data: undefined, isError: true })
    renderEditPage()

    expect(screen.getByText(/couldn't find this task/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Title *')).not.toBeInTheDocument()
  })

  it('PP-59: shows a loading state instead of create-mode defaults while the edit-mode fetch is in flight', () => {
    mockUseTask.mockReturnValue({ data: undefined, isError: false })
    renderEditPage()

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Title *')).not.toBeInTheDocument()
  })
})

// Density polish (touch): the "← Back to Tasks" text link was a 19px tap target. It takes the shared TAP_FLOOR
// (a --tap-min height floor, inline-flex + centring under `pointer: coarse` only), so it is 44px tall on touch and
// exactly what it was, box for box, on a mouse (--tap-min is 0px there).
describe('TaskCreatePage — Back link touch target', () => {
  it('floors the "Back to Tasks" link at --tap-min and keeps its destination and hover colour', () => {
    renderCreatePage()

    const back = screen.getByRole('link', { name: /back to tasks/i })
    expect(back).toHaveAttribute('href', '/tasks')
    expect(back).toHaveClass('pointer-coarse:inline-flex', 'min-h-[var(--tap-min)]', 'pointer-coarse:items-center', 'hover:text-[var(--color-foreground)]', 'transition-colors')
    expect(back.className).not.toMatch(/44px/)
  })
})
