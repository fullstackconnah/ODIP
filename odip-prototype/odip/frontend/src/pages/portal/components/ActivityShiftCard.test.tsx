import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ActivityShiftCard, ACTIVITY_START_MESSAGE, ACTIVITY_BREAK_PAIR_MESSAGE, ACTIVITY_BREAK_RANGE_MESSAGE } from './ActivityShiftCard'
import type { PortalActivityShiftDto } from '@/api/types'

const { startMutate, finishMutate, attendMutate, attendPending, online } = vi.hoisted(() => ({ startMutate: vi.fn(), finishMutate: vi.fn(), attendMutate: vi.fn(), attendPending: { value: false }, online: { value: true } }))

vi.mock('@/api/hooks', () => ({
  useStartActivityShift: () => ({ mutate: startMutate, isPending: false }),
  useFinishActivityShift: () => ({ mutate: finishMutate, isPending: false }),
  useSetActivityAttendance: () => ({ mutate: attendMutate, isPending: attendPending.value }),
}))
vi.mock('../shift/useOnline', () => ({ useOnline: () => online.value }))
vi.mock('../shift/geolocation', () => ({ requestGeolocation: () => Promise.resolve({ ok: false, cause: 'denied' }) }))
vi.mock('./ShiftNotesSection', () => ({ ShiftNotesSection: ({ shiftId }: { shiftId: string }) => <div>notes for {shiftId}</div> }))

const TZ = 'Australia/Sydney'
const NOW = new Date('2026-11-16T04:00:00Z')   // 3 pm in Sydney (AEDT)

const shift = (over: Partial<PortalActivityShiftDto> = {}): PortalActivityShiftDto => ({
  id: 'row-1', groupActivityId: 'ga-1', title: 'Bowling', serviceDate: '2026-11-16', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false,
  location: 'Strike Lanes', role: 'Driver', state: 'NotStarted', actualStart: null, actualEnd: null, breakStartedAt: null, breakEndedAt: null,
  participants: [{ shiftId: 's-1', participantId: 'p-1', name: 'Mia Chen', didNotAttend: false }, { shiftId: 's-2', participantId: 'p-2', name: 'Sam Lee', didNotAttend: false }],
  ...over,
})

const renderCard = (over: Partial<PortalActivityShiftDto> = {}) => render(<ActivityShiftCard shift={shift(over)} tz={TZ} now={NOW} />)

beforeEach(() => { startMutate.mockReset(); finishMutate.mockReset(); attendMutate.mockReset(); attendPending.value = false; online.value = true })

describe('ActivityShiftCard', () => {
  it('NotStarted before the planned end offers Start, which sends the declined flag when the phone gives no fix', async () => {
    renderCard()
    expect(screen.getByText('Not started')).toBeInTheDocument()
    expect(screen.getByText('Role: Driver')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(startMutate).toHaveBeenCalled())
    expect(startMutate.mock.calls[0][0]).toEqual({ id: 'row-1', data: { geolocationDeclined: true } })
  })

  it('Started shows the actual start and a Finish button; Finished and Approved show no button', () => {
    const { unmount } = renderCard({ state: 'Started', actualStart: '2026-11-15T22:02:00Z' })
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText(/Started 9:02 am/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument()
    unmount()
    renderCard({ state: 'Finished', actualStart: '2026-11-15T22:02:00Z', actualEnd: '2026-11-16T04:10:00Z', breakStartedAt: '2026-11-16T01:00:00Z', breakEndedAt: '2026-11-16T01:30:00Z' })
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument()
    expect(screen.getByText(/Finished 3:10 pm · break 30 min/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Start|Finish)$/ })).toBeNull()
  })

  it('NotStarted at or after the planned end offers Finish with a start time field', () => {
    renderCard({ endTime: '14:00:00' })
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.getByLabelText('Start time')).toBeInTheDocument()
  })

  it('a missing or future start is refused inline before anything is sent', () => {
    renderCard({ endTime: '14:00:00' })
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish shift' }))
    expect(screen.getByRole('alert')).toHaveTextContent(ACTIVITY_START_MESSAGE)
    expect(finishMutate).not.toHaveBeenCalled()
  })

  it('a break needs both times, and must sit inside the shift', () => {
    renderCard({ state: 'Started', actualStart: '2026-11-15T22:00:00Z' })
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add a break' }))
    fireEvent.change(screen.getByLabelText('Break start'), { target: { value: '2026-11-16T12:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Finish shift' }))
    expect(screen.getByRole('alert')).toHaveTextContent(ACTIVITY_BREAK_PAIR_MESSAGE)
    fireEvent.change(screen.getByLabelText('Break end'), { target: { value: '2026-11-16T11:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Finish shift' }))
    expect(screen.getByRole('alert')).toHaveTextContent(ACTIVITY_BREAK_RANGE_MESSAGE)
    expect(finishMutate).not.toHaveBeenCalled()
  })

  it('Finish sends the break as UTC instants', () => {
    renderCard({ state: 'Started', actualStart: '2026-11-15T22:00:00Z' })
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add a break' }))
    fireEvent.change(screen.getByLabelText('Break start'), { target: { value: '2026-11-16T12:00' } })
    fireEvent.change(screen.getByLabelText('Break end'), { target: { value: '2026-11-16T12:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Finish shift' }))
    expect(finishMutate.mock.calls[0][0]).toEqual({ id: 'row-1', data: { breakStart: '2026-11-16T01:00:00Z', breakEnd: '2026-11-16T01:30:00Z' } })
  })

  it('offline disables the button and says why', () => {
    online.value = false
    renderCard()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.getByText("You're offline. Start, finish and attendance need a connection.")).toBeInTheDocument()
  })

  it('participants are closed by default; one Notes section opens at a time', () => {
    renderCard()
    expect(screen.queryByText('Mia Chen')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Participants \(2\)/ }))
    const [first, second] = screen.getAllByRole('button', { name: 'Notes' })
    fireEvent.click(first)
    expect(screen.getByText('notes for s-1')).toBeInTheDocument()
    fireEvent.click(second)
    expect(screen.queryByText('notes for s-1')).toBeNull()
    expect(screen.getByText('notes for s-2')).toBeInTheDocument()
  })

  it('a refused Start shows the server message under the button', async () => {
    renderCard()
    startMutate.mockImplementation((_v, opts) => opts.onError({ response: { status: 409, data: { message: 'This group activity is cancelled.', code: 'GA_CANCELLED' } } }))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This group activity is cancelled.')
  })
})

