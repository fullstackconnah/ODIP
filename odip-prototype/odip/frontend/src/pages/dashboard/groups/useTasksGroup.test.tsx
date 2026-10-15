import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderGroup, announcement, facts, headers, rowOf, subjects } from './groupHarness'
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
// The two lists, and each task read fresh at Done (GET /tasks/{id}): the stored row as it is now, which may differ from the list (deep S2).
const answer = (overdue: Array<{ id: unknown }>, week: Array<{ id: unknown }> = [], fresh: Record<string, unknown> = {}) =>
  apiGet.mockImplementation((url: string, params?: Record<string, string>) => {
    if (url !== '/tasks') {
      const id = url.slice('/tasks/'.length)
      return Promise.resolve(fresh[id] ?? [...overdue, ...week].find((t) => t.id === id))
    }
    return Promise.resolve(params?.status === 'Overdue' ? overdue : week)
  })
const render = (mayCloseBudgetReview = true) => renderGroup(() => useTasksGroup(true, { today: TODAY, mayCloseBudgetReview }))

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
        task({ id: 'd4', title: 'Done today', dueDate: TODAY, status: 'Completed' }),
      ],
    )
    render()

    await screen.findByText('Overdue older')
    expect(apiGet).toHaveBeenCalledWith('/tasks', { status: 'Overdue' })
    expect(apiGet).toHaveBeenCalledWith('/tasks', { dueToday: 'true' })
    expect(subjects()).toEqual(['Overdue older', 'Overdue newer', 'Due today urgent', 'Due today medium'])
    expect(screen.getByRole('tab', { name: 'Tasks (4)' })).toBeInTheDocument()
    expect(within(rowOf('Overdue older')).getByText('Overdue')).toBeInTheDocument()
    expect(headers()).toEqual(['Task', 'Type', 'Due', 'Priority', 'Trip', ''])
    expect(facts('Overdue older')).toEqual(['Insurance confirmation', '8 Oct', 'Urgent', 'Beach Trip'])
    // Every task names its priority (a column with gaps reads as missing data); the trip is on a card only from lg.
    expect(facts('Due today medium')).toEqual(['Insurance confirmation', '14 Oct', 'Medium', 'Beach Trip'])
    expect(within(rowOf('Due today medium')).getByText('Due today')).toBeInTheDocument()
    expect(within(rowOf('Due today medium')).getByText('Beach Trip').closest('td')).toHaveClass('max-lg:hidden')
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
    // A neutral flag, never a fact a narrow table cuts.
    expect(screen.getByText('An admin signs this off').closest('td')).toBe(screen.getByText('Review the emergency booking for Grace').closest('td'))
    expect(facts('Review the emergency booking for Grace')).toEqual(['Budget emergency review', '10 Oct', 'Urgent', '—'])
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

describe('Tasks due group — Done reads the task fresh (deep S2)', () => {
  it('PUTs the task as it is NOW, so a note or a date changed since the list loaded is kept', async () => {
    const now = task({ notes: 'Insurer called back 14 Oct.', dueDate: '2026-10-12' })
    answer([task()], [], { t1: now })
    apiPutRaw.mockResolvedValue({ success: true, data: { ...now, status: 'Completed' } })
    render()

    fireEvent.click(await screen.findByRole('button', { name: 'Done: Chase travel insurance certificate' }))

    await waitFor(() => expect(apiPutRaw).toHaveBeenCalledWith('/tasks/t1', { ...now, status: 'Completed', completedDate: TODAY }))
    const getCall = apiGet.mock.calls.findIndex(([url]) => url === '/tasks/t1')
    expect(apiGet.mock.invocationCallOrder[getCall]).toBeLessThan(apiPutRaw.mock.invocationCallOrder[0])
  })

  it.each(['Completed', 'Cancelled'])('sends nothing for a task already %s elsewhere: it stays so, the row leaves, the group refetches and says so', async (status) => {
    answer([task()], [], { t1: task({ status }) })
    render()

    fireEvent.click(await screen.findByRole('button', { name: 'Done: Chase travel insurance certificate' }))

    await waitFor(() => expect(announcement()).toHaveTextContent(`Already ${status.toLowerCase()} by someone else.`))
    expect(apiPutRaw).not.toHaveBeenCalled()
    expect(screen.queryByText('Chase travel insurance certificate')).not.toBeInTheDocument()
    // The two lists asked again: once on load, once after the stale Done.
    expect(apiGet.mock.calls.filter(([url, params]) => url === '/tasks' && params?.status === 'Overdue').length).toBeGreaterThan(1)
  })
})

describe(`Tasks due group — "due today" is the provider's day (deep N4)`, () => {
  it(`takes the server's due-today list as it is: a task due on the provider's 15 Oct shows while the viewer's clock still says 14 Oct`, async () => {
    // The server judges "today" in the provider's zone (dueToday=true, the Overdue and dueThisWeek rule); the browser does not cut it again by its own date.
    answer([], [task({ id: 'd1', title: 'Due on the provider day', dueDate: '2026-10-15', priority: 'Medium' })])
    render()

    expect(await screen.findByText('Due on the provider day')).toBeInTheDocument()
    expect(screen.getByText('Due today')).toBeInTheDocument()
  })
})

describe('Tasks due group — Mark all done (decision-bulk)', () => {
  it('reads each task fresh and PUTs it in row order, skips one already closed as stale, and never ticks a cover task', async () => {
    const open2 = task({ id: 't2', title: 'Book the bus', dueDate: '2026-10-11' })
    answer([task(), open2, task({ id: 't3', title: 'Closed meanwhile', dueDate: '2026-10-12' }), task({ id: 't4', title: 'Cover the shift', taskType: 'LeaveCoverage', dueDate: '2026-10-13' })], [],
      { t3: task({ id: 't3', title: 'Closed meanwhile', status: 'Completed' }) })
    apiPutRaw.mockImplementation(async (_url: string, body: Record<string, unknown>) => ({ success: true, data: body }))
    render()

    fireEvent.click(await screen.findByRole('button', { name: 'Mark all 3 tasks done' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent("1 stays for you to open: it can't be marked done here.")
    fireEvent.click(screen.getByRole('button', { name: 'Mark 3 done' }))

    await waitFor(() => expect(screen.getByText('Marked 2 tasks done')).toBeInTheDocument())
    expect(apiPutRaw.mock.calls.map(([url]) => url)).toEqual(['/tasks/t1', '/tasks/t2'])
    expect(apiPutRaw).toHaveBeenCalledWith('/tasks/t2', { ...open2, status: 'Completed', completedDate: TODAY })
    expect(screen.getByText("1 can't be marked done here and stays. 1 was already closed.")).toBeInTheDocument()
    expect(subjects()).toEqual(['Cover the shift'])
  })
})
