import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ShiftDto } from '@/api/types'
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

function open(target: GroupActivityModalProps['target'], props: Partial<GroupActivityModalProps> = {}) {
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GroupActivityModal target={target} canWrite participants={[]} pickerData={pickerData} boardShifts={[]} onAddStaff={vi.fn()} onClose={onClose} {...props} />
    </QueryClientProvider>,
  )
  return onClose
}
const newTarget = { mode: 'new', serviceDate: '2026-08-17' } as const
const editTarget = { mode: 'edit', id: 'activity-1' } as const
const shiftTarget = { mode: 'new', serviceDate: '2026-08-17', fromShift: { id: 'shift-9', participantId: 'participant-9', participantName: 'Mia Chen', serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '11:00:00', endsNextDay: false } as ShiftDto } as const

/** jsdom has no matchMedia, so the sheet is the one-pane layout: the overview is the first screen and a row opens its page. */
const overviewRow = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}`) })
const goTo = async (name: string) => { await userEvent.click(await overviewRow(name)) }
const serve = (activity: ReturnType<typeof makeActivity>) =>
  get.mockImplementation((url: string) => Promise.resolve(String(url).includes('/rostering/group-activities/') ? activity : []))

beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset(); del.mockReset()
  get.mockImplementation((url: string) => Promise.resolve(String(url).includes('/rostering/group-activities/') ? makeActivity() : []))
})

describe('GroupActivityModal create', () => {
  it('opens on step 1 with the title focused, and Create draft posts the fields once, then the People step shows', async () => {
    post.mockResolvedValue(makeActivity({ id: 'new-1', status: 'Draft', participants: [] }))
    serve(makeActivity({ id: 'new-1', status: 'Draft', participants: [] }))
    open(newTarget)
    const title = await screen.findByLabelText(/Title/)
    expect(title).toHaveFocus()
    expect(screen.getByText('Step 1 of 3. People and staff come next.')).toBeInTheDocument()
    await userEvent.type(title, '  Bowling  ')
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post.mock.calls[0][0]).toBe('/rostering/group-activities')
    expect(post.mock.calls[0][1]).toMatchObject({ title: 'Bowling', minStaffRequired: null, notes: null })
    expect(await screen.findByText('Step 2 of 3. Each person is added as you pick them.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add participant' })).toBeEnabled())
  })

  it('from a shift, step 1 sends only the shift and the title, and leaves place, location, minimum staff and notes out', async () => {
    post.mockResolvedValue(makeActivity({ id: 'new-1', status: 'Draft' }))
    open(shiftTarget)
    await userEvent.type(await screen.findByLabelText(/Title/), 'Pool')
    expect(screen.getByLabelText(/Date/)).toBeDisabled()
    expect(screen.getByText('The date and times come from the shift.')).toBeInTheDocument()
    expect(screen.getByText('Mia Chen')).toBeInTheDocument()
    for (const gone of [/Service location/, /Location details/, /Minimum staff/, /Notes/]) expect(screen.queryByLabelText(gone)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/rostering/group-activities/from-shift/shift-9', { title: 'Pool' }))
  })

  it('refuses a blank title and an end before the start together: both errors, the count, focus on the title, nothing posted', async () => {
    open(newTarget)
    const end = await screen.findByLabelText('End *')
    fireEvent.change(end, { target: { value: '09:00' } })
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }))
    expect(await screen.findByText('Add a title.')).toBeInTheDocument()
    expect(screen.getByText('Fix the 2 fields marked in red, then create the draft.')).toBeInTheDocument()
    expect(screen.getByText(/The shift must end after it starts/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Title/)).toHaveFocus()
    expect(post).not.toHaveBeenCalled()
  })

  it('keeps every typed value and says so when Create fails', async () => {
    post.mockRejectedValue(new Error('offline'))
    open(newTarget)
    await userEvent.type(await screen.findByLabelText(/Title/), 'Bowling')
    await userEvent.type(screen.getByLabelText(/Location details/), 'Lane 4')
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }))
    expect(await screen.findByText(/Couldn't save. Your changes are still here/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Title/)).toHaveValue('Bowling')
    expect(screen.getByLabelText(/Location details/)).toHaveValue('Lane 4')
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeEnabled()
  })
})

describe('GroupActivityModal overview and pages', () => {
  it('shows the People count and Staff n of m with the short chip, opens a page, and Back returns focus to the row', async () => {
    serve(makeActivity({ staffNeeded: 3, staffAssigned: 2 }))
    open(editTarget)
    const people = await overviewRow('People')
    expect(people).toHaveTextContent('1')
    const staff = await overviewRow('Staff')
    expect(staff).toHaveTextContent('2 of 3')
    expect(staff).toHaveTextContent('1 short')
    await userEvent.click(people)
    expect(await screen.findByRole('heading', { name: 'People' })).toBeInTheDocument()
    expect(screen.getByText('Mia Chen')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to overview' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^People/ })).toHaveFocus())
  })

  it('Escape on a pushed page goes back; on the overview it closes', async () => {
    const onClose = open(editTarget)
    await goTo('People')
    await userEvent.keyboard('{Escape}')
    expect(await overviewRow('People')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape on the overview asks before discarding a typed edit, and keeps it when answered Keep editing', async () => {
    const onClose = open(editTarget)
    await goTo('Details')
    await userEvent.type(await screen.findByLabelText(/Notes/), 'Bring towels')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(await overviewRow('Details'))
    expect(screen.getByLabelText(/Notes/)).toHaveValue('Bring towels')
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(await screen.findByRole('button', { name: 'Keep editing' }))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a server error on save keeps what was typed and leaves Save changes enabled', async () => {
    put.mockRejectedValue({ response: { status: 500, data: { message: 'The connection dropped.' } } })
    open(editTarget)
    await goTo('Details')
    await userEvent.type(await screen.findByLabelText(/Notes/), 'Bring towels')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/Couldn't save. Your changes are still here/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Notes/)).toHaveValue('Bring towels')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  it('saves only the page it is on: Details sends the notes and leaves the When-and-where edit unsaved', async () => {
    put.mockResolvedValue(makeActivity())
    open(editTarget)
    await goTo('When and where')
    await userEvent.type(await screen.findByLabelText(/Title/), ' 2')
    await userEvent.click(screen.getByRole('button', { name: 'Back to overview' }))
    await goTo('Details')
    await userEvent.type(await screen.findByLabelText(/Notes/), 'Towels')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect(put.mock.calls[0][1]).toMatchObject({ title: 'Bowling', notes: 'Towels' })
  })

  it('refuses a minimum staff outside 0 to 20 before any call', async () => {
    open(editTarget)
    await goTo('Details')
    fireEvent.change(await screen.findByLabelText(/Minimum staff/), { target: { value: '21' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Minimum staff can be 0 to 20.')).toBeInTheDocument()
    expect(put).not.toHaveBeenCalled()
  })

  it('locks the date with a hint while people are attached', async () => {
    open(editTarget)
    await goTo('When and where')
    expect(await screen.findByLabelText(/Date/)).toBeDisabled()
    expect(screen.getByText('Remove the participants to move the day.')).toBeInTheDocument()
  })

  it('a started activity locks When and Details and still offers attendance and Add staff', async () => {
    serve(makeActivity({ status: 'InProgress' }))
    open(editTarget)
    expect(await screen.findByText('Started. The details are locked. Staff can still change until it ends.')).toBeInTheDocument()
    expect(within(await overviewRow('When and where')).getByLabelText('Locked')).toBeInTheDocument()
    expect(within(await overviewRow('Details')).getByLabelText('Locked')).toBeInTheDocument()
    await userEvent.click(await overviewRow('When and where'))
    expect(await screen.findByLabelText(/Title/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Back to overview' }))
    await goTo('People')
    expect(await screen.findByRole('button', { name: "Mark Mia Chen as didn't attend" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to overview' }))
    await goTo('Staff')
    expect(await screen.findByRole('button', { name: 'Add staff' })).toBeEnabled()
  })

  it('the participant picker is a page: search filters 40 names, and a refused pick shows its reason on People', async () => {
    const message = 'Nia Bell is not ready for group support yet.'
    const names = Array.from({ length: 40 }, (_, i) => ({ id: `p-${i}`, fullName: i === 7 ? 'Nia Bell' : `Person ${i}` }))
    post.mockRejectedValue({ response: { status: 409, data: { message, errors: [message] } } })
    open(editTarget, { participants: names })
    await goTo('People')
    await userEvent.click(await screen.findByRole('button', { name: 'Add participant' }))
    expect(await screen.findByRole('heading', { name: 'Add participant' })).toBeInTheDocument()
    expect(screen.getAllByRole('button').filter(b => /^(Person|Nia)/.test(b.textContent ?? ''))).toHaveLength(40)
    await userEvent.type(screen.getByLabelText('Find participant'), 'nia')
    await userEvent.click(screen.getByRole('button', { name: 'Nia Bell' }))
    expect(await screen.findByRole('heading', { name: 'People' })).toBeInTheDocument()
    expect(await screen.findByText("Nia wasn't added.")).toBeInTheDocument()
    expect(screen.getByText(message)).toBeInTheDocument()
  })
})

describe('GroupActivityModal', () => {
  it('loads an activity for edit and writes a ratio at once', async () => {
    put.mockResolvedValue(makeActivity())
    open(editTarget)
    await goTo('People')
    await userEvent.selectOptions(await screen.findByLabelText('Ratio for Mia Chen'), 'OneToTwo')
    await waitFor(() => expect(put).toHaveBeenCalledWith('/rostering/group-activities/activity-1/participants/participant-1/ratio', { ratio: 'OneToTwo' }))
  })

  it('asks before cancelling an activity', async () => {
    post.mockResolvedValue(makeActivity({ status: 'Cancelled' }))
    open(editTarget)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel activity' }))
    expect(post).not.toHaveBeenCalled()
    const keep = await screen.findByText('Keep activity')
    await userEvent.click(within(keep.parentElement!).getByRole('button', { name: 'Cancel activity' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/rostering/group-activities/activity-1/cancel', {}))
  })

  it('publishes a draft from the header with the saved fields', async () => {
    serve(makeActivity({ status: 'Draft' }))
    put.mockResolvedValue(makeActivity({ status: 'Published' }))
    open(editTarget)
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect(put.mock.calls[0][1]).toMatchObject({ title: 'Bowling', status: 'Published' })
  })

  it('asks before removing a participant or a worker, and only the confirmed one goes', async () => {
    del.mockResolvedValue(makeActivity())
    open(editTarget)
    await goTo('People')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Mia Chen from Bowling' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Mia from Bowling?' })
    expect(within(dialog).getByText('Their shift stays on the board as a regular shift.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep' }))
    expect(del).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Back to overview' }))
    await goTo('Staff')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Alex Rivera from Bowling' }))
    const staff = await screen.findByRole('alertdialog', { name: 'Remove Alex from Bowling?' })
    expect(within(staff).getByText('Alex comes off this activity.')).toBeInTheDocument()
    await userEvent.click(within(staff).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(del).toHaveBeenCalledWith('/rostering/group-activities/activity-1/staff/row-1'))
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('Escape cancels a pending remove and sends nothing', async () => {
    open(editTarget)
    await goTo('People')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Mia Chen from Bowling' }))
    await screen.findByRole('alertdialog', { name: 'Remove Mia from Bowling?' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(del).not.toHaveBeenCalled()
  })

  it('choosing the ratio it already has sends no PUT', async () => {
    open(editTarget)
    await goTo('People')
    await userEvent.selectOptions(await screen.findByLabelText('Ratio for Mia Chen'), 'OneToOne')
    expect(put).not.toHaveBeenCalled()
  })

  it('leaves 2:1 out of the ratio options unless the person is on it, and then locks the select', async () => {
    open(editTarget)
    await goTo('People')
    const one = await screen.findByLabelText('Ratio for Mia Chen')
    expect(within(one).queryByRole('option', { name: '2:1' })).toBeNull()
    expect(one).toBeEnabled()
  })

  it('locks a 2:1 ratio select', async () => {
    serve(makeActivity({ participants: [{ participantId: 'participant-1', participantName: 'Mia Chen', ratio: 'TwoToOne', shiftIds: ['a', 'b'], timesDiffer: false, didNotAttend: false }] }))
    open(editTarget)
    await goTo('People')
    const two = await screen.findByLabelText('Ratio for Mia Chen')
    expect(two).toBeDisabled()
    expect(within(two).getByRole('option', { name: '2:1' })).toBeInTheDocument()
  })

  it('a cancelled activity says so, shows the plain staff count and no needs line', async () => {
    serve(makeActivity({ status: 'Cancelled', staff: [], staffAssigned: 0, staffNeeded: 2 }))
    open(editTarget)
    expect(await screen.findByText('Cancelled. It stays on the board. No one can be added.')).toBeInTheDocument()
    expect(await overviewRow('Staff')).toHaveTextContent('0')
    await goTo('Staff')
    expect(await screen.findByText('No staff.')).toBeInTheDocument()
    expect(screen.queryByText(/Needs 2/)).toBeNull()
  })

  it('a read-only role sees the fields disabled, no adds, and only Close', async () => {
    open(editTarget, { canWrite: false })
    expect(await screen.findByText(/Only a SuperAdmin, Admin or Coordinator can change this/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel activity' })).toBeNull()
    await goTo('Details')
    expect(await screen.findByLabelText(/Notes/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('says it could not load, with Try again', async () => {
    get.mockRejectedValue(new Error('down'))
    open(editTarget)
    expect(await screen.findByText("Couldn't load this activity.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('GroupActivityModal attendance', () => {
  const mia = { participantId: 'participant-1', participantName: 'Mia Chen', ratio: 'OneToOne' as const, shiftIds: ['s1'], timesDiffer: false, didNotAttend: false }
  const sam = { participantId: 'participant-2', participantName: 'Sam Lee', ratio: 'OneToOne' as const, shiftIds: ['s2'], timesDiffer: false, didNotAttend: true }
  const started = (over: Parameters<typeof makeActivity>[0] = {}) => makeActivity({ status: 'InProgress', participants: [mia, sam], ...over })

  it("marks an attending participant as didn't attend, with no confirm, and hands focus to Undo", async () => {
    let current = started({ participants: [mia] })
    get.mockImplementation((url: string) => Promise.resolve(String(url).includes('/rostering/group-activities/') ? current : []))
    post.mockImplementation(() => { current = started({ participants: [{ ...mia, didNotAttend: true }] }); return Promise.resolve(current) })
    open(editTarget)
    await goTo('People')
    await userEvent.click(await screen.findByRole('button', { name: "Mark Mia Chen as didn't attend" }))
    expect(post).toHaveBeenCalledWith('/rostering/group-activities/activity-1/participants/participant-1/attendance', { attended: false })
    await waitFor(() => expect(screen.getByRole('button', { name: "Undo didn't attend for Mia Chen" })).toHaveFocus())
  })

  it("shows a didn't-attend row with its badge and a no-show line, and Undo sends attended: true", async () => {
    serve(started())
    post.mockResolvedValue(started())
    open(editTarget)
    await goTo('People')
    const row = (await screen.findByText('Sam Lee')).closest('[data-participant-row]') as HTMLElement
    expect(within(row).getByText("Didn't attend")).toBeInTheDocument()
    expect(within(row).getByText('Shift cancelled as a no-show.')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: "Undo didn't attend for Sam Lee" }))
    expect(post).toHaveBeenCalledWith('/rostering/group-activities/activity-1/participants/participant-2/attendance', { attended: true })
  })

  it('on a started activity offers neither Remove nor the ratio select, and says how attendance settles', async () => {
    serve(started())
    open(editTarget)
    await goTo('People')
    expect(await screen.findByText("Mark anyone who didn't attend. Everyone else is marked as attended when the last staff shift is approved.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove Mia Chen/ })).toBeNull()
    expect(screen.queryByLabelText('Ratio for Mia Chen')).toBeNull()
  })

  it('before the activity starts there is no attendance control and no helper line', async () => {
    serve(makeActivity({ status: 'Published', participants: [mia] }))
    open(editTarget)
    await goTo('People')
    expect(await screen.findByLabelText('Ratio for Mia Chen')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /didn't attend/i })).toBeNull()
    expect(screen.queryByText(/Mark anyone who didn't attend/)).toBeNull()
  })

  it("a completed activity shows Attended and Didn't attend badges and no buttons", async () => {
    serve(started({ status: 'Completed' }))
    open(editTarget)
    await goTo('People')
    const miaRow = (await screen.findByText('Mia Chen')).closest('[data-participant-row]') as HTMLElement
    expect(within(miaRow).getByText('Attended')).toBeInTheDocument()
    const samRow = screen.getByText('Sam Lee').closest('[data-participant-row]') as HTMLElement
    expect(within(samRow).getByText("Didn't attend")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /didn't attend/i })).toBeNull()
    expect(screen.queryByText(/Mark anyone who didn't attend/)).toBeNull()
  })

  it("shows the server's refusal under that row only and leaves the button usable again", async () => {
    serve(started({ participants: [mia, sam] }))
    const message = 'Attendance is final once every staff shift is approved.'
    post.mockRejectedValue({ response: { status: 409, data: { message, errors: [message] } } })
    open(editTarget)
    await goTo('People')
    await userEvent.click(await screen.findByRole('button', { name: "Undo didn't attend for Sam Lee" }))
    const samRow = screen.getByText('Sam Lee').closest('[data-participant-row]') as HTMLElement
    const miaRow = screen.getByText('Mia Chen').closest('[data-participant-row]') as HTMLElement
    expect(await within(samRow).findByText(message)).toBeInTheDocument()
    expect(within(miaRow).queryByText(message)).toBeNull()
    expect(screen.getAllByText(message)).toHaveLength(1)   // no second copy in a modal-level banner
    await waitFor(() => expect(screen.getByRole('button', { name: "Undo didn't attend for Sam Lee" })).toBeEnabled())
  })

  it('offline: the buttons are disabled and the page says attendance waits', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    serve(started({ participants: [mia] }))
    open(editTarget)
    await goTo('People')
    expect(await screen.findByRole('button', { name: "Mark Mia Chen as didn't attend" })).toBeDisabled()
    expect(screen.getByText("You're offline. Attendance changes wait until you're back.")).toBeInTheDocument()
    online.mockRestore()
  })
})
