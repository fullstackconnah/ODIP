import type { TripStatus } from '@/api/types/enums'

/**
 * StatusBadge tones for the four trip statuses it had no entry for (Planning, OpenForBookings, WaitlistOnly, InProgress), keyed the way
 * StatusBadge keys its map (lower case, no spaces). Without an entry the badge fell back to the amber warning pair, which is the wrong
 * signal: DESIGN.md's Semantic Colour Rule reserves amber for time-bound compliance. The tones are the closest existing StatusBadge pairs
 * to how the app already colours these statuses on the dashboard (DashboardPage) and the schedule (schedule/TripStatusBadge); no new colour.
 * WaitlistOnly is amber there too, so it is an explicit entry that happens to equal the fallback pair.
 */
export const TRIP_STATUS_COLORS: Record<string, string> = {
  planning: 'bg-[var(--color-secondary-container)] text-[var(--color-info)]',
  openforbookings: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  waitlistonly: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  inprogress: 'bg-[var(--color-accessible-container)] text-[var(--color-on-accessible-container)]',
}

/**
 * Sentence-case labels for every trip status, for a StatusBadge's `label`. A `Record<TripStatus, string>`, so a status added to
 * TRIP_STATUSES fails the type check until it has one. The badge shows the raw enum text ("OpenForBookings") when given none.
 * Passed at the call site rather than mapped inside StatusBadge, so its other users (a portal shift's "InProgress") keep their text.
 */
export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  Draft: 'Draft',
  Planning: 'Planning',
  OpenForBookings: 'Open for bookings',
  WaitlistOnly: 'Waitlist only',
  Confirmed: 'Confirmed',
  InProgress: 'In progress',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
  Archived: 'Archived',
}
