import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TaskCreatePage from './TaskCreatePage'
import { useUpdateTask } from '@/api/hooks/tasks'

// Only the API client is mocked: the real useTask/useUpdateTask hooks and a real QueryClient drive the refetch.
const { mockGet, mockPut } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPut: vi.fn() }))
vi.mock('@/api/client', () => ({
  apiGet: mockGet, apiPutRaw: mockPut, apiPostRaw: vi.fn(), apiDeleteRaw: vi.fn(),
}))

const task = (over: Record<string, unknown> = {}) => ({
  id: 'task-1', title: 'Book transport', taskType: 'Other', priority: 'Medium', status: 'NotStarted',
  tripInstanceId: null, ownerId: null, dueDate: null, completedDate: null, notes: '', ...over,
})

let client: QueryClient
function renderEdit() {
  const router = createMemoryRouter([
    { path: '/tasks/:id/edit', element: <TaskCreatePage /> },
    { path: '/tasks', element: <div>Tasks list</div> },
  ], { initialEntries: ['/tasks/task-1/edit'] })
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mockGet.mockReset()
  mockPut.mockReset()
  mockGet.mockImplementation(async (url: string) => (url === '/tasks/task-1' ? task() : []))
})
afterEach(() => localStorage.clear())

describe('TaskCreatePage — a refetch while editing', () => {
  it('keeps what was typed and still takes the changed server status', async () => {
    const user = userEvent.setup()
    renderEdit()
    const title = await screen.findByLabelText('Title *')
    await waitFor(() => expect(title).toHaveValue('Book transport'))
    await user.clear(title)
    await user.type(title, 'Book accessible transport')

    mockGet.mockImplementation(async (url: string) => (url === '/tasks/task-1' ? task({ status: 'InProgress' }) : []))
    await client.invalidateQueries({ queryKey: ['task', 'task-1'] })

    await screen.findByText('In Progress')
    expect(screen.getByLabelText('Title *')).toHaveValue('Book accessible transport')
  })

  it('invalidates the single-task query after a save, so a reopen shows the saved values', async () => {
    mockPut.mockResolvedValue({ success: true, data: task() })
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    function Saver() {
      const m = useUpdateTask()
      return <button onClick={() => m.mutate({ id: 'task-1', data: {} as never })}>save</button>
    }
    render(<QueryClientProvider client={client}><Saver /></QueryClientProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['task', 'task-1'] }))
    spy.mockRestore()
  })
})
