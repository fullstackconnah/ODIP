import type { BudgetStatus, ClaimBudgetRowDto, LedgerGroup, LedgerPeriod, LedgerPool, LedgerRow } from '@/api/types'
import { formatDateRange, formatDayMonth } from './dateRange'
import { plural } from './format'
import type { FactChipTone } from '@/components/FactBar'

// How the budget ledger reads in words and figures (phase 2a). The server works every figure out; nothing here adds anything up. These only decide how a figure is written, which period a
// strip is about, how rows are grouped, and what the one sentence per pool says. Pure, so the Funding tab, the generate-claim modals and the claim page say the same thing.

/**
 * A figure in a strip or a sentence: whole dollars when it is whole ("$3,120"), cents when it is not ("$3,120.50"), so a big figure stays short. A negative has a minus ("-$80") and a
 * value that rounds to nothing is "$0", never "-$0". The ledger's own rows always show cents.
 */
export function money(amount: number): string {
  const cents = Math.round(Math.abs(amount) * 100)
  if (cents === 0) return '$0'
  const whole = cents % 100 === 0
  const text = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(cents / 100)
  return amount < 0 ? `-${text}` : text
}

/** The period a pool's strip and sentence are about: the one holding today, or, once the plan has ended and none does, the last one. */
export function focusPeriodOf(pool: LedgerPool): LedgerPeriod | undefined {
  return pool.periods.find(period => period.isCurrent) ?? pool.periods[pool.periods.length - 1]
}

/** The chip's tone for a status: on track is go, approaching and forecast over ask for attention (nothing is past the limit yet), over has gone past it. */
export function chipToneOf(status: BudgetStatus): Extract<FactChipTone, 'success' | 'warning' | 'danger' | 'neutral'> {
  switch (status) {
    case 'OnTrack': return 'success'
    case 'Approaching':
    case 'ForecastOver': return 'warning'
    case 'Over': return 'danger'
    default: return 'neutral'
  }
}

/**
 * The one plain sentence of a pool, the screen's focal moment: what is left of what, to when, and where the booked shifts would take it. For example "Core: $3,120 left of $8,000 this period
 * (to 31 Dec). Booked shifts would finish $640 over." With no set-aside the figure is the plan's ("of the plan's $8,000"). What is rolled over is named when there is some, and nothing is
 * said about the future when nothing is booked ahead. When booked trip days carry no catalogue rate the sentence says so, because the forecast then under-counts the claim by those
 * days and a person budgeting from it must not be left to find that out on the claim.
 */
export function poolSentence(pool: LedgerPool, period: LedgerPeriod): string {
  const name = pool.kind === 'CoreFlexible' ? 'Core' : pool.name
  const of = pool.hasSetAside ? `the ${money(period.available)} set aside` : `the plan's ${money(period.available)}`
  const when = period.isCurrent ? 'this period' : 'in the last period'
  const rolled = period.carried > 0 ? `, including ${money(period.carried)} rolled over, not confirmed` : ''
  const stand = period.remaining >= 0 ? `${money(period.remaining)} left of ${of}` : `${money(-period.remaining)} over ${of}`
  const first = `${name}: ${stand} ${when} (to ${formatDayMonth(period.periodEnd)})${rolled}.`
  const forecast = period.bookedAhead <= 0
    ? ''
    : period.forecastRemaining < 0
      ? ` Booked shifts would finish ${money(-period.forecastRemaining)} over.`
      : ` Booked shifts would finish with ${money(period.forecastRemaining)} to spare.`
  const gap = period.unpricedTripDayCount > 0 ? ` ${unpricedTripDaySentence(period.unpricedTripDayCount)}` : ''
  return `${first}${forecast}${gap}`
}

/**
 * The one sentence for booked trip days the catalogue cannot price. They are counted at $0 (no rate is invented for them), so the forecast above is
 * understated by exactly those days until a rate is imported.
 */
export function unpricedTripDaySentence(count: number): string {
  const days = plural(count, 'booked trip day')
  return `${days} no catalogue rate covers, so they are counted at $0 and the forecast above is low by that much until the catalogue has a rate for them.`
}

const GROUP_ORDER: readonly LedgerGroup[] = ['Claimed', 'Pending', 'BookedAhead']

/** The rows in the ledger's three groups, in their order (claimed, pending, booked ahead); a group nobody has a row in comes back empty, so the screen can say there is nothing in it. */
export function rowsByGroup(rows: readonly LedgerRow[]): { group: LedgerGroup; rows: LedgerRow[] }[] {
  return GROUP_ORDER.map(group => ({ group, rows: rows.filter(row => row.group === group) }))
}

/** The quiet line under the ledger: what the estimates are made from, and the one thing they leave out. */
export const quietEstimateLine = 'Estimates use the rates ODIP will claim with; shift claims price community access only for now.'

/**
 * The sentence of one budget row of a claim, and whether it is over (the screens give an over line the warning tone). A claim is never blocked by it: it only says what the claim uses and what
 * is left.
 */
export function claimBudgetLine(row: ClaimBudgetRowDto): { text: string; over: boolean } {
  if (row.placement === 'NotInAPool') return { text: `${money(row.thisClaim)} is not in a recorded pool, so it uses none of the budget.`, over: false }
  if (row.placement === 'OutsideThePlan') return { text: `${money(row.thisClaim)} is outside the plan's dates, so it uses none of the budget.`, over: false }
  const left = row.leftAfter ?? 0
  const period = formatDateRange(row.periodStart, row.periodEnd)
  const rest = left < 0 ? `${money(-left)} over after` : `${money(left)} left after`
  return { text: `Uses ${money(row.thisClaim)} of ${row.poolName} (${period}); ${rest}.`, over: left < 0 }
}
