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
    get.mockImplementation((url: string) => Promise.resolve(String(url).includes('/rostering/group-activities/') ? makeActivity({ participants: [{ participantId: 'participant-1', participantName: 'Mia Chen', ratio: 'TwoToOne', shiftIds: ['a', 'b'], timesDiffer: false }] }) : []))
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
