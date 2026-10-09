import type {
  AgreementCheck, AgreementCheckPeriod, AgreementCheckPool, BudgetListDto, BudgetListNoBudget, BudgetListRow, ParticipantAlertDto, ParticipantAlertsDto,
} from '@/api/types'

// Builders for the budget warnings' tests (phase 2b): the Budgets list, the participant alerts the dashboard's tile reads, and the agreement check. They are what the SERVER would send - it works
// every figure out, so a test never makes a screen add anything up - and a member with no value is LEFT OUT, as the API leaves it (it omits nulls: Program.cs's WhenWritingNull), so `== null`
// is the only test a screen may use for one. The provider's today in these fixtures is 8 Oct 2026, in the Oct to Dec quarter.

export function budgetRow(overrides: Partial<BudgetListRow> = {}): BudgetListRow {
  const row = {
    participantId: 'p-0002', participantName: 'Sienna Williams', poolId: 'pool-core', poolName: 'Core', kind: 'CoreFlexible' as const, managementType: 'AgencyManaged' as const,
    periodStart: '2026-10-01', periodEnd: '2026-12-31', available: 9000, carried: 0, used: 3180, bookedAhead: 960, forecast: 4140, status: 'OnTrack' as const, unpricedShiftCount: 0, ...overrides,
  }
  // The server sends what is left (or how far over); a fixture that did not say gets it from its own two figures, rounded to the cent.
  return { ...row, remaining: overrides.remaining ?? Math.round((row.available - row.used) * 100) / 100 }
}

export function noBudget(overrides: Partial<BudgetListNoBudget> = {}): BudgetListNoBudget {
  return { participantId: 'p-0005', participantName: 'Noor Hassan', reason: 'NotRecorded', ...overrides }
}

/** One row of each status, in the server's order (Over, Forecast over, Approaching, On track), and two NDIS-funded participants with no budget in force. */
export function budgetList(overrides: Partial<BudgetListDto> = {}): BudgetListDto {
  return {
    asOf: '2026-10-08', approachingPercent: 80,
    rows: [
      budgetRow({ participantId: 'p-0010', participantName: 'Olive Over', poolId: 'pool-a', available: 1000, used: 1500, bookedAhead: 0, forecast: 1500, status: 'Over' }),
      budgetRow({ participantId: 'p-0011', participantName: 'Ford Cast', poolId: 'pool-b', available: 1000, used: 0, bookedAhead: 1440, forecast: 1440, status: 'ForecastOver' }),
      budgetRow({ participantId: 'p-0012', participantName: 'Appa Roach', poolId: 'pool-c', poolName: 'Improved Daily Living Skills', kind: 'Stated', available: 1000, used: 850, bookedAhead: 0, forecast: 850, status: 'Approaching' }),
      budgetRow({ participantId: 'p-0013', participantName: 'Alma Fine', poolId: 'pool-d', available: 8000, used: 400, bookedAhead: 480, forecast: 880, status: 'OnTrack' }),
    ],
    noBudget: [noBudget(), noBudget({ participantId: 'p-0006', participantName: 'Edna Ended', reason: 'PlanEnded', planEnd: '2026-06-30' })],
    ...overrides,
  }
}

export function alert(type: string, overrides: Partial<ParticipantAlertDto> = {}): ParticipantAlertDto {
  const critical = type === 'budget-over' || type === 'budget-ndia-exhausted'
  return { type, severity: critical ? 'Critical' : 'Warning', message: `${type} message`, deepLinkTab: 'funding', ...overrides }
}

/** One participant of the alerts aggregate. The counts follow the alerts, as the server's do. */
export function participantAlerts(participantId: string, participantName: string, alerts: ParticipantAlertDto[], overrides: Partial<ParticipantAlertsDto> = {}): ParticipantAlertsDto {
  return {
    participantId, participantName, isActive: true, alerts,
    criticalCount: alerts.filter(a => a.severity === 'Critical').length, warningCount: alerts.filter(a => a.severity === 'Warning').length, infoCount: alerts.filter(a => a.severity === 'Info').length,
    ...overrides,
  }
}

export function agreementPeriod(overrides: Partial<AgreementCheckPeriod> = {}): AgreementCheckPeriod {
  return {
    periodId: 'period-q2', periodStart: '2026-10-01', periodEnd: '2026-12-31', isCurrent: true, agreementCost: 2355.5, available: 4000, used: 880, remaining: 3120, overBy: 0, ...overrides,
  }
}

export function agreementPool(overrides: Partial<AgreementCheckPool> = {}): AgreementCheckPool {
  const periods = overrides.periods ?? [agreementPeriod()]
  return {
    poolId: 'pool-core', poolName: 'Core', kind: 'CoreFlexible', managementType: 'PlanManaged', agreementCost: periods.reduce((sum, p) => sum + p.agreementCost, 0), over: periods.some(p => p.overBy > 0), overBy: periods.reduce((sum, p) => sum + p.overBy, 0), periods, ...overrides,
  }
}

/** A plan that is running, and an agreement of $2,355.50 in the one pool, inside what the quarter has left. */
export function agreementCheck(overrides: Partial<AgreementCheck> = {}): AgreementCheck {
  const pools = overrides.pools ?? [agreementPool()]
  return {
    hasBudget: true, planId: 'plan-1', planStart: '2026-07-01', planEnd: '2027-06-30', asOf: '2026-10-08', periodFrom: '2026-10-12', periodTo: '2026-12-20',
    agreementCost: pools.reduce((sum, p) => sum + p.agreementCost, 0), pools, notInARecordedPool: 0, outsideThePlan: 0, ...overrides,
  }
}

/** No plan is running: no budget recorded (or the plan ended: say so with noBudgetReason and planEnd). The server answers with the day and the reason, nothing else. */
export function noBudgetCheck(overrides: Partial<AgreementCheck> = {}): AgreementCheck {
  return { hasBudget: false, noBudgetReason: 'NotRecorded', asOf: '2026-10-08', periodFrom: '2026-10-12', periodTo: '2026-12-20', agreementCost: 0, pools: [], notInARecordedPool: 0, outsideThePlan: 0, ...overrides }
}
