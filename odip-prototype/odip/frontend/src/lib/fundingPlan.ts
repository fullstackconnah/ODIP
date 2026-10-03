import { PLAN_TYPE_LABELS, type PlanType } from '@/api/types/enums'
import type { FundingPlanDto, FundingPoolDto } from '@/api/types'
import { periodLengthLabel } from './fundingPeriods'
import { formatDayNumber, parseDateOnly } from './dateOnly'

// How a recorded plan budget reads on screen: which plan is the current one, what a pool's categories are called, and the plan's own facts in words. Pure, so the Funding
// tab, the intake card and the tests say the same thing.

export type PlanStatus = 'Current' | 'Upcoming' | 'Ended'

// Fixed abbreviations, not Intl: en-AU renders September as "Sept" in some ICU builds and "Sep" in others, and a plan's dates must not change with the browser.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** A calendar day written out: "1 Jul 2026". The year is never dropped (a plan crosses years), and an empty or unreadable date is an en dash. */
export function writtenDay(iso: string | null | undefined): string {
  const day = parseDateOnly(iso)
  if (day === null) return '–'
  const [year, month, dayOfMonth] = formatDayNumber(day).split('-').map(Number)
  return `${dayOfMonth} ${MONTHS[month - 1]} ${year}`
}

/** A span of days, both ends written out: "1 Jul 2026 – 30 Jun 2027". */
export const writtenSpan = (start: string, end: string): string => `${writtenDay(start)} – ${writtenDay(end)}`

/** "01", "04", "15": the two-digit number the plan prints for a support category. */
export function paceNumber(category: number): string {
  return String(category).padStart(2, '0')
}

/** The categories a pool covers: "01–04" for a Core (flexible) pool, the number ("15") for a stated one. */
export function categoriesLabel(pool: Pick<FundingPoolDto, 'kind' | 'paceCategory'>): string {
  return pool.kind === 'CoreFlexible' ? '01–04' : paceNumber(pool.paceCategory)
}

/** Who manages the money, spelled the way the intake form's Plan Type control spells it. */
export function managementLabel(type: PlanType): string {
  return PLAN_TYPE_LABELS[type] ?? type
}

/** Whether a plan is running on `today` ("YYYY-MM-DD"), has not started, or has ended. */
export function planStatus(plan: Pick<FundingPlanDto, 'planStart' | 'planEnd'>, today: string): PlanStatus {
  if (today < plan.planStart) return 'Upcoming'
  return today > plan.planEnd ? 'Ended' : 'Current'
}

/**
 * The plan the tab leads with: the one running today; failing that the next one to start; failing that the newest (every plan has ended). `plans` is newest first, as the server
 * sends it. Undefined when there are none.
 */
export function currentPlanOf(plans: readonly FundingPlanDto[], today: string): FundingPlanDto | undefined {
  const running = plans.find(plan => planStatus(plan, today) === 'Current')
  if (running) return running
  const upcoming = plans.filter(plan => planStatus(plan, today) === 'Upcoming')
  return upcoming.length > 0 ? upcoming[upcoming.length - 1] : plans[0]
}

/** "Confirmed 20/09/2026 by Priya Coordinator", or "Not confirmed" when nobody has said they checked the figures. */
export function confirmedLabel(plan: Pick<FundingPlanDto, 'confirmedOn' | 'confirmedByName'>, formatDate: (iso: string) => string): string {
  if (!plan.confirmedOn && !plan.confirmedByName) return 'Not confirmed'
  const parts = ['Confirmed']
  if (plan.confirmedOn) parts.push(formatDate(plan.confirmedOn))
  if (plan.confirmedByName) parts.push(`by ${plan.confirmedByName}`)
  return parts.join(' ')
}

export { periodLengthLabel }

/** The plan's total across its pools. Pools of different management types are separate money, so this is only for a glance line, never for a limit. */
export function planTotal(plan: Pick<FundingPlanDto, 'pools'>): number {
  return plan.pools.reduce((cents, pool) => cents + Math.round(pool.planTotal * 100), 0) / 100
}
