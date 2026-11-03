import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TripDetailDto, TripListDto } from '@/api/types'
import { NewClaimModal } from './NewClaimModal'

// The "New claim" chooser: what each row says, and how a trip is picked. The two modals it launches have their own tests.

const m = vi.hoisted(() => ({ waiting: vi.fn(), trips: vi.fn(), trip: vi.fn(), cancellations: vi.fn(), previewCancellation: vi.fn(), makeCancellation: vi.fn(), previewManual: vi.fn(), makeManual: vi.fn(), participants: vi.fn(), participant: vi.fn(), provider: vi.fn(), catalogue: vi.fn() }))
vi.mock('@/api/hooks/claimHub', () => ({
  useUnclaimedShifts: m.waiting,
  useCancellationCandidates: m.cancellations,
  usePreviewCancellationClaim: m.previewCancellation,
  useMakeCancellationClaim: m.makeCancellation,
  usePreviewManualClaim: m.previewManual,
  useMakeManualClaim: m.makeManual,
}))
vi.mock('@/api/hooks', () => ({ useParticipants: m.participants, useParticipant: m.participant, useProviderSettings: m.provider, useSupportCatalogue: m.catalogue }))
vi.mock('@/api/hooks/trips', () => ({ useTrips: m.trips, useTrip: m.trip }))

const trip = (over: Partial<TripListDto> = {}): TripListDto => ({
  id: 't-1', tripName: 'Byron Bay Weekend', tripCode: null, destination: null, region: null, startDate: '2026-10-09', endDate: '2026-10-11',
  durationDays: 3, status: 'Completed', maxParticipants: null, currentParticipantCount: 4, waitlistCount: 0, leadCoordinatorName: null, ...over,
})
const list = (data: TripListDto[] | undefined, over: object = {}) => ({ data, isLoading: false, isError: false, refetch: vi.fn(), ...over })
const one = (data?: object, over: object = {}) => ({ data, isLoading: false, isError: false, refetch: vi.fn(), ...over })

const cancelled = (n: number) => ({
  data: {
    shifts: Array.from({ length: n }, (_, i) => ({
      shiftId: `sh-${i}`, participantId: 'p-1', participantName: i === 0 ? 'Sam Lee' : `Jo Park ${i}`, serviceDate: '2026-10-20', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false,
      cancelledAt: '2026-10-17T01:30:00Z', totalAmount: 480,
    })),
    leftOut: [],
  },
  isLoading: false, isError: false, refetch: vi.fn(),
})
const mutation = () => ({ mutate: vi.fn(), reset: vi.fn(), data: undefined, error: null, isPending: false, isError: false })

function setup() {
  const props = { onShifts: vi.fn(), onTrip: vi.fn<(t: TripDetailDto) => void>(), onCancellationMade: vi.fn(), onManualMade: vi.fn(), onClose: vi.fn() }
  const view = render(<NewClaimModal {...props} />)
  return { ...props, view }
}

async function pickByron() {
  await userEvent.click(screen.getByRole('button', { name: /^A trip/ }))
  await userEvent.click(screen.getByLabelText('Trip'))
  await userEvent.click(await screen.findByRole('option', { name: /Byron Bay Weekend/ }))
}

