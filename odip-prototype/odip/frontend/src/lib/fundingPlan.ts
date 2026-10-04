import { PLAN_TYPE_LABELS, type PlanType } from '@/api/types/enums'
import type { FundingPlanDto, FundingPoolDto } from '@/api/types'
import { periodLengthLabel } from './fundingPeriods'
import { parseDateOnly } from './dateOnly'
import { formatDateRange } from './dateRange'

// How a recorded plan budget reads on screen: which plan is the current one, what a pool's categories are called, and the plan's own facts in words. Pure, so the Funding
// tab, the intake card and the tests say the same thing.

export type PlanStatus = 'Current' | 'Upcoming' | 'Ended'

const NBSP = String.fromCharCode(160)

/**
 * Keeps a written date in one piece: the spaces between its day, month and year become non-breaking, so a line can only break at the dash between two dates (never "1 Jul 2026 – 30 Jun /
 * 2027" or "30 / Sep 2026"). The spaces round a dash stay ordinary, which is where a break is wanted. Text matchers normalise a non-breaking space to a plain one.
 */
function keepTogether(text: string): string {
  const dash = '–'
  return text.replace(/ /g, (space, offset: number) => (text[offset - 1] === dash || text[offset + 1] === dash ? space : NBSP))
}

/**
 * A calendar day written out: "1 Jul 2026". The year is never dropped (a plan crosses years), and an empty or unreadable date is an en dash. The wording is lib/dateRange.ts's (fixed
 * month abbreviations, never Intl: en-AU renders September as "Sept" in some ICU builds and "Sep" in others), which is what the trip header uses.
 */
export function writtenDay(iso: string | null | undefined): string {
  return parseDateOnly(iso) === null ? '–' : keepTogether(formatDateRange(iso, iso))
}

/** A span of days written the way the rest of the hub writes a range: "1 Jul 2026 – 30 Jun 2027", "1 Jul – 30 Sep 2026" inside one year, "14–17 Aug 2026" inside one month. */
export function writtenSpan(start: string, end: string): string {
  if (parseDateOnly(start) === null || parseDateOnly(end) === null) return `${writtenDay(start)} – ${writtenDay(end)}`
  return keepTogether(formatDateRange(start, end))
}

/** "Plan 1 Jul 2025 – 30 Jun 2026": how an earlier or later plan is titled, so a list of plans says which is which. */
export const planTitle = (plan: Pick<FundingPlanDto, 'planStart' | 'planEnd'>): string => `Plan ${writtenSpan(plan.planStart, plan.planEnd)}`

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
