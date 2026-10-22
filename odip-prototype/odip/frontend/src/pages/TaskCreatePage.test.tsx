import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TaskCreatePage from './TaskCreatePage'
import type { TaskDto } from '@/api/types'

const { mockCreateMutateAsync, mockUpdateMutateAsync, mockUseTask, createState } = vi.hoisted(() => ({
  createState: { error: null as unknown },
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockUseTask: vi.fn((): { data: TaskDto | undefined; isError: boolean } => ({ data: undefined, isError: false })),
}))

// Only the API layer is mocked — FormField, Card are the real components, so this exercises the
// actual Owner picker wiring (UX-01: migrated from a native <select> to SearchableSelect) and the
// Trip picker (GEN-1: also migrated from a native <select> to SearchableSelect).
vi.mock('@/api/hooks', () => ({
  useCreateTask: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false, isError: createState.error != null, error: createState.error }),
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
function renderCreatePage(search = '') {
  const router = createMemoryRouter(
    [
      { path: '/tasks/new', element: <TaskCreatePage /> },
      { path: '/tasks', element: <div>Tasks list</div> },
    ],
    { initialEntries: ['/tasks/new' + search] },
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
  createState.error = null
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
    await user.click(screen.getByDisplayValue('No trip'))
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

// The one Back standard (UI survey s.1): the icon BackButton left of the title, named for where it goes.
describe('TaskCreatePage — Back', () => {
  it('is the icon Back before the title, a real link to /tasks', () => {
    renderCreatePage()

    const back = screen.getByRole('link', { name: /back to tasks/i })
    expect(back).toHaveAttribute('href', '/tasks')
    expect(back).toHaveClass('min-w-[var(--tap-min)]')
    expect(back.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// Q2 fix round: ReadOnly reads a task only through this form, so it opens as a view: every field disabled, no Save, no write.
describe('TaskCreatePage — view mode for a role that cannot write', () => {
  const task = {
    id: 'task-1', tripInstanceId: 'trip-1', tripName: 'Gold Coast Beach Break',
    participantBookingId: null, accommodationReservationId: null, vehicleAssignmentId: null, staffAssignmentId: null,
    taskType: 'Other', title: 'Confirm accommodation booking', ownerId: null, ownerName: null,
    priority: 'Medium', dueDate: null, status: 'NotStarted', completedDate: null, notes: 'Ring the host',
  } as unknown as TaskDto

  it('shows ReadOnly "View task" with every field disabled and no Save', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    mockUseTask.mockReturnValue({ data: task, isError: false })
    renderEditPage()

    expect(screen.getByRole('heading', { name: 'View task' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Confirm accommodation booking')).toBeDisabled()
    expect(screen.getByDisplayValue('Ring the host')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument()
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
    localStorage.clear()
  })

  it('keeps the editable form for a Coordinator', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseTask.mockReturnValue({ data: task, isError: false })
    renderEditPage()

    expect(screen.getByRole('heading', { name: 'Edit task' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Confirm accommodation booking')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    localStorage.clear()
  })
})

// STAFF-7 (UI-SURVEY "Generic failure text"): a refused save says the server's reason, and loading says what is loading.
describe('TaskCreatePage — load and save feedback', () => {
  it('shows the server message when the save is refused', () => {
    createState.error = { response: { status: 400, data: { message: 'Due date must be after the trip starts.' } } }
    renderCreatePage()
    expect(screen.getByText('Due date must be after the trip starts.')).toBeInTheDocument()
  })

  it('says it is loading while the task loads', () => {
    renderEditPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading task…')
  })
})

// QW1 (OPS-1): a task needs no trip. The Trip field is optional, and locked to the trip when the form is opened from one.
describe('TaskCreatePage — Trip is optional', () => {
  it('creates a task with no trip, sending every field with a null trip', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByLabelText('Title *'), 'Renew fire-safety check')
    await user.click(screen.getByRole('button', { name: /create task/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toEqual({
      tripInstanceId: null, taskType: 'Other', title: 'Renew fire-safety check', ownerId: null, priority: 'Medium',
      dueDate: null, status: 'NotStarted', notes: null,
    })
  })

  it('opened from a trip, shows that trip locked and sends its id', async () => {
    const user = userEvent.setup()
    renderCreatePage('?tripInstanceId=trip-1')

    const trip = screen.getByDisplayValue('Gold Coast Beach Break')
    expect(trip).toBeDisabled()
    expect(screen.getByText('This task belongs to this trip.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Title *'), 'Confirm accommodation')
    await user.click(screen.getByRole('button', { name: /create task/i }))

    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({ tripInstanceId: 'trip-1', title: 'Confirm accommodation' })
  })

  it('offers no trip as the first choice and says a blank trip is fine', () => {
    renderCreatePage()
    expect(screen.getByDisplayValue('No trip')).toHaveAttribute('role', 'combobox')
    expect(screen.getByText('Leave blank for a task that is not about a trip.')).toBeInTheDocument()
  })

  it('keeps what was typed when the server refuses the save, and shows why', async () => {
    const user = userEvent.setup()
    createState.error = { response: { status: 400, data: { message: 'Task owner not found.' } } }
    mockCreateMutateAsync.mockRejectedValue(createState.error)
    renderCreatePage()

    await user.type(screen.getByLabelText('Title *'), 'Renew fire-safety check')
    await user.click(screen.getByRole('button', { name: /create task/i }))

    expect(screen.getByText('Task owner not found.')).toBeInTheDocument()
    expect(screen.getByLabelText('Title *')).toHaveValue('Renew fire-safety check')
  })

  it('edits a task with no trip: the Trip shows No trip, locked', () => {
    mockUseTask.mockReturnValue({ data: { id: 'task-1', taskType: 'Other', title: 'Renew fire-safety check', priority: 'Medium', status: 'NotStarted' } as TaskDto, isError: false })
    renderEditPage()
    expect(screen.getByDisplayValue('No trip')).toBeDisabled()
    expect(screen.getByText("This task isn't about a trip.")).toBeInTheDocument()
    expect(screen.queryByText('This task belongs to this trip.')).not.toBeInTheDocument()
  })

  it('edits a task with a trip: the Trip is locked and the hint says it cannot be changed', () => {
    mockUseTask.mockReturnValue({ data: { id: 'task-1', tripInstanceId: 'trip-1', tripName: 'Gold Coast Beach Break', taskType: 'Other', title: 'Confirm', priority: 'Medium', status: 'NotStarted' } as TaskDto, isError: false })
    renderEditPage()
    expect(screen.getByDisplayValue('Gold Coast Beach Break')).toBeDisabled()
    expect(screen.getByText("The trip can't be changed once a task is made.")).toBeInTheDocument()
    expect(screen.queryByText('This task belongs to this trip.')).not.toBeInTheDocument()
  })
})
