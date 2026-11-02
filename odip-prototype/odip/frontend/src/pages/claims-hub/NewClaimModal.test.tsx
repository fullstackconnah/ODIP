import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TripDetailDto, TripListDto } from '@/api/types'
import { NewClaimModal } from './NewClaimModal'

// The "New claim" chooser: what each row says, and how a trip is picked. The two modals it launches have their own tests.

const m = vi.hoisted(() => ({ waiting: vi.fn(), trips: vi.fn(), trip: vi.fn() }))
vi.mock('@/api/hooks/claimHub', () => ({ useUnclaimedShifts: m.waiting }))
vi.mock('@/api/hooks/trips', () => ({ useTrips: m.trips, useTrip: m.trip }))

const trip = (over: Partial<TripListDto> = {}): TripListDto => ({
  id: 't-1', tripName: 'Byron Bay Weekend', tripCode: null, destination: null, region: null, startDate: '2026-10-09', endDate: '2026-10-11',
  durationDays: 3, status: 'Completed', maxParticipants: null, currentParticipantCount: 4, waitlistCount: 0, leadCoordinatorName: null, ...over,
})
const list = (data: TripListDto[] | undefined, over: object = {}) => ({ data, isLoading: false, isError: false, refetch: vi.fn(), ...over })
const one = (data?: object, over: object = {}) => ({ data, isLoading: false, isError: false, refetch: vi.fn(), ...over })

function setup() {
  const props = { onShifts: vi.fn(), onTrip: vi.fn<(t: TripDetailDto) => void>(), onClose: vi.fn() }
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
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NewClaimModal: the chooser', () => {
  it('offers Shifts and A trip with their hints and what is waiting', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'New claim' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shifts Completed shifts in a date range 12 waiting' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A trip A completed trip with no claim 2 waiting' })).toBeInTheDocument()
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
