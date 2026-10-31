import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import TasksPage from './TasksPage'
import TasksTab from './trip-detail/TasksTab'
import type { TaskDto } from '@/api/types'
import { pagedTasks } from '@/test/fixtures/pagedTasks'

// Only the API client is mocked: the real hooks and a real QueryClient send the request.
const { mockGet, mockPost, mockPut } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), mockPut: vi.fn() }))
vi.mock('@/api/client', () => ({
  apiGet: mockGet, apiPostRaw: mockPost, apiPutRaw: mockPut, apiDeleteRaw: vi.fn(),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ canWrite: true }) }))

const task = {
  id: 't1', title: 'Confirm accommodation', tripInstanceId: 'trip-1', tripName: 'Beach Trip', taskType: 'AccommodationRequest',
  ownerName: 'Sam', dueDate: '2026-10-05', priority: 'Medium', status: 'NotStarted', notes: 'a note',
} as unknown as TaskDto

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  mockGet.mockReset().mockResolvedValue(pagedTasks([task]))
  mockPost.mockReset().mockResolvedValue(task)
  mockPut.mockReset()
})

describe('a status change sends the status only, never the whole task', () => {
  it('Tasks page tick posts Completed with the day', async () => {
    const user = userEvent.setup()
    renderWithClient(<TasksPage />)
    await user.click(await screen.findByRole('button', { name: 'Mark complete' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tasks/t1/status', { status: 'Completed', completedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }))
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('Tasks page status pill posts the new status alone', async () => {
    const user = userEvent.setup()
    renderWithClient(<TasksPage />)
    await user.click(await screen.findByRole('button', { name: /Not Started/i }))
    await user.click(await screen.findByText('In Progress'))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tasks/t1/status', { status: 'InProgress' }))
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('Tasks page Restore on an archived task posts NotStarted alone, not the whole row', async () => {
    const user = userEvent.setup()
    mockGet.mockResolvedValue(pagedTasks([{ ...task, status: 'Cancelled' }]))
    renderWithClient(<TasksPage />)
    await user.click(await screen.findByRole('radio', { name: 'Archived' }))
    await user.click((await screen.findAllByRole('button', { name: 'Restore' }))[0])
    // The row's Restore opens a confirmation whose own button is also named Restore (the last in the DOM).
    await user.click(screen.getAllByRole('button', { name: 'Restore' }).at(-1)!)

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tasks/t1/status', { status: 'NotStarted' }))
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('trip Tasks tab status pill posts the new status alone', async () => {
    const user = userEvent.setup()
    renderWithClient(<TasksTab tripId="trip-1" tasks={[task]} canWrite />)
    await user.click(screen.getByRole('button', { name: /not started/i }))
    await user.click(await screen.findByText('In Progress'))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tasks/t1/status', { status: 'InProgress' }))
    expect(mockPut).not.toHaveBeenCalled()
  })
})
