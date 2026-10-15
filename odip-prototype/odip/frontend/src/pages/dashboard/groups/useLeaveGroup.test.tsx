import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderGroup, announcement, facts, headers, subjects } from './groupHarness'
import { overlapNotice, useLeaveGroup } from './useLeaveGroup'
import type { RosterFindingDto } from '@/api/hooks'

// The hooks barrel re-exports the sign-in hooks, which read Firebase env at import; none of it is used here.
vi.mock('@/lib/firebase', () => ({ auth: null, devAuthEnabled: true }))
const { apiGetWithDefault, apiPost } = vi.hoisted(() => ({ apiGetWithDefault: vi.fn(), apiPost: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGetWithDefault, apiPost }))

const leave = (o: Record<string, unknown> = {}) => ({
  id: 'l1', userId: 'u-sam', userFullName: 'Sam Lee', leaveType: 'Annual', startDate: '2026-10-20', endDate: '2026-10-24', status: 'Pending',
  reason: 'Family wedding', requestedByUserId: 'u-sam', requestedAt: '2026-10-01T00:00:00Z', decidedByUserId: null, decidedAt: null, decisionNote: null, ...o,
})
const rule = (o: Record<string, unknown> = {}) => ({
  id: 'r1', userId: 'u-mei', userFullName: 'Mei Zhang', dayOfWeek: 'Tuesday', startTime: '09:00:00', endTime: '12:00:00', effectiveFrom: '2026-10-21',
  effectiveTo: null, notes: null, status: 'Pending', requestedByUserId: 'u-mei', requestedAt: '2026-10-01T00:00:00Z', decidedByUserId: null, decidedAt: null, decisionNote: null, ...o,
})
const shift = (serviceDate: string, participantId = 'p-1') =>
  ({ shiftId: `s-${serviceDate}`, serviceDate, startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false, participantId, participantName: 'Grace Palmer-Hughes' })
const finding = (code: string): RosterFindingDto => ({ code, severity: 'Warning', message: 'Overlaps.', requiresReason: false })
const answer = (leaveRows: unknown[], rules: unknown[] = []) =>
  apiGetWithDefault.mockImplementation((url: string) => Promise.resolve(url === '/leave' ? leaveRows : rules))
const refusal = (message: string) => ({ response: { data: { message } } })

beforeEach(() => {
  apiGetWithDefault.mockReset()
  apiPost.mockReset()
})

describe('Leave group — what it reads', () => {
  it("reads the nav badge's own pending requests, under its cache keys, and merges them soonest start first", async () => {
    answer([leave(), leave({ id: 'l2', userFullName: 'Ana Ruiz', startDate: '2026-10-15', endDate: '2026-10-15', reason: null })], [rule()])
    const { client } = renderGroup(() => useLeaveGroup(true, 'u-viewer'))

    await screen.findByText('Sam Lee')
    expect(apiGetWithDefault).toHaveBeenCalledWith('/leave', [], { status: 'Pending' })
    expect(apiGetWithDefault).toHaveBeenCalledWith('/leave/unavailability', [], { status: 'Pending' })
    expect(client.getQueryCache().find({ queryKey: ['leave-requests', { status: 'Pending' }], exact: true })).toBeDefined()
    expect(subjects()).toEqual(['Ana Ruiz', 'Sam Lee', 'Mei Zhang'])
    expect(headers()).toEqual(['Staff', 'Type', 'Dates', 'Note', ''])
    expect(facts('Sam Lee')).toEqual(['Annual leave', '20–24 Oct 2026, 5 days', '“Family wedding”'])
    expect(facts('Ana Ruiz')).toEqual(['Annual leave', '15 Oct 2026, 1 day', '—'])
    // The Leave page's word for a rule, and its notes (fetched, not drawn before).
    expect(facts('Mei Zhang')).toEqual(['Regular unavailability', 'Tuesdays, 9am – 12pm, from 21 Oct', '—'])
    expect(screen.getByRole('tab', { name: 'Leave (3)' })).toBeInTheDocument()
  })

  it('draws an unavailability rule’s notes in the Note column', async () => {
    answer([], [rule({ notes: 'School pick-up' })])
    renderGroup(() => useLeaveGroup(true, 'u-viewer'))

    await screen.findByText('Mei Zhang')
    expect(facts('Mei Zhang')[2]).toBe('“School pick-up”')
  })

  it('never shows clear while a list failed: it says so, with Try again', async () => {
    apiGetWithDefault.mockImplementation((url: string) => (url === '/leave' ? Promise.reject(new Error('down')) : Promise.resolve([])))
    renderGroup(() => useLeaveGroup(true, 'u-viewer'))

    expect(await screen.findByText("Couldn't load leave requests.")).toBeInTheDocument()
  })
})

