import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TasksPage from './TasksPage'

const { mockUseTasks } = vi.hoisted(() => ({ mockUseTasks: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useTasks: mockUseTasks,
  useUpdateTask: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeleteTask: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ canWrite: true }) }))

afterEach(() => vi.clearAllMocks())

// L3-03: the Dashboard's Overdue tile links to /tasks?status=Overdue, so the list must open on that filter.
describe('Tasks list opened from the dashboard', () => {
  it('reads the status filter from the address and asks the server for it', () => {
    mockUseTasks.mockReturnValue({ data: [], isLoading: false })

    render(<MemoryRouter initialEntries={['/tasks?status=Overdue']}><TasksPage /></MemoryRouter>)

    expect(mockUseTasks).toHaveBeenCalledWith(expect.objectContaining({ status: 'Overdue' }))
  })

  it('without a filter in the address asks for everything, as before', () => {
    mockUseTasks.mockReturnValue({ data: [], isLoading: false })

    render(<MemoryRouter initialEntries={['/tasks']}><TasksPage /></MemoryRouter>)

    expect(mockUseTasks).toHaveBeenCalledWith(expect.not.objectContaining({ status: expect.anything() }))
  })
})
