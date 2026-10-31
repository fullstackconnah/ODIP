import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TasksPage from './TasksPage'
import { pagedTasks } from '@/test/fixtures/pagedTasks'

// A test sets the role it needs and beforeEach puts it back: a Coordinator-like user who can write (the default).
const { perms } = vi.hoisted(() => ({ perms: { canWrite: true, isAdmin: false, isSuperAdmin: false, isReadOnly: false } }))

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => perms,
}))

const { mockUpdateMutate, mockPutMutate, mockDeleteMutate } = vi.hoisted(() => ({
  mockPutMutate: vi.fn(),
  mockDeleteMutate: vi.fn(),
  mockUpdateMutate: vi.fn(),
}))

const { mockUseTasks } = vi.hoisted(() => ({ mockUseTasks: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useTasks: mockUseTasks,
  useUpdateTask: () => ({ mutate: mockPutMutate, mutateAsync: vi.fn() }),
  useSetTaskStatus: () => ({ mutate: mockUpdateMutate }),
  useDeleteTask: () => ({ mutate: mockDeleteMutate, mutateAsync: vi.fn() }),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <TasksPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  Object.assign(perms, { canWrite: true, isAdmin: false, isSuperAdmin: false, isReadOnly: false })
  mockUseTasks.mockReturnValue({
    data: pagedTasks([
      { id: 't1', title: 'Confirm accommodation', tripInstanceId: 'trip-1', tripName: 'Beach Trip', taskType: 'AccommodationRequest', ownerName: 'Sam', dueDate: '2026-10-01', priority: 'Medium', status: 'NotStarted' },
    ]),
    isLoading: false,
  })
})

describe('TasksPage — PP-58 status change error handling', () => {
  it('shows an alert under the row when the status mutation fails', async () => {
    const user = userEvent.setup()
    mockUpdateMutate.mockImplementation((_data, { onError }) => onError(new Error('boom')))
    renderPage()

    const statusPill = screen.getByRole('button', { name: /Not Started/i })
    await user.click(statusPill)
    const completedOption = await screen.findByText('Completed')
    await user.click(completedOption)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't update status. Try again.")
  })

  it('does not show an alert when the status mutation succeeds', async () => {
    const user = userEvent.setup()
    mockUpdateMutate.mockImplementation((_data, { onSuccess }) => onSuccess())
    renderPage()

    const statusPill = screen.getByRole('button', { name: /Not Started/i })
    await user.click(statusPill)
    const completedOption = await screen.findByText('Completed')
    await user.click(completedOption)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('TasksPage — cross-domain links', () => {
  it('links the trip cell to the trip detail page', () => {
    renderPage()
    expect(screen.getByRole('link', { name: 'Beach Trip' })).toHaveAttribute('href', '/trips/trip-1')
  })
})

describe('TasksPage — obligation-engine tasks (item 9)', () => {
  it('renders "—" in the trip column for a trip-less task', () => {
    mockUseTasks.mockReturnValue({
      data: pagedTasks([
        { id: 't2', title: 'Find leave cover', taskType: 'LeaveCoverage', ownerName: 'Sam', dueDate: '2026-09-20', priority: 'High', status: 'NotStarted' },
      ]),
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Find leave cover')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Beach Trip' })).not.toBeInTheDocument()
  })

  it('makes the title the link when the task carries a linkTo (there is no separate Open column)', () => {
    mockUseTasks.mockReturnValue({
      data: pagedTasks([
        { id: 't2', title: 'Find leave cover', taskType: 'LeaveCoverage', ownerName: 'Sam', dueDate: '2026-09-20', priority: 'High', status: 'NotStarted', linkTo: '/rostering/leave' },
      ]),
      isLoading: false,
    })
    renderPage()

    expect(screen.getByRole('link', { name: 'Find leave cover' })).toHaveAttribute('href', '/rostering/leave')
    expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Open' })).not.toBeInTheDocument()
  })

  it('leaves the title as plain text when the task has no linkTo', () => {
    renderPage()
    expect(screen.queryByRole('link', { name: 'Confirm accommodation' })).not.toBeInTheDocument()
  })

  it('shows the human label for each new obligation-engine task type', () => {
    mockUseTasks.mockReturnValue({
      data: pagedTasks([
        { id: 't2', title: 'Find leave cover', taskType: 'LeaveCoverage', ownerName: 'Sam', dueDate: '2026-09-20', priority: 'High', status: 'NotStarted' },
        { id: 't3', title: 'File NDIS Commission report', taskType: 'IncidentQscReport', ownerName: 'Sam', dueDate: '2026-09-20', priority: 'High', status: 'NotStarted' },
        { id: 't4', title: 'Witness medication', taskType: 'MedicationWitness', ownerName: 'Sam', dueDate: '2026-09-20', priority: 'High', status: 'NotStarted' },
        { id: 't5', title: 'Follow up flagged note', taskType: 'FlaggedNoteFollowUp', ownerName: 'Sam', dueDate: '2026-09-20', priority: 'High', status: 'NotStarted' },
      ]),
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Leave coverage')).toBeInTheDocument()
    expect(screen.getByText('NDIS Commission report')).toBeInTheDocument()
    expect(screen.getByText('Medication witness')).toBeInTheDocument()
    expect(screen.getByText('Flagged note follow-up')).toBeInTheDocument()
  })

  it('shows an Admin the emergency booking review task by its human label, with the way to the shift on the roster board', () => {
    mockUseTasks.mockReturnValue({
      data: pagedTasks([
        { id: 't6', title: 'Review emergency shift over budget: Mia Chen on 17 Aug 2026', taskType: 'BudgetEmergencyReview', ownerName: null, dueDate: '2026-08-18', priority: 'Medium', status: 'NotStarted', linkTo: '/rostering?date=2026-08-17&participant=p-1' },
      ]),
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Budget emergency review')).toBeInTheDocument()
    expect(screen.getByText('Review emergency shift over budget: Mia Chen on 17 Aug 2026')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Review emergency shift over budget/ })).toHaveAttribute('href', '/rostering?date=2026-08-17&participant=p-1')
  })

  // Platform review V2-B: every type has a label now, the trip-bound ones included (it printed "AccommodationRequest").
  it('shows an existing task type in words too, never the raw enum', () => {
    renderPage()
    expect(screen.getByText('Accommodation request')).toBeInTheDocument()
    expect(screen.queryByText('AccommodationRequest')).not.toBeInTheDocument()
  })
})

// R2-01: DataTable cells no longer wrap, so a table's minimum width is the sum of every column's widest content. Uncapped, the Tasks
// table needed 1436px against a ~1006px box at 1280 and pushed Status and the row actions off-screen. jsdom does no layout (the Playwright
// overflow audit measures it), so this pins the budget itself: what gives way and when, what is capped, and what is reserved.
describe('TasksPage — column budget', () => {
  // L3-04: Trip (below 1536px) and Type (below 1792px) used to be deleted, so a coordinator could not see which trip a task belonged to.
  it('keeps every column at every width, Trip and Type included (the table scrolls in its box: the DataTable column rule)', () => {
    renderPage()
    for (const name of ['Task', 'Trip', 'Type', 'Owner', 'Due', 'Priority', 'Status']) {
      const header = screen.getByRole('columnheader', { name })
      expect(header.className, name).not.toMatch(/hidden/)
    }
  })

  it('clamps the Task to two lines, caps Owner and Type, and truncates the trip link on the link itself, with the full text in a tooltip', () => {
    renderPage()
    const row = screen.getByRole('link', { name: 'Beach Trip' }).closest('tr')!
    const task = within(row).getByText('Confirm accommodation')
    expect(task).toHaveClass('md:line-clamp-2', 'md:max-w-[13rem]')
    expect(task.className).not.toMatch(/md:truncate/)
    expect(task).toHaveAttribute('title', 'Confirm accommodation')
    expect(within(row).getByText('Sam')).toHaveStyle('--cell-max: 7rem')
    // Platform review V2-B (Tasks 1): at 1440 Status was clipped under the pinned actions by ~90px; Task, Trip and Type give ~112px back.
    expect(within(row).getByText('Accommodation request')).toHaveStyle('--cell-max: 7rem')
    // The link is a custom cell, so it limits itself: truncation on the link (not a wrapper, which would clip its focus ring).
    const link = screen.getByRole('link', { name: 'Beach Trip' })
    expect(link).toHaveClass('block', 'truncate', 'md:max-w-[9rem]')
    expect(link).toHaveAttribute('title', 'Beach Trip')
  })

  it('reserves the widest Status pill so the column does not jump when a task changes state', () => {
    renderPage()
    const header = screen.getByRole('columnheader', { name: 'Status' })
    expect(header).toHaveClass('md:min-w-[var(--col-min)]')
    expect(header).toHaveStyle('--col-min: 9rem')
  })
})

// The Admin's review of an emergency booking over budget (phase 3 review C2, C7, design review M9, M10): only an Admin or SuperAdmin may close it (the server forbids everyone else, and this page does not offer what
// the server would refuse), it is owned by "Admins" until somebody takes it, and its title is the way in, wrapped rather than cut so the participant and the day, the only parts that tell two emergencies apart, show.
describe('TasksPage — the emergency review task', () => {
  const review = {
    id: 't6', title: 'Review emergency shift over budget: Sienna Whitfield on 9 Oct 2026', taskType: 'BudgetEmergencyReview', ownerName: null, dueDate: '2026-10-10', priority: 'Medium', status: 'NotStarted',
    linkTo: '/rostering?date=2026-10-09&participant=p-1',
  }
  const ordinary = { id: 't7', title: 'Find leave cover', taskType: 'LeaveCoverage', ownerName: 'Sam', dueDate: '2026-09-20', priority: 'High', status: 'NotStarted', linkTo: '/rostering/leave' }
  const rowOf = (title: string) => screen.getByText(title).closest('tr') as HTMLElement
  const showing = (...tasks: object[]) => mockUseTasks.mockReturnValue({ data: pagedTasks(tasks), isLoading: false })

  it('offers a Coordinator no way to close, retype or remove the review: no tick, a held status, no edit or archive', () => {
    showing(review)
    renderPage()

    const row = rowOf(review.title)
    expect(within(row).queryByRole('button', { name: /mark complete/i })).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /Not Started/i })).toBeDisabled()
    expect(within(row).queryByRole('link', { name: /edit/i })).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /archive|delete/i })).not.toBeInTheDocument()
  })

  it('leaves a Coordinator every control on every other task', () => {
    showing(ordinary)
    renderPage()

    const row = rowOf('Find leave cover')
    expect(within(row).getByRole('button', { name: /mark complete/i })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /Not Started/i })).toBeEnabled()
    expect(within(row).getByRole('link', { name: /edit/i })).toBeInTheDocument()
  })

  it.each([
    ['an Admin', { isAdmin: true }],
    ['a SuperAdmin', { isSuperAdmin: true }],
  ])('gives %s every control on the review', (_label, role) => {
    Object.assign(perms, role)
    showing(review)
    renderPage()

    const row = rowOf(review.title)
    expect(within(row).getByRole('button', { name: /mark complete/i })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /Not Started/i })).toBeEnabled()
    expect(within(row).getByRole('link', { name: /edit/i })).toBeInTheDocument()
  })

  it('says "Admins" owns it until somebody has taken it, and then names them', () => {
    showing(review)
    const { unmount } = renderPage()
    expect(within(rowOf(review.title)).getByText('Admins')).toBeInTheDocument()
    unmount()

    showing({ ...review, ownerName: 'Ada Admin' })
    renderPage()
    expect(within(rowOf(review.title)).getByText('Ada Admin')).toBeInTheDocument()
    expect(within(rowOf(review.title)).queryByText('Admins')).not.toBeInTheDocument()
  })

  it('keeps the dash for a task nobody owns that is not the review', () => {
    showing({ ...ordinary, ownerName: null })
    renderPage()

    expect(within(rowOf('Find leave cover')).queryByText('Admins')).not.toBeInTheDocument()
    expect(within(rowOf('Find leave cover')).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('makes the title the way in to the shift', () => {
    showing(review)
    renderPage()

    const title = screen.getByRole('link', { name: review.title })
    expect(title).toHaveAttribute('href', review.linkTo)
    expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument()
  })

  it('wraps the review’s title instead of cutting it, so the participant and the day are on screen', () => {
    showing(review)
    renderPage()

    const title = screen.getByRole('link', { name: review.title })
    expect(title).toHaveClass('line-clamp-2', 'break-words')
    expect(title).not.toHaveClass('truncate', 'md:truncate')
    expect(title).toHaveAttribute('title', review.title)
  })

  it('gives the title of any task that has a link the same two lines, on the link itself, with the full text in the tooltip', () => {
    showing(ordinary)
    renderPage()

    const title = screen.getByRole('link', { name: 'Find leave cover' })
    expect(title).toHaveClass('block', 'line-clamp-2', 'md:max-w-[13rem]')
    expect(title).toHaveAttribute('title', 'Find leave cover')
    expect(title).toHaveAttribute('href', '/rostering/leave')
  })
})

// STAFF-2 / CORE-2: the tick is a write (PUT /tasks/:id), refused to ReadOnly and SupportWorker; and a refusal is said, not swallowed.
describe('TasksPage — the Mark complete tick', () => {
  it('offers no tick to a role that cannot write', () => {
    perms.canWrite = false
    renderPage()
    expect(screen.queryByRole('button', { name: 'Mark complete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Add task/ })).not.toBeInTheDocument()
  })

  // Q2 fix round: ReadOnly has no Edit action, so the title opens the task as a view; SupportWorker is sent away from that route, so its title is text.
  it('links the title to the task view for ReadOnly only', () => {
    Object.assign(perms, { canWrite: false, isReadOnly: true })
    const { unmount } = renderPage()
    expect(screen.getByRole('link', { name: 'Confirm accommodation' })).toHaveAttribute('href', '/tasks/t1/edit')
    unmount()
    Object.assign(perms, { canWrite: false, isReadOnly: false })
    renderPage()
    expect(screen.queryByRole('link', { name: 'Confirm accommodation' })).not.toBeInTheDocument()
  })

  it('shows a role that cannot write the status as text, not a pill', () => {
    perms.canWrite = false
    renderPage()
    expect(screen.getByText('Not Started')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Not Started/i })).not.toBeInTheDocument()
  })

  it('offers the tick to a role that can write, and shows the row alert when the save fails', async () => {
    const user = userEvent.setup()
    mockUpdateMutate.mockImplementation((_data, { onError }) => onError(new Error('403')))
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Mark complete' }))

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: 't1', status: 'Completed', completedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      expect.anything(),
    )
    expect(mockPutMutate).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't update status. Try again.")
  })
})

// Q2 fix round 2: a task with a linkTo (leave cover, incident witness ...) sends its title elsewhere, so ReadOnly needs View in the actions to read the task itself.
describe('TasksPage — View for ReadOnly on a linked task', () => {
  it('shows ReadOnly a View link to the task view on a row with a linkTo', () => {
    Object.assign(perms, { canWrite: false, isReadOnly: true })
    mockUseTasks.mockReturnValue({
      data: pagedTasks([{ id: 't9', title: 'Cover leave for Sam', taskType: 'Other', ownerName: null, dueDate: '2026-10-01', priority: 'Medium', status: 'NotStarted', linkTo: '/rostering/leave' }]),
      isLoading: false,
    })
    renderPage()

    expect(screen.getByRole('link', { name: 'Cover leave for Sam' })).toHaveAttribute('href', '/rostering/leave')
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/tasks/t9/edit')
  })
})

// STAFF-5: an archive the server refuses says why above the list.
describe('TasksPage — a refused archive', () => {
  it('shows the server message', async () => {
    const user = userEvent.setup()
    mockDeleteMutate.mockImplementation((_id: unknown, o?: { onError?: (e: unknown) => void }) => o?.onError?.({ response: { status: 403, data: { message: 'You do not have permission to do that.' } } }))
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Archive' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archive' }))

    expect(screen.getByText('You do not have permission to do that.')).toBeInTheDocument()
  })
})

