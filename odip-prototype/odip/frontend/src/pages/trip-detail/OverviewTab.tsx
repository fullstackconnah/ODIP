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
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 animate-fade-in">
      {/* Left: Itinerary Timeline 7/12 */}
      <div className="lg:col-span-7">
        <ItineraryTab tripId={tripId} trip={trip} />
      </div>

      {/* Right: Coordination Cards 5/12 */}
      <div className="lg:col-span-5 space-y-4 md:space-y-6">
        {/* Accommodation Card */}
        {accommodation.length > 0 && (
          <div className="bg-white rounded-2xl overflow-hidden shadow-[0_24px_32px_-12px_rgba(27,28,26,0.04)]">
            <div className="p-5 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="material-symbols-outlined text-[#396200]" style={{ fontSize: '20px' }}>home_work</span>
                    <h3 className="text-lg font-bold text-[#1b1c1a]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Accommodation</h3>
                  </div>
                  <p className="text-sm text-[#43493a]">{accommodation[0]?.propertyName}</p>
                </div>
                <span className="material-symbols-outlined text-[#396200]" style={{ fontSize: '20px' }}>verified</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {accommodation[0]?.bedroomsReserved && (
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#515f74]" style={{ fontSize: '16px' }}>king_bed</span>
                    <span className="text-xs font-medium text-[#1b1c1a]">{accommodation[0].bedroomsReserved} Bedrooms</span>
                  </div>
                )}
                {accommodation[0]?.reservationStatus && (
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#515f74]" style={{ fontSize: '16px' }}>event_available</span>
                    <span className="text-xs font-medium text-[#1b1c1a]">{accommodation[0].reservationStatus}</span>
                  </div>
                )}
              </div>
              {accommodation.length > 1 && (
                <p className="text-xs text-[#43493a] italic">+{accommodation.length - 1} more property reserved</p>
              )}
            </div>
          </div>
        )}

        {/* The Team */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-[#1b1c1a]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>The Team</h3>
            <button className="text-[#396200] text-sm font-bold hover:opacity-70 transition-opacity" onClick={() => onSwitchTab('bookings')}>
              Manage All
            </button>
          </div>

          {/* Participants */}
          {bookings.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-[#43493a] uppercase tracking-widest px-1">Participants</p>
              <div className="bg-white rounded-2xl shadow-[0_24px_32px_-12px_rgba(27,28,26,0.04)] overflow-hidden">
                <div className="p-2 space-y-1">
                {bookings.slice(0, 4).map((b: BookingListDto) => (
                  <div key={b.id} className="p-3 flex items-center gap-3 rounded-xl hover:bg-[#f5f3ef] transition-colors">
                    <div className="w-10 h-10 rounded-full bg-[#efeeea] flex items-center justify-center font-bold text-sm text-[#396200]">
                      {(b.participantName || 'P').charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-[#1b1c1a] truncate">{b.participantName}</p>
                      <p className="text-[10px] text-[#43493a]">
                        {[b.highSupportRequired && 'High Support', b.wheelchairRequired && 'Wheelchair', b.nightSupportRequired && 'Night Support'].filter(Boolean).join(' · ') || b.bookingStatus}
                      </p>
                    </div>
                    {b.highSupportRequired && (
                      <span className="material-symbols-outlined text-[#8e337b]" style={{ fontSize: '16px', fontVariationSettings: "'FILL' 1" }}>medical_services</span>
                    )}
                  </div>
                ))}
                </div>
                {bookings.length > 4 && (
                  <div className="px-3 py-2 text-xs text-[#43493a] italic cursor-pointer hover:bg-[#f5f3ef] rounded-xl transition-colors" onClick={() => onSwitchTab('bookings')}>
                    +{bookings.length - 4} more participants
                  </div>
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
              <div className="space-y-2">
                <p className="text-xs font-bold text-[#43493a] uppercase tracking-widest px-1">Payment</p>
                <div className="flex flex-wrap gap-2 px-1">
                  {entries.map(({ value, label, count }) => (
                    <span
                      key={value}
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${PAYMENT_STATUS_COLORS[value]}`}
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
            <div className="space-y-2">
              <p className="text-xs font-bold text-[#43493a] uppercase tracking-widest px-1">Staff Roster</p>
              <div className="space-y-2">
                {staff.slice(0, 3).map((s: StaffAssignmentDto, i: number) => (
                  <div key={s.id} className={`bg-[#f5f3ef] p-4 rounded-xl flex items-center justify-between ${i === 0 ? 'ring-2 ring-[#396200]/20' : ''}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#396200]/10 flex items-center justify-center text-[#396200] font-bold text-xs">
                        {(s.staffName || 'S').split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div>
                        <p className="font-bold text-sm text-[#1b1c1a]">{s.staffName}</p>
                        <p className="text-[10px] text-[#43493a]">{s.assignmentRole || (s.isDriver ? 'Driver' : 'Support Worker')}</p>
                      </div>
                    </div>
                    <button className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm hover:shadow-md transition-shadow">
                      <span className="material-symbols-outlined text-[#43493a]" style={{ fontSize: '16px' }}>call</span>
                    </button>
                  </div>
                ))}
                {staff.length > 3 && (
                  <p className="text-xs text-[#43493a] italic text-center cursor-pointer hover:opacity-70" onClick={() => onSwitchTab('staff')}>
                    +{staff.length - 3} more staff assigned
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Fleet */}
        {vehicles.length > 0 && (
          <div className="bg-[#eae8e4] p-5 rounded-2xl space-y-4">
            <h3 className="font-bold text-lg flex items-center gap-2 text-[#1b1c1a]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              <span className="material-symbols-outlined text-[#515f74]" style={{ fontSize: '20px' }}>local_shipping</span>
              Fleet Manifest
            </h3>
            <div className="space-y-3">
              {vehicles.map((v: VehicleAssignmentDto) => (
                <div key={v.id} className="flex items-center gap-4 bg-white p-3 rounded-xl shadow-sm">
                  <div className="w-12 h-12 rounded-lg bg-[#e4e2de] flex items-center justify-center">
                    <span className="material-symbols-outlined text-[#43493a]" style={{ fontSize: '20px' }}>airport_shuttle</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#1b1c1a] truncate">{v.vehicleName || 'Vehicle'}</p>
                    <p className="text-[10px] text-[#43493a]">
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
