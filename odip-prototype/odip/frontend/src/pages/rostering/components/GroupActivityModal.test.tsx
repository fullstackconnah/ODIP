import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GroupActivityModal, type GroupActivityModalProps } from './GroupActivityModal'
import { makeActivity } from '../test-fixtures'

const get = vi.fn()
const post = vi.fn()
const del = vi.fn()
const put = vi.fn()
vi.mock('@/api/client', async () => ({
  ...(await vi.importActual<object>('@/api/client')),
  apiGet: (...a: unknown[]) => get(...a),
  apiPost: (...a: unknown[]) => post(...a),
  apiPut: (...a: unknown[]) => put(...a),
  apiDelete: (...a: unknown[]) => del(...a),
}))

const pickerData = { staff: [], shifts: [], leave: [] } as unknown as GroupActivityModalProps['pickerData']

function open(target: GroupActivityModalProps['target']) {
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GroupActivityModal target={target} canWrite participants={[]} pickerData={pickerData} boardShifts={[]} onAddStaff={vi.fn()} onClose={onClose} />
    </QueryClientProvider>,
  )
  return onClose
}
const newTarget = { mode: 'new', serviceDate: '2026-08-17' } as const

beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset(); del.mockReset()
  get.mockImplementation((url: string) => Promise.resolve(String(url).includes('/rostering/group-activities/') ? makeActivity() : []))
})

