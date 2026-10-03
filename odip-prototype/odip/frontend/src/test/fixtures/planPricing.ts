import type { DraftBlock, PlanBlock, PlanPricingSettingsDto, PlannedLine, PlanQuote } from '@/api/types'
import { emptyBlock } from '@/lib/planBlocks'

/**
 * Fixtures for the plan builder's tests: blocks as the engine takes them, lines and quotes as it answers (the brief's own numbers: Monday and Wednesday 09:00 to 13:00 is 8 hours at
 * $73.58 a week), and the provider's settings. Spread the builders and change what a test is about.
 */

export const mondayWednesday = (id = 'b1', changes: Partial<PlanBlock> = {}): PlanBlock => ({ ...emptyBlock(id, 'NSW'), days: ['Monday', 'Wednesday'], ...changes })

export const draftBlock = (block: PlanBlock = mondayWednesday(), requirements: Partial<DraftBlock['requirements']> = {}): DraftBlock => ({
  block, requirements: { workerGender: 'NoPreference', driver: false, skills: [], ...requirements },
})

export const settings = (changes: Partial<PlanPricingSettingsDto> = {}): PlanPricingSettingsDto => ({
  registrationGroupsHeld: ['0107', '0104', '0125', '0136', '0115', '0108'], registrationGroupsConfirmed: true, crossingPolicy: 'Split', claimProviderTravel: true, travelKmRateStandard: 0.99,
  travelKmRateAccessible: 2.76, travelRatesProvisional: true, groupOutings: 'GroupActivities', staUsesHourlyAndAccommodation: true, approverRoles: ['Admin', 'Coordinator'], isDefault: false, ...changes,
})

export const line = (changes: Partial<PlannedLine> = {}): PlannedLine => ({
  blockId: 'b1', kind: 'Support', itemCode: '04_104_0125_6_1', unit: 'H', qty: 4, unitPrice: 73.58, total: 294.32, serviceDate: '2026-10-12', band: 'Weekday Daytime', flags: 'None',
  shortNoticeCancellationAllowed: true, isPriced: true,
  trace: {
    rules: ['bands:weekday-daytime', 'price:catalogue-by-service-date'], why: 'Weekday Daytime (Mon-Fri 06:00-20:00) on Mon 12 Oct 2026, 09:00 to 13:00; 1 worker for 1 participant; price from catalogue 2026-27.',
    catalogueVersion: '2026-27', priceBasisFrom: '2026-07-01', zone: 'National', maximumUnitPrice: 73.58, workers: 1, participantsPresent: 1, openQuestions: [],
  }, ...changes,
})

export const emptyTotals = (): PlanQuote['totals'] => ({
  amount: 0, supportHours: 0, lineCount: 0, unpricedLines: 0, reviewLines: 0, provisionalLines: 0, holidayOccurrences: 0, holidayUplift: 0, byCategory: [], byBlock: [],
})

export const quote = (changes: Partial<PlanQuote> = {}): PlanQuote => ({
  periodFrom: '2026-10-01', periodTo: '2027-06-30', lines: [], issues: [], notices: [], holidayOccurrences: [], openQuestions: [], totals: emptyTotals(), timeBasis: 'tz-database', needsReview: false, ...changes,
})

/** What the running budget gets: the whole agreement (no lines) and one ordinary week of it, for one block. */
export function budgetOf(blockId = 'b1'): { period: PlanQuote; weekly: PlanQuote; week: { from: string; to: string } } {
  return {
    period: quote({
      totals: {
        ...emptyTotals(), amount: 30610.28, supportHours: 416, lineCount: 208,
        byCategory: [{ paceCategory: 4, name: 'Assistance with Social, Economic and Community Participation', amount: 30610.28, hours: 416 }],
        byBlock: [{ blockId, amount: 30610.28, supportHours: 416, occurrences: 104, skippedOccurrences: 0 }],
      },
    }),
    weekly: quote({
      periodFrom: '2026-10-12', periodTo: '2026-10-18',
      totals: { ...emptyTotals(), amount: 588.64, supportHours: 8, lineCount: 2, byBlock: [{ blockId, amount: 588.64, supportHours: 8, occurrences: 2, skippedOccurrences: 0 }] },
    }),
    week: { from: '2026-10-12', to: '2026-10-18' },
  }
}
