import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TasksPage from './TasksPage'

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canWrite: true }),
}))

const { mockUpdateMutate } = vi.hoisted(() => ({
  mockUpdateMutate: vi.fn(),
}))

const { mockUseTasks } = vi.hoisted(() => ({ mockUseTasks: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useTasks: mockUseTasks,
  useUpdateTask: () => ({ mutate: mockUpdateMutate, mutateAsync: vi.fn() }),
  useDeleteTask: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <TasksPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseTasks.mockReturnValue({
    data: [
      { id: 't1', title: 'Confirm accommodation', tripInstanceId: 'trip-1', tripName: 'Beach Trip', taskType: 'AccommodationRequest', ownerName: 'Sam', dueDate: '2026-10-01', priority: 'Medium', status: 'NotStarted' },
    ],
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
      data: [
        { id: 't2', title: 'Find leave cover', taskType: 'LeaveCoverage', ownerName: 'Sam', dueDate: '2026-09-20', priority: 'High', status: 'NotStarted' },
      ],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Find leave cover')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Beach Trip' })).not.toBeInTheDocument()
  })

  it('renders an "Open" link when the task carries a linkTo', () => {
    mockUseTasks.mockReturnValue({
      data: [
        { id: 't2', title: 'Find leave cover', taskType: 'LeaveCoverage', ownerName: 'Sam', dueDate: '2026-09-20', priority: 'High', status: 'NotStarted', linkTo: '/rostering/leave' },
      ],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/rostering/leave')
  })

  it('renders no "Open" link when the task has no linkTo', () => {
    renderPage()
    expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument()
  })

  it('shows the human label for each new obligation-engine task type', () => {
    mockUseTasks.mockReturnValue({
      data: [
        { id: 't2', title: 'Find leave cover', taskType: 'LeaveCoverage', ownerName: 'Sam', dueDate: '2026-09-20', priority: 'High', status: 'NotStarted' },
        { id: 't3', title: 'File QSC report', taskType: 'IncidentQscReport', ownerName: 'Sam', dueDate: '2026-09-20', priority: 'High', status: 'NotStarted' },
        { id: 't4', title: 'Witness medication', taskType: 'MedicationWitness', ownerName: 'Sam', dueDate: '2026-09-20', priority: 'High', status: 'NotStarted' },
        { id: 't5', title: 'Follow up flagged note', taskType: 'FlaggedNoteFollowUp', ownerName: 'Sam', dueDate: '2026-09-20', priority: 'High', status: 'NotStarted' },
      ],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Leave coverage')).toBeInTheDocument()
    expect(screen.getByText('QSC incident report')).toBeInTheDocument()
    expect(screen.getByText('Medication witness')).toBeInTheDocument()
    expect(screen.getByText('Flagged note follow-up')).toBeInTheDocument()
  })

  it('still shows the raw type text for an existing task type not in the new label map', () => {
    renderPage()
    expect(screen.getByText('AccommodationRequest')).toBeInTheDocument()
  })
})

// R2-01: DataTable cells no longer wrap, so a table's minimum width is the sum of every column's widest content. Uncapped, the Tasks
// table needed 1436px against a ~1006px box at 1280 and pushed Status and the row actions off-screen. jsdom does no layout (the Playwright
// overflow audit measures it), so this pins the budget itself: what gives way and when, what is capped, and what is reserved.
describe('TasksPage — column budget', () => {
  it('drops the two least useful columns as the screen narrows (Trip below 1536px, Type below 1792px) and keeps the rest', () => {
    renderPage()
    expect(screen.getByRole('columnheader', { name: 'Trip' })).toHaveClass('md:max-2xl:hidden')
    expect(screen.getByRole('columnheader', { name: 'Type' })).toHaveClass('md:max-[1792px]:hidden')
    for (const name of ['Task', 'Owner', 'Due', 'Priority', 'Status']) {
      const header = screen.getByRole('columnheader', { name })
      expect(header.className, name).not.toMatch(/max-(xl|2xl)|max-\[1792px\]/)
    }
  })

  it('caps the Task and Owner text and truncates the trip link on the link itself, with the full text in a tooltip', () => {
    renderPage()
    const row = screen.getByRole('link', { name: 'Beach Trip' }).closest('tr')!
    const task = within(row).getByText('Confirm accommodation')
    expect(task).toHaveClass('md:truncate')
    expect(task).toHaveStyle('--cell-max: 16rem')
    expect(task).toHaveAttribute('title', 'Confirm accommodation')
    expect(within(row).getByText('Sam')).toHaveStyle('--cell-max: 8rem')
    // The link is a custom cell, so it limits itself: truncation on the link (not a wrapper, which would clip its focus ring).
    const link = screen.getByRole('link', { name: 'Beach Trip' })
    expect(link).toHaveClass('block', 'truncate', 'md:max-w-[11rem]')
    expect(link).toHaveAttribute('title', 'Beach Trip')
  })

  it('reserves the widest Status pill so the column does not jump when a task changes state', () => {
    renderPage()
    const header = screen.getByRole('columnheader', { name: 'Status' })
    expect(header).toHaveClass('md:min-w-[var(--col-min)]')
    expect(header).toHaveStyle('--col-min: 9rem')
  })
})