beforeEach(() => {
  m.waiting.mockReturnValue({ count: 12, participants: 3, loading: false, error: false })
  m.trips.mockReturnValue(list([trip(), trip({ id: 't-2', tripName: 'Gold Coast Day', startDate: '2026-10-02', endDate: '2026-10-02', durationDays: 1, currentParticipantCount: 1 })]))
  m.trip.mockReturnValue(one())
  m.cancellations.mockReturnValue(cancelled(3))
  m.previewCancellation.mockReturnValue(mutation())
  m.makeCancellation.mockReturnValue(mutation())
  m.previewManual.mockReturnValue(mutation())
  m.makeManual.mockReturnValue(mutation())
  m.participants.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
  m.participant.mockReturnValue({ data: undefined })
  m.provider.mockReturnValue({ data: undefined })
  m.catalogue.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NewClaimModal: the chooser', () => {
  it('offers Shifts, A trip, A cancellation and A one-off claim, in that order, with their hints and what is waiting', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'New claim' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shifts Completed shifts in a date range 12 waiting' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A trip A completed trip with no claim 2 waiting' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A cancellation A cancelled shift at short notice 3 waiting' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A one-off claim Any catalogue item and amount' })).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem').map(li => within(li).getByRole('button').textContent ?? '')
    expect(rows.map(r => ['Shifts', 'A trip', 'A cancellation', 'A one-off claim'].findIndex(t => r.startsWith(t)))).toEqual([0, 1, 2, 3])
  })

  it('disables the cancellation row when none is waiting: focusable, with its reason, and activating it does nothing', async () => {
    m.cancellations.mockReturnValue(cancelled(0))
    setup()
    const row = screen.getByRole('button', { name: 'A cancellation No short-notice cancellations to claim' })
    expect(row).toHaveAttribute('aria-disabled', 'true')
    row.focus()
    expect(row).toHaveFocus()
    await userEvent.click(row)
    expect(screen.getByRole('dialog', { name: 'New claim' })).toBeInTheDocument()
  })

  it('draws no cancellation count while the list loads or has failed, and the row still opens the step', async () => {
    m.cancellations.mockReturnValue({ ...cancelled(0), data: undefined, isLoading: true })
    const first = setup()
    expect(screen.getByRole('button', { name: /^A cancellation/ })).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('button', { name: /^A cancellation/ })).not.toHaveTextContent('waiting')
    first.view.unmount()

    m.cancellations.mockReturnValue({ ...cancelled(0), data: undefined, isError: true })
    setup()
    const row = screen.getByRole('button', { name: /^A cancellation/ })
    expect(row).not.toHaveAttribute('aria-disabled')
    await userEvent.click(row)
    expect(screen.getByRole('dialog', { name: 'Choose a cancelled shift' })).toBeInTheDocument()
  })

  it('puts focus on the first row', () => {
    setup()
    expect(screen.getByRole('button', { name: /^Shifts/ })).toHaveFocus()
  })

  it('says None waiting at 0 and keeps the Shifts row live', async () => {
    m.waiting.mockReturnValue({ count: 0, participants: 0, loading: false, error: false })
    const { onShifts } = setup()
    expect(screen.getByText('None waiting')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Shifts/ }))
    expect(onShifts).toHaveBeenCalledTimes(1)
  })

  it('draws no count while the figure loads or has failed, and the row still works', async () => {
    m.waiting.mockReturnValue({ count: 0, participants: 0, loading: true, error: false })
    const first = setup()
    expect(screen.queryByText('None waiting')).toBeNull()
    expect(screen.getByRole('button', { name: /^Shifts/ })).not.toHaveAttribute('aria-disabled')
    first.view.unmount()

    m.waiting.mockReturnValue({ count: 0, participants: 0, loading: false, error: true })
    const { onShifts } = setup()
    expect(screen.queryByText('None waiting')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Shifts/ }))
    expect(onShifts).toHaveBeenCalled()
  })

  it('asks the server only for completed trips with no claim', () => {
    setup()
    expect(m.trips).toHaveBeenCalledWith({ status: 'Completed', unclaimed: 'true' })
  })

  it('disables the trip row when none is waiting: focusable, with its reason, and activating it does nothing', async () => {
    m.trips.mockReturnValue(list([]))
    setup()
    const row = screen.getByRole('button', { name: 'A trip No completed trips are waiting' })
    expect(row).toHaveAttribute('aria-disabled', 'true')
    row.focus()
    expect(row).toHaveFocus()
    await userEvent.click(row)
    expect(screen.getByRole('dialog', { name: 'New claim' })).toBeInTheDocument()
  })
})

