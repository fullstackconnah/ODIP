import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TasksPage from './TasksPage'
import { restoreZone, setZone } from '@/test/timeZone'
import { pagedTasks } from '@/test/fixtures/pagedTasks'

vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ canWrite: true }) }))

const { mockUpdateMutate, mockUseTasks } = vi.hoisted(() => ({
  mockUpdateMutate: vi.fn(),
  mockUseTasks: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useTasks: mockUseTasks,
  useUpdateTask: () => ({ mutate: vi.fn() }),
  useSetTaskStatus: () => ({ mutate: mockUpdateMutate }),
  useDeleteTask: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}))

beforeEach(() => {
  mockUseTasks.mockReturnValue({
    data: pagedTasks([{ id: 't1', title: 'Confirm accommodation', tripInstanceId: 'trip-1', tripName: 'Beach Trip', taskType: 'AccommodationRequest', ownerName: 'Sam', dueDate: '2026-10-05', priority: 'Medium', status: 'NotStarted' }]),
    isLoading: false,
  })
})

afterEach(() => {
  vi.useRealTimers()
  restoreZone()
  vi.clearAllMocks()
})

// L4-05. The quick Done sends no date: the browser's UTC date saved a task completed at 08:00 Saturday in Sydney as Friday. The server
// writes the provider's day when no date is sent.
describe.each([
  ['Sat 3 Oct 08:00 AEST', '2026-10-02T22:00:00Z'],
  ['Sat 3 Oct 00:05 AEST', '2026-10-02T14:05:00Z'],
  ['Sat 3 Oct 23:55 AEST', '2026-10-03T13:55:00Z'],
  ['Mon 5 Oct 08:00 AEDT (daylight time: 21:00Z on the 4th)', '2026-10-04T21:00:00Z'],
])('TasksPage completing a task at %s', (_label, now) => {
  it('"Mark complete" sends no date', async () => {
    if (!setZone('Australia/Sydney')) return
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    const user = userEvent.setup()

    render(<MemoryRouter><TasksPage /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Mark complete' }))

    expect(mockUpdateMutate).toHaveBeenCalledWith({ id: 't1', status: 'Completed' }, expect.anything())
    expect(mockUpdateMutate.mock.calls[0][0]).not.toHaveProperty('completedDate')
  })

  it('choosing Completed in the status pill sends no date', async () => {
    if (!setZone('Australia/Sydney')) return
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    const user = userEvent.setup()

    render(<MemoryRouter><TasksPage /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /Not Started/i }))
    await user.click(await screen.findByText('Completed'))

    expect(mockUpdateMutate).toHaveBeenCalledWith({ id: 't1', status: 'Completed' }, expect.anything())
    expect(mockUpdateMutate.mock.calls[0][0]).not.toHaveProperty('completedDate')
  })
})
