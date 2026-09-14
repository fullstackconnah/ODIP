import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
