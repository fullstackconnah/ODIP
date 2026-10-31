import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TasksPage from './TasksPage'
import { pagedTasks } from '@/test/fixtures/pagedTasks'

const { mockUseTasks } = vi.hoisted(() => ({ mockUseTasks: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useTasks: mockUseTasks,
  useUpdateTask: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useSetTaskStatus: () => ({ mutate: vi.fn() }),
  useDeleteTask: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ canWrite: true }) }))

afterEach(() => vi.clearAllMocks())

// L3-03: the Dashboard's Overdue tile links to /tasks?status=Overdue, so the list must open on that filter.
describe('Tasks list opened from the dashboard', () => {
  it('reads the status filter from the address and asks the server for it', () => {
    mockUseTasks.mockReturnValue({ data: pagedTasks([]), isLoading: false })

    render(<MemoryRouter initialEntries={['/tasks?status=Overdue']}><TasksPage /></MemoryRouter>)

    expect(mockUseTasks).toHaveBeenCalledWith(expect.objectContaining({ status: 'Overdue' }))
  })

  it('without a filter in the address asks for everything, as before', () => {
    mockUseTasks.mockReturnValue({ data: pagedTasks([]), isLoading: false })

    render(<MemoryRouter initialEntries={['/tasks']}><TasksPage /></MemoryRouter>)

    expect(mockUseTasks).toHaveBeenCalledWith(expect.not.objectContaining({ status: expect.anything() }))
  })
})

// F3: GET /tasks returns the 500 soonest due and the true total; the page says so when the list is cut.
describe('Tasks list past the server cap', () => {
  const rows = [
    { id: 't1', title: 'Confirm accommodation', taskType: 'AccommodationRequest', ownerName: 'Sam', dueDate: '2026-10-01', priority: 'Medium', status: 'NotStarted' },
    { id: 't2', title: 'Book the van', taskType: 'VehicleRequest', ownerName: 'Sam', dueDate: '2026-10-02', priority: 'Medium', status: 'NotStarted' },
  ]
  const open = (path = '/tasks') => render(<MemoryRouter initialEntries={[path]}><TasksPage /></MemoryRouter>)
  const capped = (extra: object = {}) => mockUseTasks.mockReturnValue({ data: pagedTasks(rows, 1234), isLoading: false, ...extra })

  it('shows the server total in the subtitle, not the rows it holds', () => {
    capped()
    open()
    expect(screen.getByText('1234 tasks')).toBeInTheDocument()
  })

  it('says how many it shows and how to narrow the list', () => {
    capped()
    open()
    expect(screen.getByText('Showing the first 2 of 1234 tasks, soonest due first. Choose a status to narrow the list.')).toBeInTheDocument()
  })

  it('leaves out the status hint once a status is chosen', () => {
    capped()
    open('/tasks?status=Overdue')
    expect(screen.getByText('Showing the first 2 of 1234 tasks, soonest due first.')).toBeInTheDocument()
  })

  it('names no action in the Archived view, which has no filter', () => {
    capped()
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'Archived' }))
    expect(screen.getByText('Showing the first 2 of 1234 archived tasks, soonest due first.')).toBeInTheDocument()
  })

  it.each([
    ['the rows are the whole list', { data: pagedTasks(rows), isLoading: false }],
    ['the list is loading', { data: undefined, isLoading: true }],
    ['the list failed to load', { data: undefined, isLoading: false, isError: true }],
  ])('is absent when %s', (_when, query) => {
    mockUseTasks.mockReturnValue(query)
    open()
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument()
  })
})
