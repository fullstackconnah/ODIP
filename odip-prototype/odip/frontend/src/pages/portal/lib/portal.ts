import { addDays, format, parseISO } from 'date-fns'
import type { PortalShiftSummaryDto, ShiftStatus } from '@/api/types'
import { NIGHT_TYPE_LABELS, RATIO_LABELS } from '@/pages/rostering/lib/roster'
import { providerLocalToUtcInstant, utcInstantToProviderLocal } from '../shift/shiftTime'

/** OvernightSupportType shares its first four values with SleepoverType (see NIGHT_TYPE_LABELS) plus one extra. */
export const OVERNIGHT_SUPPORT_LABELS: Record<string, string> = {
  ...NIGHT_TYPE_LABELS,
  SleepoverSupport: 'Sleepover Support',
}

export { RATIO_LABELS }

/** Worker words for a portal shift's status (SHAPE §7), passed to StatusBadge as `label`; the tones stay StatusBadge's own. */
export const PORTAL_SHIFT_STATUS_LABELS: Partial<Record<ShiftStatus, string>> = {
  Published: 'Rostered',
  InProgress: 'In progress',
  PendingReview: 'Submitted',
  Completed: 'Approved',
  Cancelled: 'Cancelled',
}

/** A shift's worker label: a Published shift a coordinator sent back reads "Returned". */
export function portalStatusLabel(s: { status: ShiftStatus; returnCount: number }): string | undefined {
  return s.status === 'Published' && s.returnCount > 0 ? 'Returned' : PORTAL_SHIFT_STATUS_LABELS[s.status]
}

// The shifts' dates and times are wall clock in the provider's zone, so "now" is read there too, never on the device's clock.
const wallNow = (now: Date, tz: string | undefined) => utcInstantToProviderLocal(now.toISOString(), tz)
const wallEnd = (s: PortalShiftSummaryDto) =>
  `${s.endsNextDay ? format(addDays(parseISO(s.serviceDate), 1), 'yyyy-MM-dd') : s.serviceDate}T${s.endTime.slice(0, 5)}`

/** Over and done with: submitted, approved or cancelled, or a Rostered shift whose end has passed. A shift in progress never is. */
/** `tz` undefined (a response without the provider zone) reads the device zone. */
export function hasEnded(s: PortalShiftSummaryDto, now: Date, tz: string | undefined): boolean {
  if (s.status === 'InProgress') return false
  return s.status !== 'Published' || wallEnd(s) <= wallNow(now, tz)
}

/** The list's current-shift card (SHAPE §2): any shift in progress, else today's Rostered shift that has not ended, soonest first. */
export function pickCurrentShift(shifts: PortalShiftSummaryDto[], now: Date, tz: string | undefined): PortalShiftSummaryDto | null {
  const today = wallNow(now, tz).slice(0, 10)
  return shifts.find(s => s.status === 'InProgress')
    ?? shifts.filter(s => s.status === 'Published' && s.serviceDate === today && !hasEnded(s, now, tz))
      .sort((a, b) => a.startTime.localeCompare(b.startTime))[0]
    ?? null
}

/** Mirrors PortalController.EarliestStartLeadMinutes: Start opens this long before the rostered start. The server stays the floor (its "too early" message shows if clocks disagree). */
export const EARLIEST_START_LEAD_MINUTES = 60

/** The rostered start and end as instants, read in the provider's zone (the end on the next day for an overnight shift). */
export function rosteredInstants(s: { serviceDate: string; startTime: string; endTime: string; endsNextDay: boolean; timeZoneId: string }) {
  const endDate = s.endsNextDay ? format(addDays(parseISO(s.serviceDate), 1), 'yyyy-MM-dd') : s.serviceDate
  return {
    start: providerLocalToUtcInstant(`${s.serviceDate}T${s.startTime.slice(0, 5)}`, s.timeZoneId),
    end: providerLocalToUtcInstant(`${endDate}T${s.endTime.slice(0, 5)}`, s.timeZoneId),
  }
}
