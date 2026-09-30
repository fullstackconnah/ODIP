import ItineraryTab from '@/components/ItineraryTab'
import { PAYMENT_STATUS_ITEMS, PAYMENT_STATUS_COLORS } from '@/api/hooks'
import type { TripDetailDto } from '@/api/types/trips'
import type { BookingListDto } from '@/api/types/bookings'
import type { ReservationDto } from '@/api/types/reservations'
import type { StaffAssignmentDto } from '@/api/types/staff'
import type { VehicleAssignmentDto } from '@/api/types/vehicles'

interface OverviewTabProps {
  tripId: string
  trip: TripDetailDto
  bookings: BookingListDto[]
  accommodation: ReservationDto[]
  staff: StaffAssignmentDto[]
  vehicles: VehicleAssignmentDto[]
  onSwitchTab: (tab: string) => void
}

export default function OverviewTab({ tripId, trip, bookings, accommodation, staff, vehicles, onSwitchTab }: OverviewTabProps) {
  return (
    <div className="flex flex-col lg:flex-row gap-[var(--section-gap)] items-start animate-fade-in">
      {/* Main: Itinerary Timeline (flexes) */}
      <div className="min-w-0 flex-1 w-full">
        <ItineraryTab tripId={tripId} trip={trip} />
      </div>

      {/* Side panel: Coordination Cards, fixed width */}
      <div className="w-full lg:w-[360px] lg:shrink-0 flex flex-col gap-[var(--section-gap)]">
        {/* Accommodation Card */}
        {accommodation.length > 0 && (
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden">
            <div className="p-[var(--card-pad)] space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="material-symbols-outlined text-[var(--color-primary)]" style={{ fontSize: '18px' }}>home_work</span>
                    <h3 className="text-sm font-semibold text-[var(--color-foreground)]">Accommodation</h3>
                  </div>
                  <p className="text-sm text-[var(--color-muted-foreground)]">{accommodation[0]?.propertyName}</p>
                </div>
                <span className="material-symbols-outlined text-[var(--color-primary)]" style={{ fontSize: '18px' }}>verified</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {accommodation[0]?.bedroomsReserved && (
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[var(--color-secondary)]" style={{ fontSize: '16px' }}>king_bed</span>
                    <span className="text-xs font-medium text-[var(--color-foreground)]">{accommodation[0].bedroomsReserved} Bedrooms</span>
                  </div>
                )}
                {accommodation[0]?.reservationStatus && (
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[var(--color-secondary)]" style={{ fontSize: '16px' }}>event_available</span>
                    <span className="text-xs font-medium text-[var(--color-foreground)]">{accommodation[0].reservationStatus}</span>
                  </div>
                )}
              </div>
              {accommodation.length > 1 && (
                <p className="text-xs text-[var(--color-muted-foreground)] italic">+{accommodation.length - 1} more property reserved</p>
              )}
            </div>
          </div>
        )}

        {/* The Team */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--color-foreground)]">The Team</h3>
            <button className="text-[var(--color-primary)] text-xs font-bold hover:opacity-70 transition-opacity" onClick={() => onSwitchTab('bookings')}>
              Manage All
            </button>
          </div>

          {/* Participants */}
          {bookings.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-[var(--color-muted-foreground)] uppercase tracking-widest px-1">Participants</p>
              <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden">
                <div className="p-1">
                {bookings.slice(0, 4).map((b: BookingListDto) => (
                  <div key={b.id} className="h-10 px-2 flex items-center gap-2 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-container-low)] transition-colors">
                    <div className="w-7 h-7 shrink-0 rounded-full bg-[var(--color-surface-container)] flex items-center justify-center font-bold text-xs text-[var(--color-primary)]">
                      {(b.participantName || 'P').charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-[var(--color-foreground)] truncate leading-tight">{b.participantName}</p>
                      <p className="text-[13px] text-[var(--color-muted-foreground)] truncate leading-tight">
                        {[b.highSupportRequired && 'High Support', b.wheelchairRequired && 'Wheelchair', b.nightSupportRequired && 'Night Support'].filter(Boolean).join(' · ') || b.bookingStatus}
                      </p>
                    </div>
                    {b.highSupportRequired && (
                      <span className="material-symbols-outlined text-[var(--color-on-accessible-container)] shrink-0" style={{ fontSize: '16px', fontVariationSettings: "'FILL' 1" }}>medical_services</span>
                    )}
                  </div>
                ))}
                </div>
                {bookings.length > 4 && (
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-muted-foreground)] italic cursor-pointer hover:bg-[var(--color-surface-container-low)] transition-colors"
                    onClick={() => onSwitchTab('bookings')}
                  >
                    +{bookings.length - 4} more participants
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Payment summary */}
          {bookings.length > 0 && (() => {
            const counts: Record<string, number> = {}
            for (const b of bookings) {
              const s = (b.paymentStatus as string) || 'NotInvoiced'
              counts[s] = (counts[s] ?? 0) + 1
            }
            const entries = PAYMENT_STATUS_ITEMS
              .map(item => ({ ...item, count: counts[item.value] ?? 0 }))
              .filter(e => e.count > 0)
            if (entries.length === 0) return null
            return (
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-[var(--color-muted-foreground)] uppercase tracking-widest px-1">Payment</p>
                <div className="flex flex-wrap gap-1.5 px-1">
                  {entries.map(({ value, label, count }) => (
                    <span
                      key={value}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_STATUS_COLORS[value]}`}
                    >
                      {count} {label}
                    </span>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Staff */}
          {staff.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-[var(--color-muted-foreground)] uppercase tracking-widest px-1">Staff Roster</p>
              <div className="space-y-1">
                {staff.slice(0, 3).map((s: StaffAssignmentDto, i: number) => (
                  <div key={s.id} className={`h-10 bg-[var(--color-surface-container-low)] px-2 rounded-[var(--radius-sm)] flex items-center justify-between ${i === 0 ? 'ring-2 ring-primary/20' : ''}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 shrink-0 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] font-bold text-xs">
                        {(s.staffName || 'S').split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-[var(--color-foreground)] truncate leading-tight">{s.staffName}</p>
                        <p className="text-[13px] text-[var(--color-muted-foreground)] truncate leading-tight">{s.assignmentRole || (s.isDriver ? 'Driver' : 'Support Worker')}</p>
                      </div>
                    </div>
                    <button className="w-6 h-6 shrink-0 rounded-full bg-[var(--color-card)] flex items-center justify-center hover:bg-[var(--color-accent)] transition-colors">
                      <span className="material-symbols-outlined text-[var(--color-muted-foreground)]" style={{ fontSize: '14px' }}>call</span>
                    </button>
                  </div>
                ))}
                {staff.length > 3 && (
                  <button
                    type="button"
                    className="w-full text-xs text-[var(--color-muted-foreground)] italic text-center cursor-pointer hover:opacity-70"
                    onClick={() => onSwitchTab('staff')}
                  >
                    +{staff.length - 3} more staff assigned
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Fleet */}
        {vehicles.length > 0 && (
          <div className="bg-[var(--color-surface-container-high)] p-[var(--card-pad)] rounded-[var(--radius-md)] space-y-2">
            <h3 className="font-semibold text-sm flex items-center gap-2 text-[var(--color-foreground)]">
              <span className="material-symbols-outlined text-[var(--color-secondary)]" style={{ fontSize: '18px' }}>local_shipping</span>
              Fleet Manifest
            </h3>
            <div className="space-y-1.5">
              {vehicles.map((v: VehicleAssignmentDto) => (
                <div key={v.id} className="flex items-center gap-3 bg-[var(--color-card)] p-2 rounded-[var(--radius-sm)]">
                  <div className="w-9 h-9 shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-input)] flex items-center justify-center">
                    <span className="material-symbols-outlined text-[var(--color-muted-foreground)]" style={{ fontSize: '18px' }}>airport_shuttle</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-foreground)] truncate">{v.vehicleName || 'Vehicle'}</p>
                    <p className="text-[13px] tabular-nums leading-tight text-[var(--color-muted-foreground)]">
                      {[v.wheelchairPositionRequirement && `${v.wheelchairPositionRequirement} WC`, v.seatRequirement && `${v.seatRequirement} seats`].filter(Boolean).join(' · ') || 'Vehicle'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
