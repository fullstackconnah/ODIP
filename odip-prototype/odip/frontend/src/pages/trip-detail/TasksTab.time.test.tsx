import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TasksTab from './TasksTab'
import type { TaskDto } from '@/api/types'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUpdateMutate } = vi.hoisted(() => ({ mockUpdateMutate: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useUpdateTask: () => ({ mutate: mockUpdateMutate, isPending: false }) }))

afterEach(() => {
  vi.useRealTimers()
  restoreZone()
  vi.clearAllMocks()
})

const task: TaskDto = {
  id: 'task-1', tripInstanceId: 'trip-1', tripName: 'Gold Coast Beach Break', participantBookingId: null, accommodationReservationId: null,
  vehicleAssignmentId: null, staffAssignmentId: null, title: 'Confirm accommodation', taskType: 'AccommodationConfirmation', ownerId: 'staff-1',
  ownerName: 'Alex Rivera', dueDate: '2026-10-05', priority: 'Medium', status: 'NotStarted', completedDate: null, notes: null,
}

// L4-05, the trip page's copy of the same defect.
describe('trip TasksTab completing a task before 10:00 Sydney time', () => {
  it.each([
    ['Sat 3 Oct 08:00 AEST', '2026-10-02T22:00:00Z', '2026-10-03'],
    ['Mon 5 Oct 08:00 AEDT', '2026-10-04T21:00:00Z', '2026-10-05'],
  ])('%s saves the local date', async (_label, now, expectedDate) => {
    if (!setZone('Australia/Sydney')) return
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    const user = userEvent.setup()

    render(<MemoryRouter><TasksTab tripId="trip-1" tasks={[task]} canWrite /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /not started/i }))
    await user.click(await screen.findByText('Completed'))

    expect(mockUpdateMutate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'Completed', completedDate: expectedDate }),
    }))
  })
})
