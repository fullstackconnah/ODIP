// Fixtures for the budget override lane's own tests. Every figure is a literal the server would
// have sent — nothing here is computed, so a test that fails is about the component, not arithmetic.
//
// Kept in this folder (not in a shared test-fixtures file) because these shapes are this lane's
// contract and the integration owner will want to see exactly what the components accept.

import type {
  BudgetFigure,
  BudgetFindingView,
  BudgetPeriodFigures,
  EmergencyReviewDetails,
} from './budgetOverrideTypes'
import { BUDGET_FINDING_CODES } from './budgetOverrideTypes'

/** A recorded amount. */
export const amount = (n: number): BudgetFigure => ({ kind: 'value', amount: n })

/** The server said nothing is recorded. Not a zero. */
export const notRecorded: BudgetFigure = { kind: 'notRecorded' }

/** The request has not answered, or failed. Not a zero either. */
export const unknown: BudgetFigure = { kind: 'unknown' }

/** The finding the phase-3 server returns for an over-forecast hard limit, as a Coordinator sees it. */
export const forecastOverFinding: BudgetFindingView = {
  code: BUDGET_FINDING_CODES.forecastOver,
  severity: 'Blocking',
  message: 'Takes Core (flexible) to $8,640.00 of $8,000.00 for Oct–Dec 2026.',
  requiresReason: false,
}

/** The same overrun as an Admin sees it: a warning the Admin can accept with a reason. */
export const forecastOverWarningForAdmin: BudgetFindingView = {
  ...forecastOverFinding,
  severity: 'Warning',
  requiresReason: true,
}

/** The same finding with the figures the server works it out from (what the readout prints). */
export const forecastOverWithFigures: BudgetFindingView = {
  ...forecastOverFinding,
  budget: {
    poolName: 'Core (flexible)', periodStart: '2026-10-01', periodEnd: '2026-12-31', available: 8000, used: 4200, remaining: 3800, forecast: 8640, shiftCost: 292.32, overBy: 640, bookedAhead: 4147.68, unpricedShiftCount: 0,
  },
}

/** An "approaching" warning: no reason required, and no emergency path involved. */
export const approachingFinding: BudgetFindingView = {
  code: BUDGET_FINDING_CODES.approaching,
  severity: 'Warning',
  message: 'Core (flexible) is at 82% of the available budget for Oct–Dec 2026.',
  requiresReason: false,
}

/** The ordinary, complete case: every figure the server can send. */
export const fullFigures: BudgetPeriodFigures = {
  pool: 'Core (flexible)',
  period: 'Oct–Dec 2026',
  available: amount(8000),
  used: amount(4200),
  bookedAhead: amount(4147.68),
  shiftCost: amount(292.32),
  projectedTotal: amount(8640),
  projectedOverrun: amount(640),
}

/** Nothing the server could work out, and nothing recorded either. Every cell is an en dash. */
export const emptyFigures: BudgetPeriodFigures = {
  pool: 'Core (flexible)',
  period: 'Oct–Dec 2026',
  available: notRecorded,
  used: notRecorded,
  bookedAhead: notRecorded,
  shiftCost: amount(292.32),
  projectedTotal: unknown,
  projectedOverrun: unknown,
}

/** Zero is an answer: a pool recorded at $0 that is fully committed. */
export const zeroFigures: BudgetPeriodFigures = {
  pool: 'Improved Daily Living Skills',
  period: 'Jan–Mar 2027',
  available: amount(0),
  used: amount(0),
  bookedAhead: amount(0),
  shiftCost: amount(0),
  projectedTotal: amount(0),
  projectedOverrun: amount(0),
}

/** A SupportWorker / ReadOnly viewer: money never reaches the DOM. */
export const restrictedFigures: BudgetPeriodFigures = { ...fullFigures, restricted: true }

/** A saved emergency shift, not yet looked at by an Admin. */
export const pendingEmergency: EmergencyReviewDetails = {
  kind: 'emergency',
  state: 'pending',
  reason: 'Emergency or safety: Participant was unsafe at the time of the shift and needed support now',
  recordedAt: '2026-10-04T03:12:00Z',
  reviewedBy: null,
  reviewedAt: null,
  reviewTaskTitle: 'Review emergency shift over budget: Alex Nguyen on 4 Oct 2026',
}

/** The same shift after the review, as the server recorded it. */
export const reviewedEmergency: EmergencyReviewDetails = {
  ...pendingEmergency,
  state: 'reviewed',
  reviewedBy: 'Priya Raman',
  reviewedAt: '2026-10-05T01:04:00Z',
}

/** An Admin override: the Admin's own act with a written reason, so it has no review to wait for. */
export const adminOverrideShift: EmergencyReviewDetails = {
  kind: 'adminOverride',
  reason: 'Participant’s plan manager confirmed the set-aside was increased on 3 Oct.',
  recordedAt: '2026-10-04T04:40:00Z',
}

/** An emergency shift as a restricted viewer sees it: a marker and a state, nothing else. */
export const restrictedPendingEmergency: EmergencyReviewDetails = { ...pendingEmergency, restricted: true }

/** A reason that is long enough for the emergency description's own minimum. */
export const GOOD_EMERGENCY_REASON =
  'Participant was unsafe at the time of the shift and needed support now'

/** A reason with real words, but under the emergency minimum. */
export const SHORT_REASON = 'Unsafe'
