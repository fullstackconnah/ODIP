// The periods an agreement is cut into for "Cost by period" (Check step), pure and JSX-free. Every boundary is worked out from the agreement start and never chained from the period before,
// so a 31st start does not drift to the 28th; a missing day clamps to the month's last, as `addMonths` does.
import { parseDateOnly } from './dateOnly'
import { addDays, addMonths } from './planQuote'

export type PeriodKind = 'fortnight' | 'month' | 'quarter' | 'year'

/** `months` is null for a fortnight, which is fourteen days. `unit` is the word for the stepper buttons ("Next month"). */
export const PERIOD_KINDS: Record<PeriodKind, { label: string; unit: string; months: number | null }> = {
  fortnight: { label: 'Fortnight', unit: 'fortnight', months: null },
  month: { label: 'Month', unit: 'month', months: 1 },
  quarter: { label: 'Quarter', unit: 'quarter', months: 3 },
  year: { label: 'Year', unit: 'year', months: 12 },
}

const KIND_ORDER: readonly PeriodKind[] = ['fortnight', 'month', 'quarter', 'year']

export interface AgreementPeriod { from: string; to: string; /** It ends with the agreement, before a whole period is up. */ part: boolean }

/** Where period `k` (0-based) of a kind begins. */
function startOf(kind: PeriodKind, start: string, k: number): string {
  const months = PERIOD_KINDS[kind].months
  return months === null ? addDays(start, 14 * k) : addMonths(start, months * k)
}

/** How many periods begin on or before the agreement's last day (0 for dates that cannot be read). */
export function periodCount(kind: PeriodKind, start: string, end: string): number {
  const first = parseDateOnly(start), last = parseDateOnly(end)
  if (first === null || last === null || last < first) return 0
  if (PERIOD_KINDS[kind].months === null) return Math.floor((last - first) / 14) + 1
  let count = 1
  while ((parseDateOnly(startOf(kind, start, count)) as number) <= last) count += 1
  return count
}

/** Period `k` of a kind, its last day clamped to the agreement's end. */
export function periodAt(kind: PeriodKind, start: string, end: string, k: number): AgreementPeriod {
  const natural = addDays(startOf(kind, start, k + 1), -1)
  const part = (parseDateOnly(natural) as number) > (parseDateOnly(end) as number)
  return { from: startOf(kind, start, k), to: part ? end : natural, part }
}

/** The kinds that cut the agreement into two or more periods: a kind whose first period would cover it all only repeats "The whole agreement". */
export function offeredKinds(start: string, end: string): PeriodKind[] {
  return KIND_ORDER.filter(kind => periodCount(kind, start, end) >= 2)
}
