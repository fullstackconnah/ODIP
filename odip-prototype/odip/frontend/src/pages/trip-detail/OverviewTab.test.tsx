import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OverviewTab from './OverviewTab'
import { TAP_AREA } from '@/components/tapArea'
import type { TripDetailDto } from '@/api/types/trips'
import type { BookingListDto } from '@/api/types/bookings'
import type { StaffAssignmentDto } from '@/api/types/staff'

// The itinerary is its own suite and pulls in data hooks; the side panel is what this file exercises.
vi.mock('@/components/ItineraryTab', () => ({ default: () => <div>Itinerary</div> }))
vi.mock('@/api/hooks', () => ({
  PAYMENT_STATUS_ITEMS: [{ value: 'Paid', label: 'Paid' }],
  PAYMENT_STATUS_COLORS: { Paid: 'bg-[var(--color-muted)]' },
}))

const trip = { id: 'trip-1', tripName: 'Beach Getaway' } as unknown as TripDetailDto
const bookings = [1, 2].map(i => ({ id: `b${i}`, participantName: `Participant ${i}`, bookingStatus: 'Confirmed', paymentStatus: 'Paid' })) as unknown as BookingListDto[]
const staff = [1, 2, 3, 4].map(i => ({ id: `s${i}`, staffName: `Staff Person ${i}`, assignmentRole: 'Support Worker', isDriver: false })) as unknown as StaffAssignmentDto[]

function renderTab(onSwitchTab = vi.fn()) {
  render(<OverviewTab tripId="trip-1" trip={trip} bookings={bookings} accommodation={[]} staff={staff} vehicles={[]} onSwitchTab={onSwitchTab} />)
  return onSwitchTab
}

// Density verdict, touch: "Manage All" is a 16px text button and the three roster call icons are 24px squares.
// Under `pointer: coarse` each carries the TAP_AREA pad (a 44px hit area centred on it) without growing.
describe('OverviewTab — 44px coarse-pointer hit areas', () => {
  const pad = TAP_AREA.split(' ')

  it('pads the "Manage All" team button and keeps its text styling', () => {
    renderTab()
    expect(screen.getByRole('button', { name: 'Manage All' })).toHaveClass(...pad, 'text-xs', 'font-bold', 'text-[var(--color-primary)]')
  })

  it('still switches to the bookings tab from the padded button', async () => {
    const user = userEvent.setup()
    const onSwitchTab = renderTab()
    await user.click(screen.getByRole('button', { name: 'Manage All' }))
    expect(onSwitchTab).toHaveBeenCalledWith('bookings')
  })

  it('pads each roster call button and leaves it the 24px circle it was', () => {
    renderTab()
    const calls = screen.getAllByRole('button', { name: 'call' })
    // The roster shows the first three of four staff.
    expect(calls).toHaveLength(3)
    for (const call of calls) expect(call).toHaveClass(...pad, 'w-6', 'h-6', 'shrink-0', 'rounded-full')
  })

  it('does not pad the full-width "+N more" row buttons: they are already wide and sit close to the rows above', () => {
    renderTab()
    const more = screen.getByRole('button', { name: /\+1 more staff assigned/ })
    expect(more.className).not.toContain('before:')
  })
})
