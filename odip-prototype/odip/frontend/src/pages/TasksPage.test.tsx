import { describe, it, expect, vi } from 'vitest'
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

vi.mock('@/api/hooks', () => ({
  useTasks: () => ({
    data: [
      { id: 't1', title: 'Confirm accommodation', tripInstanceId: 'trip-1', tripName: 'Beach Trip', taskType: 'AccommodationRequest', ownerName: 'Sam', dueDate: '2026-10-01', priority: 'Medium', status: 'NotStarted' },
    ],
    isLoading: false,
  }),
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
