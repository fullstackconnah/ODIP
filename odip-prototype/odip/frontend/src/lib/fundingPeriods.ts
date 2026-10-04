import { formatDayNumber, parseDateOnly } from './dateOnly'

// A pool's release periods, proposed from the plan's dates and the period length. A pure function, so the editor and its tests share one rule; the server validates the
// invariants (contiguous, from the plan's first day to its last, none over 12 months, one period when the plan has none) and never proposes. Money is worked in whole cents so
// a split adds up to the cent. The NDIA sets period lengths and amounts per participant, so these are a starting point: the editor leaves every period's amounts editable.

export const PERIOD_LENGTHS = [1, 3, 6, 12] as const
export type PeriodLengthMonths = typeof PERIOD_LENGTHS[number]

/** The longest a plan may run, in days, both ends counted. The server refuses a longer one, so nothing is proposed for it. */
export const MAX_PLAN_DAYS = 800

export interface ProposedPeriod {
  periodStart: string
  periodEnd: string
  planAmount: number
  /** Present only when a set-aside was asked for: it is on every period of a pool or on none. */
  setAside?: number
}

export interface ProposeInput {
  /** "YYYY-MM-DD", the plan's first day (inclusive). */
  planStart: string
  /** "YYYY-MM-DD", the plan's last day (inclusive). */
  planEnd: string
  /** 1, 3, 6 or 12; null for a plan with no funding periods (one period, equal to the plan). */
  lengthMonths: number | null
  /** The pool's amount for the whole plan, in dollars. */
  planAmount: number
  /** The organisation's share of it, in dollars, when the participant also uses other providers. */
  setAside?: number
}

/** Whole cents in a dollar figure: 0.1 + 0.2 is 30 cents here, not 30.000000000000004. */
export function toCents(amount: number): number {
  return Math.round(amount * 100)
}

/** The total of some dollar figures, to the cent. */
export function sumAmounts(values: readonly number[]): number {
  return values.reduce((cents, value) => cents + toCents(value), 0) / 100
}

/** How the plan prints the length of its funding periods, for a fact list or a table cell. */
export function periodLengthLabel(months: number | null | undefined): string {
  if (months === null || months === undefined) return 'No funding periods'
  return months === 1 ? 'Monthly' : `${months}-monthly`
}

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()

/**
 * A date a number of calendar months later, at the same day of the month, or the last day of the month when that month is shorter (31 Jan + 1 month is 28 Feb, or 29 in a leap year).
 * "YYYY-MM-DD" in and out; '' for a date that is not one.
 */