describe('GroupActivityModal', () => {
  it('refuses a blank title before any call', async () => {
    open(newTarget)
    await userEvent.click(await screen.findByRole('button', { name: /Create activity/ }))
    expect(await screen.findByText('Add a title.')).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('sends the trimmed title with a blank minimum staff as null', async () => {
    post.mockResolvedValue(makeActivity({ id: 'new-1' }))
    open(newTarget)
    await userEvent.type(await screen.findByLabelText(/Title/), '  Bowling  ')
    await userEvent.click(screen.getByRole('button', { name: /Create activity/ }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][0]).toBe('/rostering/group-activities')
    expect(post.mock.calls[0][1]).toMatchObject({ title: 'Bowling', minStaffRequired: null })
  })

  it('keeps the edits and says so when Create fails', async () => {
    post.mockRejectedValue(new Error('offline'))
    open(newTarget)
    await userEvent.type(await screen.findByLabelText(/Title/), 'Bowling')
    await userEvent.click(screen.getByRole('button', { name: /Create activity/ }))
    expect(await screen.findByText(/Your changes are still here/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Title/)).toHaveValue('Bowling')
  })

  it('loads an activity for edit and writes a ratio at once', async () => {
    put.mockResolvedValue(makeActivity())
    open({ mode: 'edit', id: 'activity-1' })
    await userEvent.selectOptions(await screen.findByLabelText('Ratio for Mia Chen'), 'OneToTwo')
    await waitFor(() => expect(put).toHaveBeenCalledWith('/rostering/group-activities/activity-1/participants/participant-1/ratio', { ratio: 'OneToTwo' }))
  })

  it('asks before cancelling an activity', async () => {
    post.mockResolvedValue(makeActivity({ status: 'Cancelled' }))
    open({ mode: 'edit', id: 'activity-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel activity' }))
    expect(post).not.toHaveBeenCalled()
    const keep = await screen.findByText('Keep activity')
    await userEvent.click(within(keep.parentElement!).getByRole('button', { name: 'Cancel activity' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/rostering/group-activities/activity-1/cancel', {}))
  })

  it('asks before removing a participant or a worker, and only the confirmed one goes', async () => {
    del.mockResolvedValue(makeActivity())
    open({ mode: 'edit', id: 'activity-1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Mia Chen from Bowling' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Mia from Bowling?' })
    expect(within(dialog).getByText('Their shift stays on the board as a regular shift.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep' }))
    expect(del).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Alex Rivera from Bowling' }))
    const staff = await screen.findByRole('alertdialog', { name: 'Remove Alex from Bowling?' })
    expect(within(staff).getByText('Alex comes off this activity.')).toBeInTheDocument()
    await userEvent.click(within(staff).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(del).toHaveBeenCalledWith('/rostering/group-activities/activity-1/staff/row-1'))
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('leaves 2:1 out of the ratio options unless the person is on it, and then locks the select', async () => {
    open({ mode: 'edit', id: 'activity-1' })
    const one = await screen.findByLabelText('Ratio for Mia Chen')
    expect(within(one).queryByRole('option', { name: '2:1' })).toBeNull()
    expect(one).toBeEnabled()
  })

  it('locks a 2:1 ratio select', async () => {
    get.mockImplementation((url: string) => Promise.resolve(String(url).includes('/rostering/group-activities/') ? makeActivity({ participants: [{ participantId: 'participant-1', participantName: 'Mia Chen', ratio: 'TwoToOne', shiftIds: ['a', 'b'], timesDiffer: false, didNotAttend: false }] }) : []))
    open({ mode: 'edit', id: 'activity-1' })
    const two = await screen.findByLabelText('Ratio for Mia Chen')
    expect(two).toBeDisabled()
    expect(within(two).getByRole('option', { name: '2:1' })).toBeInTheDocument()
  })

  it('a cancelled activity shows the plain staff count and no needs line', async () => {
    get.mockImplementation((url: string) => Promise.resolve(String(url).includes('/rostering/group-activities/') ? makeActivity({ status: 'Cancelled', staff: [], staffAssigned: 0, staffNeeded: 2 }) : []))
    open({ mode: 'edit', id: 'activity-1' })
    expect(await screen.findByText('No staff.')).toBeInTheDocument()
    expect(screen.getByText('Staff · 0')).toBeInTheDocument()
    expect(screen.queryByText(/Needs 2/)).toBeNull()
  })
})

describe('GroupActivityModal attendance', () => {
  const mia = { participantId: 'participant-1', participantName: 'Mia Chen', ratio: 'OneToOne' as const, shiftIds: ['s1'], timesDiffer: false, didNotAttend: false }
  const sam = { participantId: 'participant-2', participantName: 'Sam Lee', ratio: 'OneToOne' as const, shiftIds: ['s2'], timesDiffer: false, didNotAttend: true }
  const serve = (activity: ReturnType<typeof makeActivity>) =>
    get.mockImplementation((url: string) => Promise.resolve(String(url).includes('/rostering/group-activities/') ? activity : []))
  const started = (over: Parameters<typeof makeActivity>[0] = {}) => makeActivity({ status: 'InProgress', participants: [mia, sam], ...over })

  it("marks an attending participant as didn't attend, with no confirm, and hands focus to Undo", async () => {
    let current = started({ participants: [mia] })
    get.mockImplementation((url: string) => Promise.resolve(String(url).includes('/rostering/group-activities/') ? current : []))
    post.mockImplementation(() => { current = started({ participants: [{ ...mia, didNotAttend: true }] }); return Promise.resolve(current) })
    open({ mode: 'edit', id: 'activity-1' })
    await userEvent.click(await screen.findByRole('button', { name: "Mark Mia Chen as didn't attend" }))
    expect(post).toHaveBeenCalledWith('/rostering/group-activities/activity-1/participants/participant-1/attendance', { attended: false })
    await waitFor(() => expect(screen.getByRole('button', { name: "Undo didn't attend for Mia Chen" })).toHaveFocus())
  })

  it("shows a didn't-attend row with its badge and a no-show line, and Undo sends attended: true", async () => {
    serve(started())
    post.mockResolvedValue(started())
    open({ mode: 'edit', id: 'activity-1' })
    const row = (await screen.findByText('Sam Lee')).closest('[data-participant-row]') as HTMLElement
    expect(within(row).getByText("Didn't attend")).toBeInTheDocument()
    expect(within(row).getByText('Shift cancelled as a no-show.')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: "Undo didn't attend for Sam Lee" }))
    expect(post).toHaveBeenCalledWith('/rostering/group-activities/activity-1/participants/participant-2/attendance', { attended: true })
  })

  it('on a started activity offers neither Remove nor the ratio select, and says how attendance settles', async () => {
    serve(started())
    open({ mode: 'edit', id: 'activity-1' })
    expect(await screen.findByText("Mark anyone who didn't come. Everyone else is marked as attended when the last staff shift is approved.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove Mia Chen/ })).toBeNull()
    expect(screen.queryByLabelText('Ratio for Mia Chen')).toBeNull()
  })

  it('before the activity starts there is no attendance control and no helper line', async () => {
    serve(makeActivity({ status: 'Published', participants: [mia] }))
    open({ mode: 'edit', id: 'activity-1' })
    expect(await screen.findByLabelText('Ratio for Mia Chen')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /didn't attend/i })).toBeNull()
    expect(screen.queryByText(/Mark anyone who didn't come/)).toBeNull()
  })

  it("a completed activity shows Attended and Didn't attend badges and no buttons", async () => {
    serve(started({ status: 'Completed' }))
    open({ mode: 'edit', id: 'activity-1' })
    const miaRow = (await screen.findByText('Mia Chen')).closest('[data-participant-row]') as HTMLElement
    expect(within(miaRow).getByText('Attended')).toBeInTheDocument()
    const samRow = screen.getByText('Sam Lee').closest('[data-participant-row]') as HTMLElement
    expect(within(samRow).getByText("Didn't attend")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /didn't attend/i })).toBeNull()
    expect(screen.queryByText(/Mark anyone who didn't come/)).toBeNull()
  })

  it("shows the server's refusal under that row only and leaves the button usable again", async () => {
    serve(started({ participants: [mia, sam] }))
    const message = 'Attendance is final once every staff shift is approved.'
    post.mockRejectedValue({ response: { status: 409, data: { message, errors: [message] } } })
    open({ mode: 'edit', id: 'activity-1' })
    await userEvent.click(await screen.findByRole('button', { name: "Undo didn't attend for Sam Lee" }))
    const samRow = screen.getByText('Sam Lee').closest('[data-participant-row]') as HTMLElement
    const miaRow = screen.getByText('Mia Chen').closest('[data-participant-row]') as HTMLElement
    expect(await within(samRow).findByText(message)).toBeInTheDocument()
    expect(within(miaRow).queryByText(message)).toBeNull()
    expect(screen.getAllByText(message)).toHaveLength(1)   // no second copy in a modal-level banner
    await waitFor(() => expect(screen.getByRole('button', { name: "Undo didn't attend for Sam Lee" })).toBeEnabled())
  })

  it('offline: the button is disabled and the row says so', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    serve(started({ participants: [mia] }))
    open({ mode: 'edit', id: 'activity-1' })
    expect(await screen.findByRole('button', { name: "Mark Mia Chen as didn't attend" })).toBeDisabled()
    expect(screen.getByText("You're offline.")).toBeInTheDocument()
    online.mockRestore()
  })
})
