import type { ClaimBudgetDto, ClaimBudgetRowDto, LedgerBucket, LedgerFigures, LedgerPeriod, LedgerPool, LedgerRow, ParticipantLedgerDto } from '@/api/types'

// Builders for the budget ledger's tests (phase 2a). The default ledger is one Core (flexible) pool under plan management whose limits are set-asides of $2,000 a quarter for 1 Jul 2026 to
// 30 Jun 2027, with the provider's today inside the second quarter (4 Oct 2026) and that quarter forecast over: $2,500 available ($2,000 and $500 rolled over), $1,680 used and $960 booked ahead.
// Figures are what the server would send (it works them out; a test never makes a screen add anything up), and a member with no value is left out, as the server leaves it.

export function figures(overrides: Partial<LedgerFigures> = {}): LedgerFigures {
  return {
    limit: 2000, carried: 500, available: 2500, claimed: 1200, pending: 480, used: 1680, bookedAhead: 960, forecast: 2640, unpricedTripDayCount: 0, remaining: 820, forecastRemaining: -140, status: 'ForecastOver', ...overrides,
  }
}

export function ledgerRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'row-1', kind: 'ClaimLine', group: 'Claimed', date: '2026-10-01', description: 'TC-4301-20261001 · 04_Weekday_STD · 8 h', amount: 480, status: 'Submitted', link: '/claims/claim-1', unpricedTripDayCount: 0, ...overrides,
  }
}

/** The rows of the second quarter: two claimed, one pending claim line, and two booked-ahead shifts. */
export function q2Rows(): LedgerRow[] {
  return [
    ledgerRow({ id: 'l1', date: '2026-10-01', amount: 800, status: 'Submitted', link: '/claims/claim-1', description: 'TC-4301-20261001 · 04_Weekday_STD · 8 h' }),
    ledgerRow({ id: 'l2', date: '2026-10-02', amount: 400, status: 'Paid', link: '/claims/claim-2', description: 'TC-4301-20261002 · 04_Weekday_STD · 4 h' }),
    ledgerRow({ id: 'l3', date: '2026-10-02', amount: 480, group: 'Pending', status: 'Draft', link: '/claims/claim-3', description: 'TC-4301-20261003 · 04_Weekday_STD · 8 h' }),
    ledgerRow({ id: 's1', kind: 'FutureShift', group: 'BookedAhead', date: '2026-10-06', amount: 480, status: 'Published', link: '/rostering?date=2026-10-06', description: 'Shift 09:00–17:00 · 8 h' }),
    ledgerRow({ id: 's2', kind: 'FutureShift', group: 'BookedAhead', date: '2026-10-07', amount: 480, status: 'Draft', link: '/rostering?date=2026-10-07', description: 'Shift 09:00–17:00 · 8 h' }),
  ]
}

export function ledgerPeriod(overrides: Partial<LedgerPeriod> = {}): LedgerPeriod {
  const rows = overrides.rows ?? []
  return {
    id: 'period-q2', position: 1, periodStart: '2026-10-01', periodEnd: '2026-12-31', isCurrent: true, pastUnresolvedCount: 0, rowCount: rows.length, rows, ...figures(), ...overrides,
  }
}

/** The four quarters of the default plan, the second holding today. */
export function quarterLedgers(): LedgerPeriod[] {
  return [
    ledgerPeriod({
      id: 'period-q1', position: 0, periodStart: '2026-07-01', periodEnd: '2026-09-30', isCurrent: false, ...figures({ carried: 0, available: 2000, claimed: 1500, pending: 0, used: 1500, bookedAhead: 0, forecast: 1500, remaining: 500, forecastRemaining: 500, status: 'OnTrack' }),
      rows: [ledgerRow({ id: 'q1a', date: '2026-09-15', amount: 1500, description: 'TC-4301-20260915 · 04_Weekday_STD · 24 h', link: '/claims/claim-0' })], rowCount: 1,
    }),
    ledgerPeriod({ rows: q2Rows(), rowCount: 5 }),
    ledgerPeriod({
      id: 'period-q3', position: 2, periodStart: '2027-01-01', periodEnd: '2027-03-31', isCurrent: false, ...figures({ carried: 820, available: 2820, claimed: 0, pending: 0, used: 0, bookedAhead: 0, forecast: 0, remaining: 2820, forecastRemaining: 2820, status: 'OnTrack' }),
    }),
    ledgerPeriod({
      id: 'period-q4', position: 3, periodStart: '2027-04-01', periodEnd: '2027-06-30', isCurrent: false, ...figures({ carried: 2820, available: 4820, claimed: 0, pending: 0, used: 0, bookedAhead: 0, forecast: 0, remaining: 4820, forecastRemaining: 4820, status: 'OnTrack' }),
    }),
  ]
}

export function ledgerPool(overrides: Partial<LedgerPool> = {}): LedgerPool {
  return {
    id: 'pool-core', name: 'Core (flexible)', kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged', hasSetAside: true, periods: quarterLedgers(), pastUnresolvedCount: 0,
    planTotal: figures({ limit: 8000, carried: 0, available: 8000, claimed: 2700, pending: 480, used: 3180, bookedAhead: 960, forecast: 4140, remaining: 4820, forecastRemaining: 3860, status: 'OnTrack' }), ...overrides,
  }
}

const noBucket: LedgerBucket = { count: 0, amount: 0, rows: [] }

export function participantLedger(overrides: Partial<ParticipantLedgerDto> = {}): ParticipantLedgerDto {
  return {
    planId: 'plan-1', planStart: '2026-07-01', planEnd: '2027-06-30', planIsCurrent: true, asOf: '2026-10-04', timeBasis: 'Australia/Sydney', approachingPercent: 80,
    pools: [ledgerPool()], notInARecordedPool: noBucket, outsideThePlanDates: noBucket, ...overrides,
  }
}

/** What the server sends for a participant with no plan that has started: no plan and no pools. */
export function noLedger(): ParticipantLedgerDto {
  return { planIsCurrent: false, asOf: '2026-10-04', timeBasis: 'Australia/Sydney', approachingPercent: 80, pools: [], notInARecordedPool: noBucket, outsideThePlanDates: noBucket }
}

export function budgetRow(overrides: Partial<ClaimBudgetRowDto> = {}): ClaimBudgetRowDto {
  return {
    placement: 'Pool', poolName: 'Core (flexible)', periodStart: '2026-10-01', periodEnd: '2026-12-31', available: 2500, usedBefore: 1200, thisClaim: 480, usedAfter: 1680, leftAfter: 820, statusAfter: 'OnTrack', ...overrides,
  }
}

export function claimBudget(rows: ClaimBudgetRowDto[] = [budgetRow()], participantName = 'Sophie Brown', participantId = 'participant-1'): ClaimBudgetDto {
  return { participants: [{ participantId, participantName, rows }] }
}
