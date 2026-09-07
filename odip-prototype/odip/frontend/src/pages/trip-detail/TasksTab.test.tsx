import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TasksTab from './TasksTab'
import type { TaskDto } from '@/api/types'

const { mockUpdateMutate } = vi.hoisted(() => ({
  mockUpdateMutate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useUpdateTask: () => ({ mutate: mockUpdateMutate, isPending: false }),
}))

function baseTask(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'task-1',
    tripInstanceId: 'trip-1',
    tripName: 'Gold Coast Beach Break',
    participantBookingId: null,
    accommodationReservationId: null,
    vehicleAssignmentId: null,
    staffAssignmentId: null,
    title: 'Confirm accommodation',
    taskType: 'AccommodationConfirmation',
    ownerId: 'staff-1',
    ownerName: 'Alex Rivera',
    dueDate: '2026-09-10',
    priority: 'Medium',
    status: 'NotStarted',
    completedDate: null,
    notes: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockUpdateMutate.mockReset()
})

function renderTab(props: Partial<React.ComponentProps<typeof TasksTab>> = {}) {
  return render(
    <MemoryRouter>
      <TasksTab tripId="trip-1" tasks={[baseTask()]} canWrite {...props} />
    </MemoryRouter>
  )
}

describe('TasksTab', () => {
  it('shows an Add Task link carrying the trip id when the user can write', () => {
    renderTab()

    const link = screen.getByRole('link', { name: /add task/i })
    expect(link).toHaveAttribute('href', '/tasks/new?tripInstanceId=trip-1')
  })

  it('hides the Add Task link when the user cannot write', () => {
    renderTab({ canWrite: false })

    expect(screen.queryByRole('link', { name: /add task/i })).not.toBeInTheDocument()
  })

  it('renders an inline status control (dropdown pill) when the user can write', () => {
    renderTab()

    expect(screen.getByRole('button', { name: /not started/i })).toBeInTheDocument()
  })

  it('renders a plain status badge (no control) when the user cannot write', () => {
    renderTab({ canWrite: false })

    expect(screen.queryByRole('button', { name: /not started/i })).not.toBeInTheDocument()
    expect(screen.getByText('NotStarted')).toBeInTheDocument()
  })
})