export function addMonthsIso(iso: string, months: number): string {
  const day = parseDateOnly(iso)
  if (day === null) return ''
  const [year, month, dayOfMonth] = formatDayNumber(day).split('-').map(Number)
  const index = year * 12 + (month - 1) + months
  const targetYear = Math.floor(index / 12)
  const targetMonth = (index % 12) + 1
  const clamped = Math.min(dayOfMonth, daysInMonth(targetYear, targetMonth))
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`
}

/**
 * Divides a total over periods in proportion to their weights (days), in whole cents: each period but the last is its share rounded to the cent, and the last takes what is left,
 * so the parts always add up to the total. If rounding up would leave the last a negative remainder (a few cents over many periods), every share is rounded down instead.
 */
function splitCents(totalCents: number, weights: readonly number[]): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const split = (round: (value: number) => number): number[] => {
    const shares = weights.slice(0, -1).map(weight => round((totalCents * weight) / totalWeight))
    return [...shares, totalCents - shares.reduce((sum, share) => sum + share, 0)]
  }
  const rounded = split(Math.round)
  return rounded[rounded.length - 1] < 0 ? split(Math.floor) : rounded
}

/**
 * Splits a set-aside over periods the way the plan amount was, then moves any cent that rounding left above its period's plan amount onto an earlier period that has room. Two totals
 * a few cents apart can round differently (11 cents over three months is 4, 4, 3 and 10 cents is 3, 3, 4: the last set-aside would be a cent above its plan amount, which the server
 * refuses). There is always room for it when the set-aside is no more than the plan amount, so it still adds up to what was asked for.
 */
function fitSetAsides(amounts: readonly number[], setAsides: readonly number[]): number[] {
  const fitted = [...setAsides]
  let excess = 0
  for (let i = fitted.length - 1; i >= 0; i--) {
    if (fitted[i] > amounts[i]) {
      excess += fitted[i] - amounts[i]
      fitted[i] = amounts[i]
    }
  }
  for (let i = fitted.length - 1; i >= 0 && excess > 0; i--) {
    const moved = Math.min(amounts[i] - fitted[i], excess)
    fitted[i] += moved
    excess -= moved
  }
  return fitted
}

/**
 * A set-aside spread over periods in proportion to their plan amounts (all in whole cents), for a pool whose periods were worked on by hand and so no longer follow the days' split: each
 * period sets aside the same share of its amount, as near to the cent as a split allows, the last taking what is left, and never above a period's plan amount while the set-aside is no
 * more than the plan amount in all. All zeros when there is nothing to weigh by (no periods, or plan amounts of $0).
 */
export function spreadSetAside(setAsideCents: number, amountCents: readonly number[]): number[] {
  const total = amountCents.reduce((sum, amount) => sum + amount, 0)
  if (amountCents.length === 0 || total === 0) return amountCents.map(() => 0)
  const plain = splitCents(setAsideCents, amountCents)
  return setAsideCents <= total ? fitSetAsides(amountCents, plain) : plain
}

/**
 * The periods of a pool: each runs from the day after the one before it for the period length in calendar months, and the last ends on the plan's last day (a short last period
 * when the plan is not a whole number of lengths). Boundaries are counted from the plan's first day, so a plan that starts on the 31st does not drift a day each period. Amounts
 * are the plan amount, and the set-aside when given, split in proportion to the days each period covers. A plan with no funding periods is one period equal to the plan. Nothing
 * is proposed (an empty list) for dates that are not real days, a plan that ends before it starts, a plan longer than the server accepts (a year typed into a date input digit by
 * digit passes through years like 0002, which would be thousands of periods drawn for each keystroke), or a length the NDIS does not use.
 */
export function proposePeriods({ planStart, planEnd, lengthMonths, planAmount, setAside }: ProposeInput): ProposedPeriod[] {
  const first = parseDateOnly(planStart)
  const last = parseDateOnly(planEnd)
  if (first === null || last === null || last < first) return []
  if (last - first + 1 > MAX_PLAN_DAYS) return []
  if (lengthMonths !== null && !(PERIOD_LENGTHS as readonly number[]).includes(lengthMonths)) return []

  const bounds: { start: number; end: number }[] = []
  if (lengthMonths === null) {
    bounds.push({ start: first, end: last })
  } else {
    for (let start = first, k = 1; start <= last; k++) {
      const boundary = parseDateOnly(addMonthsIso(planStart, lengthMonths * k))
      const end = boundary === null ? last : Math.min(boundary - 1, last)
      bounds.push({ start, end })
      start = end + 1
    }
  }

  const weights = bounds.map(({ start, end }) => end - start + 1)
  const amounts = splitCents(toCents(planAmount), weights)
  let setAsides: number[] | null = null
  if (setAside !== undefined) {
    const plain = splitCents(toCents(setAside), weights)
    // A set-aside above the plan amount has no valid split: it is split plainly, and the editor says it is too much beside the field.
    setAsides = toCents(setAside) <= toCents(planAmount) ? fitSetAsides(amounts, plain) : plain
  }
  return bounds.map(({ start, end }, i) => ({
    periodStart: formatDayNumber(start),
    periodEnd: formatDayNumber(end),
    planAmount: amounts[i] / 100,
    ...(setAsides ? { setAside: setAsides[i] / 100 } : {}),
  }))
}
