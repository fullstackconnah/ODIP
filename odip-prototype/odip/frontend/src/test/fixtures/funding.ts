import type { FundingPeriodDto, FundingPlanDto, FundingPoolDto, PaceCategoryDto } from '@/api/types'

// Builders for the budget feature's tests: a 3-monthly plan for 1 Jul 2026 to 30 Jun 2027 with a Core (flexible) pool and a stated pool, and the NDIS support categories as the
// server serves them.

export function period(overrides: Partial<FundingPeriodDto> = {}): FundingPeriodDto {
  return { id: 'period-1', position: 0, periodStart: '2026-07-01', periodEnd: '2026-09-30', planAmount: 2000, ...overrides }
}

/** The four quarters of 1 Jul 2026 to 30 Jun 2027, each holding `each`, and `setAside` when given. */
export function quarters(each = 2000, setAside?: number, prefix = 'q'): FundingPeriodDto[] {
  const bounds: [string, string][] = [['2026-07-01', '2026-09-30'], ['2026-10-01', '2026-12-31'], ['2027-01-01', '2027-03-31'], ['2027-04-01', '2027-06-30']]
  return bounds.map(([periodStart, periodEnd], position) => ({ id: `${prefix}-${position}`, position, periodStart, periodEnd, planAmount: each, ...(setAside === undefined ? {} : { setAside }) }))
}

export function pool(overrides: Partial<FundingPoolDto> = {}): FundingPoolDto {
  const periods = overrides.periods ?? quarters()
  return {
    id: 'pool-core', position: 0, kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged', name: 'Core (flexible)',
    planTotal: periods.reduce((sum, p) => sum + p.planAmount, 0),
    ...(periods.every(p => p.setAside !== undefined) && periods.length > 0 ? { setAsideTotal: periods.reduce((sum, p) => sum + (p.setAside ?? 0), 0) } : {}),
    periods, ...overrides,
  }
}

export function statedPool(overrides: Partial<FundingPoolDto> = {}): FundingPoolDto {
  return pool({ id: 'pool-15', position: 1, kind: 'Stated', paceCategory: 15, managementType: 'AgencyManaged', name: 'Improved Daily Living Skills', periods: quarters(500, undefined, 's'), ...overrides })
}

export function plan(overrides: Partial<FundingPlanDto> = {}): FundingPlanDto {
  return {
    id: 'plan-1', participantId: 'participant-1', planStart: '2026-07-01', planEnd: '2027-06-30', reassessmentDate: '2027-05-01', periodLengthMonths: 3, evidence: 'PlanCopy',
    confirmedOn: '2026-09-20', confirmedByName: 'Priya Coordinator', notes: 'From the plan the participant shared.', revision: 1,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    pools: [pool({ periods: quarters(2000, 1000) }), statedPool()], ...overrides,
  }
}

/** The NDIS support categories as GET api/v1/funding/pace-categories serves them (a subset is enough for the editor: the numbers a coordinator picks from, and the ones never offered). */
export const PACE_CATEGORIES: PaceCategoryDto[] = [
  { number: 1, name: 'Assistance with Daily Life', budget: 'Core', flexible: true, offeredAsStatedPool: false },
  { number: 2, name: 'Transport', budget: 'Core', flexible: true, offeredAsStatedPool: false },
  { number: 3, name: 'Consumables', budget: 'Core', flexible: true, offeredAsStatedPool: false },
  { number: 4, name: 'Assistance with Social, Economic and Community Participation', budget: 'Core', flexible: true, offeredAsStatedPool: false },
  { number: 5, name: 'Assistive Technology', budget: 'Capital', flexible: false, offeredAsStatedPool: true },
  { number: 9, name: 'Increased Social and Community Participation', budget: 'CapacityBuilding', flexible: false, offeredAsStatedPool: true },
  { number: 15, name: 'Improved Daily Living Skills', budget: 'CapacityBuilding', flexible: false, offeredAsStatedPool: true },
  { number: 16, name: 'Home and Living', budget: 'Core', flexible: false, offeredAsStatedPool: true },
  { number: 18, name: 'Recurring Transport', budget: 'Recurring', flexible: true, offeredAsStatedPool: false },
  { number: 20, name: 'Behaviour Support', budget: 'CapacityBuilding', flexible: false, offeredAsStatedPool: true },
]
