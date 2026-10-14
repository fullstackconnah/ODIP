import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderGroup, announcement } from './groupHarness'
import { useTasksGroup } from './useTasksGroup'

vi.mock('@/lib/firebase', () => ({ auth: null, devAuthEnabled: true }))
const { apiGet, apiPutRaw } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPutRaw: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGet, apiPutRaw }))

const TODAY = '2026-10-14'
const task = (o: Record<string, unknown> = {}) => ({
  id: 't1', tripInstanceId: 'trip-1', tripName: 'Beach Trip', participantBookingId: null, accommodationReservationId: null, vehicleAssignmentId: null,
  staffAssignmentId: null, taskType: 'InsuranceConfirmation', title: 'Chase travel insurance certificate', ownerId: 'u-callum', ownerName: 'Callum Radford',
  priority: 'Urgent', dueDate: '2026-10-10', status: 'NotStarted', completedDate: null, notes: 'Plan manager emailed 24 Jul.', ...o,
})
const answer = (overdue: unknown[], week: unknown[] = []) =>
  apiGet.mockImplementation((_url: string, params?: Record<string, string>) => Promise.resolve(params?.status === 'Overdue' ? overdue : week))
const render = (mayCloseBudgetReview = true) => renderGroup(() => useTasksGroup(true, { today: TODAY, mayCloseBudgetReview }))
const subjects = () => screen.getAllByRole('listitem').map((li) => li.querySelector('span')!.textContent)

beforeEach(() => {
  apiGet.mockReset()
  apiPutRaw.mockReset()
})

describe('Tasks due group — what it lists', () => {
  it('lists overdue (oldest due first), then due today (High and Urgent first), each task once, and nothing else', async () => {
    answer(
      [task({ id: 'o2', title: 'Overdue newer', dueDate: '2026-10-12' }), task({ id: 'o1', title: 'Overdue older', dueDate: '2026-10-08' })],
      [
        task({ id: 'd1', title: 'Due today medium', dueDate: TODAY, priority: 'Medium' }),
        task({ id: 'd2', title: 'Due today urgent', dueDate: TODAY, priority: 'Urgent' }),
        task({ id: 'o1', title: 'Overdue older', dueDate: '2026-10-08' }),
        task({ id: 'd3', title: 'Due tomorrow', dueDate: '2026-10-15' }),
        task({ id: 'd4', title: 'Done today', dueDate: TODAY, status: 'Completed' }),
      ],
    )
    render()

    await screen.findByText('Overdue older')
    expect(apiGet).toHaveBeenCalledWith('/tasks', { status: 'Overdue' })
    expect(apiGet).toHaveBeenCalledWith('/tasks', { dueThisWeek: 'true' })
    expect(subjects()).toEqual(['Overdue older', 'Overdue newer', 'Due today urgent', 'Due today medium'])
    expect(screen.getByText('4')).toBeInTheDocument()
    const overdueRow = screen.getByText('Overdue older').closest('li')!
    expect(within(overdueRow).getByText('Overdue')).toBeInTheDocument()
    expect(within(overdueRow).getByText('Insurance confirmation · Urgent · due 8 Oct · Beach Trip')).toBeInTheDocument()
    expect(within(screen.getByText('Due today medium').closest('li')!).getByText('Due today')).toBeInTheDocument()
    expect(within(screen.getByText('Due today medium').closest('li')!).getByText('Insurance confirmation · Beach Trip')).toBeInTheDocument()
  })
})

describe('Tasks due group — Done', () => {
  it("PUTs the stored row with its notes, as TasksPage's tick does, then takes the row away and announces it", async () => {
    answer([task()])
    apiPutRaw.mockResolvedValue({ success: true, data: task({ status: 'Completed' }) })
    render()

    fireEvent.click(await screen.findByRole('button', { name: 'Done: Chase travel insurance certificate' }))

    // The WHOLE body: the PUT rewrites every field (TasksDashboardController.Update), so it must be the stored row exactly, with only status and completedDate changed.
    await waitFor(() => expect(apiPutRaw).toHaveBeenCalledWith('/tasks/t1', { ...task(), status: 'Completed', completedDate: TODAY }))
    // And the trap by name: the notes the summary's overdueTasks would have dropped are sent.
    expect(apiPutRaw.mock.calls[0][1].notes).toBe('Plan manager emailed 24 Jul.')
    await waitFor(() => expect(announcement()).toHaveTextContent('Marked done: Chase travel insurance certificate.'))
  })

  it('offers Open beside Done for a task with somewhere to go', async () => {
    answer([task({ linkTo: '/incidents/inc-2/edit' })])
    render()

    expect(await screen.findByRole('link', { name: 'Open task: Chase travel insurance certificate' })).toHaveAttribute('href', '/incidents/inc-2/edit')
    expect(screen.getByRole('button', { name: 'Done: Chase travel insurance certificate' })).toBeInTheDocument()
  })

  it('never ticks a leave cover task by hand: it closes itself when the shift is reassigned', async () => {
    answer([task({ taskType: 'LeaveCoverage', title: 'Find cover for Grace' })])
    render()

    expect(await screen.findByRole('link', { name: 'Open roster for: Find cover for Grace' })).toHaveAttribute('href', '/rostering')
    expect(screen.queryByRole('button', { name: /^Done/ })).not.toBeInTheDocument()
  })

  it("opens the roster at the cover task's own link when it has one", async () => {
    answer([task({ taskType: 'LeaveCoverage', title: 'Find cover for Mei', linkTo: '/rostering?date=2026-10-20' })])
    render()

    expect(await screen.findByRole('link', { name: 'Open roster for: Find cover for Mei' })).toHaveAttribute('href', '/rostering?date=2026-10-20')
    expect(screen.queryByRole('button', { name: /^Done/ })).not.toBeInTheDocument()
  })
})

describe('Tasks due group — the review of an emergency over budget', () => {
  const review = task({ id: 't9', taskType: 'BudgetEmergencyReview', title: 'Review the emergency booking for Grace', linkTo: undefined, tripInstanceId: undefined, tripName: null })

  it('is ticked by an Admin or SuperAdmin (the server records them as reviewer)', async () => {
    answer([review])
    render(true)

    expect(await screen.findByRole('button', { name: 'Done: Review the emergency booking for Grace' })).toBeInTheDocument()
  })

  it('is only opened by a Coordinator, and says an admin signs it off', async () => {
    answer([review])
    render(false)

    expect(await screen.findByRole('link', { name: 'Open task: Review the emergency booking for Grace' })).toHaveAttribute('href', '/tasks/t9/edit')
    expect(screen.queryByRole('button', { name: /^Done/ })).not.toBeInTheDocument()
    expect(screen.getByText(/An admin signs this off$/)).toBeInTheDocument()
  })
})

describe('Tasks due group — a refused Done', () => {
  it("keeps the row and says the server's words", async () => {
    answer([task()])
    apiPutRaw.mockRejectedValue({ response: { data: { message: 'Task not found' } } })
    render()

    fireEvent.click(await screen.findByRole('button', { name: 'Done: Chase travel insurance certificate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Task not found')
    expect(screen.getByText('Chase travel insurance certificate')).toBeInTheDocument()
  })
})
