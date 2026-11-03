import type { ReactNode } from 'react'
import ItineraryTab from '@/components/ItineraryTab'
import { FactList, type FactListItem } from '@/components/FactList'
import { TAP_AREA } from '@/components/tapArea'
import { PAYMENT_STATUS_ITEMS } from '@/api/hooks'
import type { TripDetailDto } from '@/api/types/trips'
import type { BookingListDto } from '@/api/types/bookings'
import type { ReservationDto } from '@/api/types/reservations'
import type { VehicleAssignmentDto } from '@/api/types/vehicles'
import { plural } from '@/lib/format'
import { formatDateAu, formatShiftTime } from '@/lib/utils'

interface OverviewTabProps {
  tripId: string
  trip: TripDetailDto
  bookings: BookingListDto[]
  accommodation: ReservationDto[]
  vehicles: VehicleAssignmentDto[]
  onSwitchTab: (tab: string) => void
}

// Vehicles and stays list this many, then "+n more" opens Stay and transport.
const SHOWN = 2

// A value that is missing, or only zeros, is "not recorded": FactList (hideEmpty) names it in the foot line.
// A leading count (or "min 3") is glued to its noun with NBSP, so a figure never strands at a line end; " · " stays the only break.
const glue = (s: string | number) => String(s).replace(/^(min )?(\d+) /, (_, min, n) => `${min ? 'min\u00A0' : ''}${n}\u00A0`)
const joined = (parts: (string | number | false | null | undefined)[]) => parts.filter(Boolean).map(p => glue(p as string | number)).join(' · ') || null
const count = (n: number | null | undefined, singular: string) => (n ? plural(n, singular) : null)

export default function OverviewTab({ tripId, trip, bookings, accommodation, vehicles, onSwitchTab }: OverviewTabProps) {
  const moreButton = (n: number) => (
    <button type="button" className={`${TAP_AREA} block text-xs text-[var(--color-primary)] hover:underline`} onClick={() => onSwitchTab('stay')}>
      +{n} more
    </button>
  )
  const lines = (rows: string[], more: number): ReactNode =>
    rows.length === 0 ? null : (
      <>
        {rows.map((row, i) => <span key={i} className="block">{row}</span>)}
        {more > 0 && moreButton(more)}
      </>
    )

  const payments = PAYMENT_STATUS_ITEMS
    .map(({ value, label }) => ({ label, n: bookings.filter(b => ((b.paymentStatus as string) || 'NotInvoiced') === value).length }))
    .filter(p => p.n > 0)
    .map(p => glue(`${p.n} ${p.label.toLowerCase()}`))

  const items: FactListItem[] = [
    { label: 'Lead coordinator', value: trip.leadCoordinatorName },
    { label: 'Leaves', value: trip.departureTime && formatShiftTime(trip.departureTime) },
    { label: 'Returns', value: trip.returnTime && formatShiftTime(trip.returnTime) },
    { label: 'Booking cutoff', value: trip.bookingCutoffDate && formatDateAu(trip.bookingCutoffDate) },
    { label: 'Out-of-pocket due', value: trip.oopDueDate && formatDateAu(trip.oopDueDate) },
    {
      label: 'Support needs',
      value: joined([
        trip.highSupportCount > 0 && `${trip.highSupportCount} high support`,
        trip.overnightSupportCount > 0 && `${trip.overnightSupportCount} overnight`,
        trip.wheelchairCount > 0 && `${trip.wheelchairCount} wheelchair`,
      ]),
    },
    { label: 'Payments', value: payments.join(' · ') || null },
    {
      label: 'Stay',
      value: lines(accommodation.slice(0, 1).map(r => joined([r.propertyName, r.reservationStatus]) ?? ''), accommodation.length - 1),
    },
    {
      label: 'Vehicles',
      value: lines(
        vehicles.slice(0, SHOWN).map(v =>
          joined([v.vehicleName || 'Vehicle', v.seatRequirement && `${v.seatRequirement} seats`, v.wheelchairPositionRequirement && plural(v.wheelchairPositionRequirement, 'wheelchair position')]) ?? '',
        ),
        vehicles.length - SHOWN,
      ),
    },
    {
      label: 'Requirements',
      value: joined([
        count(trip.requiredBeds, 'bed'),
        count(trip.requiredBedrooms, 'bedroom'),
        count(trip.requiredWheelchairCapacity, 'wheelchair place'),
        trip.minStaffRequired ? `min ${trip.minStaffRequired} staff` : null,
        trip.minParticipants ? `min ${trip.minParticipants} participants` : null,
      ]),
    },
    { label: 'Template', value: trip.eventTemplateName },
  ]

  return (
    <div className="flex flex-col lg:flex-row gap-[var(--section-gap)] items-start animate-fade-in">
      {/* Main: Itinerary Timeline (flexes) */}
      <div className="min-w-0 flex-1 w-full">
        <ItineraryTab tripId={tripId} />
      </div>

      {/* Side panel: one card of trip facts, fixed width. People live in Bookings and Staff; the glance strip says whether either is short. */}
      <section className="w-full lg:w-[360px] lg:shrink-0 bg-[var(--color-card)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-[var(--card-pad)] flex flex-col gap-2 [overflow-wrap:anywhere]">
        <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Trip facts</h2>
        <FactList items={items} hideEmpty />
      </section>
    </div>
  )
}