describe('NewClaimModal: the trip step', () => {
  it('lists the trips in the server order, each with its dates and participants', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^A trip/ }))
    expect(screen.getByRole('dialog', { name: 'Choose a trip' })).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Trip'))
    expect(await screen.findByRole('option', { name: /Byron Bay Weekend/ })).toHaveTextContent('9–11 Oct 2026 · 4 participants')
    expect(screen.getByRole('option', { name: /Gold Coast Day/ })).toHaveTextContent('2 Oct 2026 · 1 participant')
  })

  it('holds Continue until a trip is chosen, then loads that trip and passes it on', async () => {
    const { onTrip } = setup()
    await userEvent.click(screen.getByRole('button', { name: /^A trip/ }))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    await userEvent.click(screen.getByLabelText('Trip'))
    await userEvent.click(await screen.findByRole('option', { name: /Byron Bay Weekend/ }))
    m.trip.mockImplementation((id?: string) => one(id ? { id } : undefined))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(m.trip).toHaveBeenLastCalledWith('t-1')
    await waitFor(() => expect(onTrip).toHaveBeenCalledWith({ id: 't-1' }))
  })

  it('shows Opening… while the trip loads', async () => {
    setup()
    await pickByron()
    m.trip.mockReturnValue(one(undefined, { isLoading: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('button', { name: 'Opening…' })).toHaveAttribute('aria-busy', 'true')
  })

  it('names the trip when it cannot be opened, and lets Continue try again', async () => {
    setup()
    await pickByron()
    const refetch = vi.fn()
    m.trip.mockReturnValue(one(undefined, { isError: true, refetch }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText("Couldn't open Byron Bay Weekend. Try again.")).toBeInTheDocument()
    const again = screen.getByRole('button', { name: 'Continue' })
    expect(again).toBeEnabled()
    await userEvent.click(again)
    expect(refetch).toHaveBeenCalled()
  })

  it('shows an error with retry in place of the field when the list cannot load', async () => {
    const refetch = vi.fn()
    m.trips.mockReturnValue(list(undefined, { isError: true, refetch }))
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^A trip/ }))
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('Back returns to the chooser with focus on the A trip row', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^A trip/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('dialog', { name: 'New claim' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^A trip/ })).toHaveFocus()
  })
})

describe('NewClaimModal: the cancellation step', () => {
  it('opens the cancelled-shift step from the A cancellation row', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^A cancellation/ }))
    expect(screen.getByRole('dialog', { name: 'Choose a cancelled shift' })).toBeInTheDocument()
  })

  it('Back returns to the chooser with focus on the A cancellation row', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^A cancellation/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('dialog', { name: 'New claim' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^A cancellation/ })).toHaveFocus()
  })

  it('closing from the cancellation step returns focus to the button that opened the chooser', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { onClose } = setup()
    onClose.mockImplementation(() => cleanup())
    await userEvent.click(screen.getByRole('button', { name: /^A cancellation/ }))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('closing the chooser after Back from the cancellation step returns focus to the opener', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { onClose } = setup()
    onClose.mockImplementation(() => cleanup())
    await userEvent.click(screen.getByRole('button', { name: /^A cancellation/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('hands the made claim to the page', async () => {
    const make = mutation()
    make.mutate.mockImplementation((_vars: unknown, options?: { onSuccess?: (created: { id: string }) => void }) => options?.onSuccess?.({ id: 'claim-9' }))
    m.makeCancellation.mockReturnValue(make)
    m.previewCancellation.mockReturnValue({ ...mutation(), data: { totalAmount: 480, lineItems: [], leftOut: [] } })
    const { onCancellationMade } = setup()
    await userEvent.click(screen.getByRole('button', { name: /^A cancellation/ }))
    await userEvent.click(screen.getByLabelText('Cancelled shift'))
    await userEvent.click(await screen.findByRole('option', { name: /Sam Lee/ }))
    await userEvent.click(screen.getByLabelText('Why did the participant cancel?'))
    await userEvent.click(await screen.findByRole('option', { name: 'Other' }))
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await userEvent.click(screen.getByRole('button', { name: 'Make claim' }))
    expect(onCancellationMade).toHaveBeenCalledWith('claim-9')
  })
})

describe('NewClaimModal: the one-off claim step', () => {
  it('opens the one-off claim step from the A one-off claim row, always enabled', async () => {
    setup()
    const row = screen.getByRole('button', { name: /^A one-off claim/ })
    expect(row).not.toHaveAttribute('aria-disabled')
    await userEvent.click(row)
    expect(screen.getByRole('dialog', { name: 'A one-off claim' })).toBeInTheDocument()
  })

  it('Back returns to the chooser with focus on the A one-off claim row', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^A one-off claim/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('dialog', { name: 'New claim' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^A one-off claim/ })).toHaveFocus()
  })

  it('closing from the step returns focus to the button that opened the chooser', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { onClose } = setup()
    onClose.mockImplementation(() => cleanup())
    await userEvent.click(screen.getByRole('button', { name: /^A one-off claim/ }))
    // The first Escape closes the participant list that opens with the focus; the second closes the dialog.
    await userEvent.keyboard('{Escape}{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
