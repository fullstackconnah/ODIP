import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TasksPage from './TasksPage'
import { restoreZone, setZone } from '@/test/timeZone'

vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ canWrite: true }) }))

const { mockUpdateMutate, mockUpdateMutateAsync, mockUseTasks } = vi.hoisted(() => ({
  mockUpdateMutate: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockUseTasks: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useTasks: mockUseTasks,
  useUpdateTask: () => ({ mutate: mockUpdateMutate, mutateAsync: mockUpdateMutateAsync }),
  useDeleteTask: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}))

beforeEach(() => {
  mockUseTasks.mockReturnValue({
    data: [{ id: 't1', title: 'Confirm accommodation', tripInstanceId: 'trip-1', tripName: 'Beach Trip', taskType: 'AccommodationRequest', ownerName: 'Sam', dueDate: '2026-10-05', priority: 'Medium', status: 'NotStarted' }],
    isLoading: false,
  })
  mockUpdateMutateAsync.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  restoreZone()
  vi.clearAllMocks()
})

// L4-05. completedDate is a DateOnly the user sees on the task. It was `new Date().toISOString().split('T')[0]`, the UTC date, so a task
// completed at 08:00 on Saturday 3 Oct in Sydney (22:00Z on the 2nd) was saved as Friday the 2nd, every morning, until 10:00 (11:00 in
// daylight time). It is the local calendar date.
describe.each([
  ['Sat 3 Oct 08:00 AEST', '2026-10-02T22:00:00Z', '2026-10-03'],
  ['Sat 3 Oct 00:05 AEST', '2026-10-02T14:05:00Z', '2026-10-03'],
  ['Sat 3 Oct 23:55 AEST', '2026-10-03T13:55:00Z', '2026-10-03'],
  ['Mon 5 Oct 08:00 AEDT (daylight time: 21:00Z on the 4th)', '2026-10-04T21:00:00Z', '2026-10-05'],
])('TasksPage completing a task at %s', (_label, now, expectedDate) => {
  it('"Mark complete" saves the local date', async () => {
    if (!setZone('Australia/Sydney')) return
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    const user = userEvent.setup()

    render(<MemoryRouter><TasksPage /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Mark complete' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
      id: 't1', data: expect.objectContaining({ status: 'Completed', completedDate: expectedDate }),
    })
  })

  it('choosing Completed in the status pill saves the local date', async () => {
    if (!setZone('Australia/Sydney')) return
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    const user = userEvent.setup()

    render(<MemoryRouter><TasksPage /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /Not Started/i }))
    await user.click(await screen.findByText('Completed'))

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: 't1', data: expect.objectContaining({ status: 'Completed', completedDate: expectedDate }) },
      expect.anything(),
    )
  })
})
