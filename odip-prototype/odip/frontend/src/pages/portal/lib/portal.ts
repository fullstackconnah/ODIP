import { addDays, format, parseISO } from 'date-fns'
import type { PortalShiftSummaryDto, ShiftStatus } from '@/api/types'
import { NIGHT_TYPE_LABELS, RATIO_LABELS } from '@/pages/rostering/lib/roster'

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

// shortcut: the browser's clock stands in for the provider's zone (the list DTO carries no timeZoneId); upgrade if workers roam zones.
const wallNow = (now: Date) => format(now, "yyyy-MM-dd'T'HH:mm")
const wallEnd = (s: PortalShiftSummaryDto) =>
  `${s.endsNextDay ? format(addDays(parseISO(s.serviceDate), 1), 'yyyy-MM-dd') : s.serviceDate}T${s.endTime.slice(0, 5)}`

/** Over and done with: submitted, approved or cancelled, or a Rostered shift whose end has passed. A shift in progress never is. */
export function hasEnded(s: PortalShiftSummaryDto, now: Date): boolean {
  if (s.status === 'InProgress') return false
  return s.status !== 'Published' || wallEnd(s) <= wallNow(now)
}

/** The list's current-shift card (SHAPE §2): any shift in progress, else today's Rostered shift that has not ended, soonest first. */
export function pickCurrentShift(shifts: PortalShiftSummaryDto[], now: Date): PortalShiftSummaryDto | null {
  const today = format(now, 'yyyy-MM-dd')
  return shifts.find(s => s.status === 'InProgress')
    ?? shifts.filter(s => s.status === 'Published' && s.serviceDate === today && !hasEnded(s, now))
      .sort((a, b) => a.startTime.localeCompare(b.startTime))[0]
    ?? null
}
