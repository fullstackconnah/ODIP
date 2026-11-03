import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OverviewTab from './OverviewTab'
import { TAP_AREA } from '@/components/tapArea'
import type { TripDetailDto } from '@/api/types/trips'
import type { BookingListDto } from '@/api/types/bookings'
import type { ReservationDto } from '@/api/types/reservations'
import type { VehicleAssignmentDto } from '@/api/types/vehicles'

// The itinerary is its own suite and pulls in data hooks; the side panel is what this file exercises.
vi.mock('@/components/ItineraryTab', () => ({ default: () => <div>Itinerary</div> }))
vi.mock('@/api/hooks', () => ({
  PAYMENT_STATUS_ITEMS: [{ value: 'InvoiceSent', label: 'Invoice Sent' }, { value: 'Paid', label: 'Paid' }],
}))

const trip = {
  id: 'trip-1', tripName: 'Beach Getaway', leadCoordinatorName: 'Sam Lee', departureTime: '08:00:00', returnTime: '17:30:00',
  bookingCutoffDate: '2026-08-01', oopDueDate: '2026-08-10', highSupportCount: 2, overnightSupportCount: 2, wheelchairCount: 1,
  requiredBeds: 6, requiredBedrooms: 3, requiredWheelchairCapacity: 2, minStaffRequired: 4, minParticipants: 3, eventTemplateName: 'Coastal',
} as unknown as TripDetailDto
const bookings = [
  { id: 'b1', paymentStatus: 'InvoiceSent' }, { id: 'b2', paymentStatus: 'Paid' },
] as unknown as BookingListDto[]
const stays = [1, 2, 3].map(i => ({ id: `r${i}`, propertyName: `Property ${i}`, reservationStatus: 'Confirmed' })) as unknown as ReservationDto[]
const vans = [1, 2, 3].map(i => ({ id: `v${i}`, vehicleName: `Van ${i}`, seatRequirement: 8, wheelchairPositionRequirement: i === 1 ? 2 : 0 })) as unknown as VehicleAssignmentDto[]

function renderTab(over: Partial<{ trip: TripDetailDto; bookings: BookingListDto[]; accommodation: ReservationDto[]; vehicles: VehicleAssignmentDto[] }> = {}, onSwitchTab = vi.fn()) {
  render(<OverviewTab tripId="trip-1" trip={over.trip ?? trip} bookings={over.bookings ?? bookings} accommodation={over.accommodation ?? stays} vehicles={over.vehicles ?? vans} onSwitchTab={onSwitchTab} />)
  return onSwitchTab
}

// The side column is one "Trip facts" card. The team, the roster, the fleet manifest and the accommodation card are gone: people live in Bookings and Staff.
describe('OverviewTab — Trip facts', () => {
  it('is one card headed "Trip facts", with no team, roster, fleet or call buttons', () => {
    renderTab()
    expect(screen.getByRole('heading', { level: 2, name: 'Trip facts' })).toBeInTheDocument()
    for (const gone of ['The team', 'Manage all', 'Staff Roster', 'Fleet manifest', 'Accommodation']) expect(screen.queryByText(gone), gone).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'call' })).not.toBeInTheDocument()
  })

  it('states each recorded fact in words, with payments as plain text (no pills)', () => {
    renderTab()
    const facts = within(screen.getByRole('heading', { name: 'Trip facts' }).closest('section') as HTMLElement)
    const valueOf = (label: string) => facts.getByText(label).nextElementSibling as HTMLElement
    expect(valueOf('Lead coordinator')).toHaveTextContent('Sam Lee')
    expect(valueOf('Leaves')).toHaveTextContent('8am')
    expect(valueOf('Returns')).toHaveTextContent('5:30pm')
    expect(valueOf('Booking cutoff')).toHaveTextContent('01/08/2026')
    expect(valueOf('Out-of-pocket due')).toHaveTextContent('10/08/2026')
    expect(valueOf('Support needs')).toHaveTextContent('2 high support · 2 overnight · 1 wheelchair')
    expect(valueOf('Payments')).toHaveTextContent('1 invoice sent · 1 paid')
    expect(valueOf('Payments').querySelector('[class*="rounded-full"]')).toBeNull()
    expect(valueOf('Requirements')).toHaveTextContent('6 beds · 3 bedrooms · 2 wheelchair places · min 4 staff · min 3 participants')
    expect(valueOf('Template')).toHaveTextContent('Coastal')
    expect(facts.queryByText('WC')).not.toBeInTheDocument()
  })

  it('shows the first stay and the first two vehicles, then "+n more" buttons that open Stay and transport', async () => {
    const user = userEvent.setup()
    const onSwitchTab = renderTab()
    expect(screen.getByText('Property 1 · Confirmed')).toBeInTheDocument()
    expect(screen.queryByText(/Property 2/)).not.toBeInTheDocument()
    expect(screen.getByText('Van 1 · 8 seats · 2 wheelchair positions')).toBeInTheDocument()
    expect(screen.getByText('Van 2 · 8 seats')).toBeInTheDocument()
    expect(screen.queryByText(/Van 3/)).not.toBeInTheDocument()

    const more = screen.getAllByRole('button', { name: '+2 more' }).concat(screen.getAllByRole('button', { name: '+1 more' }))
    expect(more).toHaveLength(2)
    for (const button of more) expect(button).toHaveClass(...TAP_AREA.split(' '))
    await user.click(screen.getByRole('button', { name: '+1 more' }))
    expect(onSwitchTab).toHaveBeenCalledWith('stay')
  })

  it('drops a fact with nothing recorded and names it in the foot line: no bookings, no support needs', () => {
    renderTab({ trip: { ...trip, highSupportCount: 0, overnightSupportCount: 0, wheelchairCount: 0 }, bookings: [] })
    expect(screen.queryByText('Support needs', { selector: 'dt' })).not.toBeInTheDocument()
    expect(screen.queryByText('Payments', { selector: 'dt' })).not.toBeInTheDocument()
    expect(screen.getByText(/^Not recorded:.*Support needs.*Payments/)).toBeInTheDocument()
  })

  it('lets long values wrap instead of truncating', () => {
    renderTab()
    expect(screen.getByRole('heading', { name: 'Trip facts' }).closest('section')).toHaveClass('[overflow-wrap:anywhere]')
  })
})