describe('ActivityShiftCard attendance', () => {
  const started = (people: PortalActivityShiftDto['participants'] = shift().participants) => renderCard({ state: 'Started', actualStart: '2026-11-15T22:02:00Z', participants: people })
  const open = () => fireEvent.click(screen.getByRole('button', { name: /Participants/ }))
  const person = (name: string, didNotAttend: boolean, i: number) => ({ shiftId: 's-' + i, participantId: 'p-' + i, name, didNotAttend })
  const badge = { selector: '[data-status-badge]' }

  it("a Started row offers Didn't attend for each person, named for them, and sends the participant on a tap", () => {
    started(); open()
    fireEvent.click(screen.getByRole('button', { name: "Mark Sam Lee as didn't attend" }))
    expect(attendMutate.mock.calls[0][0]).toEqual({ id: 'row-1', participantId: 'p-2', attended: false })
    expect(screen.getAllByRole('button', { name: /Mark .* as didn't attend/ })).toHaveLength(2)
  })

  it('a marked person shows the badge and Undo, and Undo sends attended true', () => {
    started([person('Mia Chen', true, 1)]); open()
    expect(screen.getByText("Didn't attend", badge)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: "Undo didn't attend for Mia Chen" }))
    expect(attendMutate.mock.calls[0][0]).toEqual({ id: 'row-1', participantId: 'p-1', attended: true })
  })

  it('a mark is announced once the server has answered, and the badge is not flipped before', () => {
    started([person('Mia Chen', false, 1)]); open()
    attendMutate.mockImplementation((_v, opts) => opts.onSuccess())
    fireEvent.click(screen.getByRole('button', { name: "Mark Mia Chen as didn't attend" }))
    expect(screen.getByRole('status')).toHaveTextContent("Marked Mia Chen as didn't attend.")
    expect(screen.queryByText("Didn't attend", badge)).toBeNull()
  })

  it('while saving the button says Saving and ignores taps', () => {
    attendPending.value = true
    started(); open()
    const button = screen.getAllByRole('button', { name: /Mark .* as didn't attend/ })[0]
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(attendMutate).not.toHaveBeenCalled()
  })

  it('a refusal shows the server words under that row only', () => {
    started(); open()
    attendMutate.mockImplementation((_v, opts) => opts.onError({ response: { status: 409, data: { message: 'Your coordinator needs to change this.', code: 'GA_SHIFT_LOCKED' } } }))
    fireEvent.click(screen.getByRole('button', { name: "Mark Mia Chen as didn't attend" }))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('Your coordinator needs to change this.')
  })

  it('with no server words a failure names the first name', () => {
    started(); open()
    attendMutate.mockImplementation((_v, opts) => opts.onError(new Error('network')))
    fireEvent.click(screen.getByRole('button', { name: "Mark Mia Chen as didn't attend" }))
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't mark Mia as didn't attend.")
  })

  it('offline disables every attendance button', () => {
    online.value = false
    started(); open()
    for (const b of screen.getAllByRole('button', { name: /Mark .* as didn't attend/ })) expect(b).toBeDisabled()
  })

  it.each(['NotStarted', 'Finished', 'Approved'] as const)('a %s card has no attendance button, but still shows a mark', state => {
    renderCard({ state, participants: [person('Mia Chen', true, 1), person('Sam Lee', false, 2)] }); open()
    expect(screen.queryByRole('button', { name: /didn't attend/ })).toBeNull()
    expect(screen.getAllByText("Didn't attend", badge)).toHaveLength(1)
  })

  it('Notes is hidden on a marked person (the server has no notes for them) and returns after Undo', () => {
    const { rerender } = started([person('Mia Chen', true, 1)]); open()
    expect(screen.queryByRole('button', { name: 'Notes' })).toBeNull()
    rerender(<ActivityShiftCard shift={shift({ state: 'Started', actualStart: '2026-11-15T22:02:00Z', participants: [person('Mia Chen', false, 1)] })} tz={TZ} now={NOW} />)
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument()
  })

  it('a long name wraps rather than truncating', () => {
    started([person('Annabelle-Louise Featherstonehaugh-Smyth', false, 1)]); open()
    expect(screen.getByText('Annabelle-Louise Featherstonehaugh-Smyth').className).not.toMatch(/truncate/)
  })
})
