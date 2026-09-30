import type { ReservationDto } from '@/api/types/reservations'
import type { AccommodationListDto } from '@/api/types/accommodation'

/**
 * "2 of 4": how many of the property's N rooms (or beds) a reservation holds. `reserved` is what THIS reservation reserved and is
 * null until someone records it; `available` is the property's total. They are different numbers with different meanings, and the
 * density redesign merged them (`reserved ?? property.bedroomCount`), so an unfilled reservation at a 4-bedroom property read as
 * "4 bedrooms reserved" and a partial one lost the property's total. A missing reserved count stays "—"; a missing total is left
 * off ("2"), as before the redesign.
 */
export function reservedOfAvailable(reserved: number | null | undefined, available: number | null | undefined): string {
  const held = reserved ?? null
  const total = available ? available : null
  if (held == null && total == null) return '—'
  return total == null ? String(held) : `${held ?? '—'} of ${total}`
}

/** The "Bedrooms / Beds" cell: "2 of 4 / 4 of 8 (max 10)", or "—" when the reservation and its property say nothing about either. */
export function reservationCountsLabel(reservation: ReservationDto, property: AccommodationListDto | undefined): string {
  const bedrooms = reservedOfAvailable(reservation.bedroomsReserved, property?.bedroomCount)
  const beds = reservedOfAvailable(reservation.bedsReserved, property?.bedCount)
  if (bedrooms === '—' && beds === '—') return '—'
  return `${bedrooms} / ${beds}${property?.maxCapacity ? ` (max ${property.maxCapacity})` : ''}`
}