describe('Leave group — your own request', () => {
  it('shows "Your request" and no buttons on a request whose person is the viewer; one the viewer raised for someone else stays decidable', async () => {
    answer([leave(), leave({ id: 'l2', userId: 'u-ana', userFullName: 'Ana Ruiz', requestedByUserId: 'u-sam' })])
    renderGroup(() => useLeaveGroup(true, 'u-sam'))

    const own = (await screen.findByText('Sam Lee')).closest('tbody')!
    expect(within(own).getByText('Your request')).toBeInTheDocument()
    expect(within(own).queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Approve leave: Ana Ruiz, 20–24 Oct 2026' })).toBeInTheDocument()
  })
})

describe('Leave group — Approve', () => {
  it('approves through useApproveLeave, takes the row away and announces it', async () => {
    answer([leave()])
    apiPost.mockResolvedValue({ leave: leave({ status: 'Approved' }), overlaps: [], overlapShifts: [] })
    renderGroup(() => useLeaveGroup(true, 'u-viewer'))

    fireEvent.click(await screen.findByRole('button', { name: 'Approve leave: Sam Lee, 20–24 Oct 2026' }))

    await waitFor(() => expect(announcement()).toHaveTextContent("Approved Sam Lee's leave, 20–24 Oct 2026."))
    expect(apiPost).toHaveBeenCalledWith('/leave/l1/approve')
    expect(screen.queryByText('Sam Lee')).not.toBeInTheDocument()
  })

  it('never swallows overlaps: a notice names the shifts with their cover tasks and the trips, and opens the roster at the first one', async () => {
    answer([leave()])
    apiPost.mockResolvedValue({
      leave: leave({ status: 'Approved' }),
      overlaps: [finding('SHIFT_OVERLAP'), finding('SHIFT_OVERLAP'), finding('TRIP_OVERLAP')],
      overlapShifts: [shift('2026-10-22'), shift('2026-10-21')],
    })
    renderGroup(() => useLeaveGroup(true, 'u-viewer'))

    fireEvent.click(await screen.findByRole('button', { name: 'Approve leave: Sam Lee, 20–24 Oct 2026' }))

    expect(await screen.findByText('Leave approved. It overlaps 2 shifts, and each one has a cover task. It also overlaps 1 trip.')).toBeInTheDocument()
    // 21 Oct 2026 is a Wednesday: the board opens at its Monday, filtered to the one participant both shifts are for.
    expect(screen.getByRole('link', { name: 'Open roster' })).toHaveAttribute('href', '/rostering?date=2026-10-19&participant=p-1')
    expect(announcement()).toHaveTextContent('')
  })

  it("keeps the row and says the server's words when somebody else decided it first", async () => {
    answer([leave()])
    apiPost.mockRejectedValue(refusal('This request has already been decided.'))
    renderGroup(() => useLeaveGroup(true, 'u-viewer'))

    fireEvent.click(await screen.findByRole('button', { name: 'Approve leave: Sam Lee, 20–24 Oct 2026' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This request has already been decided.')
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()
    expect(apiPost).toHaveBeenCalledTimes(1)
  })
})

describe('Leave group — Decline', () => {
  it('declines through useDeclineLeave with the trimmed note, as the Leave page sends it', async () => {
    answer([leave()])
    apiPost.mockResolvedValue(leave({ status: 'Declined' }))
    renderGroup(() => useLeaveGroup(true, 'u-viewer'))

    fireEvent.click(await screen.findByRole('button', { name: 'Decline leave: Sam Lee, 20–24 Oct 2026' }))
    expect(screen.getByText('Sam sees this.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: '  Short-staffed that week  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Decline request' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/leave/l1/decline', { decisionNote: 'Short-staffed that week' }))
    await waitFor(() => expect(announcement()).toHaveTextContent("Declined Sam Lee's leave, 20–24 Oct 2026."))
  })

  it('sends a blank note as the Leave page does (the server stores null)', async () => {
    answer([leave()])
    apiPost.mockResolvedValue(leave({ status: 'Declined' }))
    renderGroup(() => useLeaveGroup(true, 'u-viewer'))

    fireEvent.click(await screen.findByRole('button', { name: 'Decline leave: Sam Lee, 20–24 Oct 2026' }))
    fireEvent.click(screen.getByRole('button', { name: 'Decline request' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/leave/l1/decline', { decisionNote: '' }))
  })
})

describe('Leave group — unavailability', () => {
  it('approves through useApproveUnavailability, and its overlap notice promises no cover task (the server raises none)', async () => {
    answer([], [rule()])
    apiPost.mockResolvedValue({ unavailability: rule({ status: 'Approved' }), overlaps: [finding('SHIFT_OVERLAP')], overlapShifts: [shift('2026-10-27')] })
    renderGroup(() => useLeaveGroup(true, 'u-viewer'))

    fireEvent.click(await screen.findByRole('button', { name: 'Approve unavailability: Mei Zhang, Tuesdays' }))

    expect(await screen.findByText('Unavailability approved. It overlaps 1 shift.')).toBeInTheDocument()
    expect(apiPost).toHaveBeenCalledWith('/leave/unavailability/r1/approve')
  })

  it('declines through useDeclineUnavailability with the trimmed note', async () => {
    answer([], [rule()])
    apiPost.mockResolvedValue(rule({ status: 'Declined' }))
    renderGroup(() => useLeaveGroup(true, 'u-viewer'))

    fireEvent.click(await screen.findByRole('button', { name: 'Decline unavailability: Mei Zhang, Tuesdays' }))
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: ' Clashes with training ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Decline request' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/leave/unavailability/r1/decline', { decisionNote: 'Clashes with training' }))
  })
})

describe('overlapNotice', () => {
  it('is null when nothing overlaps, and opens the whole board when the shifts are for several participants', () => {
    expect(overlapNotice('leave', 'Sam Lee', { overlaps: [], overlapShifts: [] })).toBeNull()
    const notice = overlapNotice('leave', 'Sam Lee', {
      overlaps: [finding('SHIFT_OVERLAP'), finding('SHIFT_OVERLAP')], overlapShifts: [shift('2026-10-21', 'p-1'), shift('2026-10-22', 'p-2')],
    })
    expect(notice).toEqual({ title: 'Sam Lee', message: 'Leave approved. It overlaps 2 shifts, and each one has a cover task.', link: { label: 'Open roster', to: '/rostering' } })
  })

  it('says one shift in the singular, and names trips alone when no shift overlaps', () => {
    expect(overlapNotice('leave', 'Sam Lee', { overlaps: [finding('SHIFT_OVERLAP')], overlapShifts: [shift('2026-10-21')] })!.message)
      .toBe('Leave approved. It overlaps 1 shift, and it has a cover task.')
    expect(overlapNotice('leave', 'Sam Lee', { overlaps: [finding('TRIP_OVERLAP')], overlapShifts: [] })!.message)
      .toBe('Leave approved. It overlaps 1 trip.')
  })

  it('reads a response without overlapShifts as no shifts: never a throw after the server has approved', () => {
    expect(overlapNotice('leave', 'Sam Lee', { overlaps: [finding('SHIFT_OVERLAP')] } as never)!.message).toBe('Leave approved. It overlaps the roster.')
  })
})
