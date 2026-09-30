// Deadline state: how close a dated deadline is (a credential's expiry, a review due date), in one place. Pure, JSX-free.
//
//   deadlineState('2026-10-11', { warnDays: 30, today })  ->  { status: 'soon', days: 10 }
//   deadlineLabel(state, 'long')                          ->  'Expires in 10 days'
//   <StatusBadge tone={DEADLINE_TONE[state.status]} label={deadlineLabel(state)} />
//
// The date is a calendar day (see dateOnly.ts), so the day count cannot shift with the time zone or a daylight-saving change.
import { calendarDaysUntil } from './dateOnly'
import { plural } from './format'
import type { Tone } from './tone'

export type DeadlineStatus = 'overdue' | 'today' | 'soon' | 'ok' | 'none'

export interface DeadlineState {
  status: DeadlineStatus
  /** Whole calendar days until the deadline: negative once it has passed, 0 on the day. null when there is no usable date. */
  days: number | null
}

export interface DeadlineOptions {
  /** A deadline this many days away or closer (and not yet passed) is `soon`; today is always `today`. */
  warnDays: number
  /** The day to measure from: a Date (its local calendar day) or a "YYYY-MM-DD" string. Defaults to now; pass it in tests. */
  today?: Date | string
}

/** The tone of each state (lib/tone.ts): past is danger, today and soon are warning, fine is success, no date is neutral. */
export const DEADLINE_TONE: Record<DeadlineStatus, Tone> = {
  overdue: 'danger',
  today: 'warning',
  soon: 'warning',
  ok: 'success',
  none: 'neutral',
}

/**
 * `none` for a missing or unusable date, `overdue` once the day has passed, `today` on the day, `soon` within `warnDays`, else `ok`.
 * The last day of the warning window is `soon` (30 days out with warnDays 30), the next day is `ok`.
 */
export function deadlineState(isoDate: string | null | undefined, { warnDays, today = new Date() }: DeadlineOptions): DeadlineState {
  const days = calendarDaysUntil(isoDate, today)
  if (days === null) return { status: 'none', days: null }
  if (days < 0) return { status: 'overdue', days }
  if (days === 0) return { status: 'today', days }
  return { status: days <= warnDays ? 'soon' : 'ok', days }
}

export type DeadlineLabelStyle = 'compact' | 'long'

/**
 * The words for a state. `long` reads on its own ("Expires in 12 days"); `compact` is for a cell with no room for the lead-in ("12 days").
 * They differ only for `soon`: Expired, Expires today, Current and No date set are the same in both.
 */
export function deadlineLabel(state: DeadlineState, style: DeadlineLabelStyle = 'long'): string {
  switch (state.status) {
    case 'overdue': return 'Expired'
    case 'today': return 'Expires today'
    case 'soon': return style === 'compact' ? plural(state.days ?? 0, 'day') : `Expires in ${plural(state.days ?? 0, 'day')}`
    case 'ok': return 'Current'
    case 'none': return 'No date set'
  }
}

/** True for every state that needs someone to act: no date, past, today or soon. Only `ok` is fine. */
export function isDeadlineIssue(state: DeadlineState): boolean {
  return state.status !== 'ok'
}
