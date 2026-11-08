import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ActivityShiftCard, ACTIVITY_START_MESSAGE, ACTIVITY_BREAK_PAIR_MESSAGE, ACTIVITY_BREAK_RANGE_MESSAGE } from './ActivityShiftCard'
import type { PortalActivityShiftDto } from '@/api/types'

const { startMutate, finishMutate, online } = vi.hoisted(() => ({ startMutate: vi.fn(), finishMutate: vi.fn(), online: { value: true } }))

vi.mock('@/api/hooks', () => ({
  useStartActivityShift: () => ({ mutate: startMutate, isPending: false }),
  useFinishActivityShift: () => ({ mutate: finishMutate, isPending: false }),
}))
vi.mock('../shift/useOnline', () => ({ useOnline: () => online.value }))
vi.mock('../shift/geolocation', () => ({ requestGeolocation: () => Promise.resolve({ ok: false, cause: 'denied' }) }))
vi.mock('./ShiftNotesSection', () => ({ ShiftNotesSection: ({ shiftId }: { shiftId: string }) => <div>notes for {shiftId}</div> }))

const TZ = 'Australia/Sydney'
const NOW = new Date('2026-11-16T04:00:00Z')   // 3 pm in Sydney (AEDT)

const shift = (over: Partial<PortalActivityShiftDto> = {}): PortalActivityShiftDto => ({
  id: 'row-1', groupActivityId: 'ga-1', title: 'Bowling', serviceDate: '2026-11-16', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false,
  location: 'Strike Lanes', role: 'Driver', state: 'NotStarted', actualStart: null, actualEnd: null, breakStartedAt: null, breakEndedAt: null,
  participants: [{ shiftId: 's-1', participantId: 'p-1', name: 'Mia Chen' }, { shiftId: 's-2', participantId: 'p-2', name: 'Sam Lee' }],
  ...over,
})

const renderCard = (over: Partial<PortalActivityShiftDto> = {}) => render(<ActivityShiftCard shift={shift(over)} tz={TZ} now={NOW} />)

beforeEach(() => { startMutate.mockReset(); finishMutate.mockReset(); online.value = true })

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
    expect(screen.getByText("You're offline. Start and finish need a connection.")).toBeInTheDocument()
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
