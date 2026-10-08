import type { BudgetWarningDto } from '@/api/types'

/** One or more bookings confirmed past the participants' funding: who a single one is about, how many there are, and the server's warnings for them. */
export type BookingBudgetNotice = { who: string | null; warnings: BudgetWarningDto[]; bookings: number }

/**
 * The budget warning the write that confirmed a booking came back with (budget phase 3), or null when there is none to say. It reads the response only: the server works the warning out, and
 * a write that did not confirm the booking sends none. A warning only, in every mode: the booking is confirmed whatever it says.
 */
export function bookingBudgetNotice(response: { data?: { participantName?: string | null; budgetWarnings?: BudgetWarningDto[] } | null } | null | undefined): BookingBudgetNotice | null {
  const warnings = response?.data?.budgetWarnings
  if (!warnings || warnings.length === 0) return null
  return { who: response?.data?.participantName ?? null, warnings, bookings: 1 }
}

/** The warnings of a batch of bookings confirmed together (the status changed for every ticked row), as one notice; null when none of them came back with one. */
export function mergeBookingBudgetNotices(notices: readonly (BookingBudgetNotice | null)[]): BookingBudgetNotice | null {
  const present = notices.filter((notice): notice is BookingBudgetNotice => notice !== null)
  if (present.length === 0) return null
  return { who: present.length === 1 ? present[0].who : null, warnings: present.flatMap(notice => notice.warnings), bookings: present.length }
}

/** The closing line of the warning: that the booking (or bookings) stand. */
export function bookingBudgetNote(notice: BookingBudgetNotice): string {
  if (notice.bookings > 1) return 'This is a warning only. The bookings are confirmed.'
  return notice.who ? `This is a warning only. ${notice.who}’s booking is confirmed.` : 'This is a warning only. The booking is confirmed.'
}