// Platform review V2-A (Tasks 2): 21 tasks were 6,143px at 390, each card a grid of six caps labels with 20px icons.
describe('TasksPage — phone card', () => {
  it('puts the title and the status pill on the title line, due, priority, trip and owner on one muted line, and leaves the type off the card', () => {
    renderPage()

    expect(screen.getByText('Confirm accommodation').closest('td')).toHaveAttribute('data-card', 'primary')
    expect(screen.getByRole('button', { name: /Not Started/i }).closest('td')).toHaveAttribute('data-card', 'status')
    for (const text of ['Beach Trip', 'Sam', 'Medium', '01/10/2026']) {
      expect(screen.getByText(text).closest('td'), text).toHaveAttribute('data-card', 'meta')
    }
    expect(screen.getByText('Accommodation request').closest('td')).toHaveClass('max-md:hidden')
  })

  it('gives the edit and archive icons and the tick a 44px target on the card', () => {
    renderPage()

    // md+: Edit and Archive are icon buttons that overlay the row on a mouse (the actions column costs no width); below md they are one ⋯ menu.
    const edit = screen.getByRole('link', { name: 'Edit' })
    expect(edit.closest('div.flex')).toHaveClass('md:pointer-fine:absolute')
    expect(screen.getByRole('button', { name: /More actions for/ })).toHaveClass('min-h-11', 'min-w-11')
    expect(screen.getByRole('button', { name: 'Mark complete' })).toHaveClass('max-md:min-h-11', 'max-md:min-w-11')
    // VC design review fix 3: on the card the tick joins the controls after Due, so Due does not move on a card without a tick.
    // The tick is a trail cell: it ends the meta line with the menu, ahead of it.
    expect(screen.getByRole('button', { name: 'Mark complete' }).closest('td')).toHaveAttribute('data-card', 'trail')
  })
})
