import type { PlanType } from './enums'
import type { FundingRouteType } from './billing'

// A participant's NDIS plan budget (budget feature, phase 1): the wire shapes of api/v1/participants/{id}/funding and api/v1/funding. Enums travel as their names, dates as
// "YYYY-MM-DD" (calendar days, inclusive), money as dollars. A null member is left out, so every optional member is genuinely absent when it has no value. Money is on these
// endpoints only (SuperAdmin, Admin and Coordinator): the participant record carries none.

export const BUDGET_EVIDENCE_SOURCES = ['PlanCopy', 'PlanManager', 'Participant', 'SupportCoordinator', 'Other'] as const
export type BudgetEvidenceSource = typeof BUDGET_EVIDENCE_SOURCES[number]

/** Where the figures came from, as a coordinator says it. */
export const BUDGET_EVIDENCE_LABELS: Record<BudgetEvidenceSource, string> = {
  PlanCopy: 'A copy of the plan',
  PlanManager: 'The plan manager',
  Participant: 'The participant',
  SupportCoordinator: 'The support coordinator',
  Other: 'Another source',
}

export type FundingPoolKind = 'CoreFlexible' | 'Stated'
export type BudgetLimitMode = 'Warn' | 'HardLimit'
export type PaceBudget = 'Core' | 'CapacityBuilding' | 'Capital' | 'Recurring'

/** One NDIS support category, as GET api/v1/funding/pace-categories serves it. The screens keep no copy of this list. */
export interface PaceCategoryDto {
  number: number
  name: string
  budget: PaceBudget
  flexible: boolean
  /** False for 01 to 04 (Core flexible) and 18 (paid to the participant): never offered as a stated support. */
  offeredAsStatedPool: boolean
}

export interface FundingPeriodDto {
  id: string
  position: number
  periodStart: string
  periodEnd: string
  planAmount: number
  /** The organisation's share; absent when none is recorded (the limit is then the plan amount). */
  setAside?: number
}

export interface FundingPoolDto {
  id: string
  position: number
  kind: FundingPoolKind
  /** 0 for Core (flexible); the support category number for a stated pool. */
  paceCategory: number
  managementType: PlanType
  name: string
  notes?: string
  /** The sum of the periods' plan amounts. */
  planTotal: number
  /** The sum of the periods' set-asides; absent when the pool has none. */
  setAsideTotal?: number
  periods: FundingPeriodDto[]
}

export interface FundingPlanDto {
  id: string
  participantId: string
  planStart: string
  planEnd: string
  reassessmentDate?: string
  /** 1, 3, 6 or 12; absent when the plan has no funding periods. */
  periodLengthMonths?: number
  evidence: BudgetEvidenceSource
  confirmedOn?: string
  confirmedByName?: string
  notes?: string
  revision: number
  createdAt: string
  updatedAt: string
  pools: FundingPoolDto[]
}

export interface FundingPlansDto {
  /** Newest first. */
  plans: FundingPlanDto[]
  /** The plan dates the participant's profile carries, so a mismatch with a recorded plan can be shown. */
  profilePlanDates: { start?: string; end?: string }
}

export interface SaveFundingPeriodDto {
  periodStart: string
  periodEnd: string
  planAmount: number
  setAside?: number
}

export interface SaveFundingPoolDto {
  kind: FundingPoolKind
  paceCategory: number
  managementType: PlanType
  name?: string
  notes?: string
  periods: SaveFundingPeriodDto[]
}

/** The body of a create (POST) and a replace (PUT): the plan's fields and ALL its pools and periods. A PUT carries the revision it was made from. */
export interface SaveFundingPlanDto {
  planStart: string
  planEnd: string
  reassessmentDate?: string
  periodLengthMonths?: number
  evidence: BudgetEvidenceSource
  confirmedOn?: string
  confirmedByName?: string
  notes?: string
  revision?: number
  pools: SaveFundingPoolDto[]
}

/** The `data` of a 409 for a stale save (`code` "funding-revision-conflict"). */
export interface FundingRevisionConflict { currentRevision: number }
/** The `data` of a 409 for overlapping plans (`code` "funding-plan-overlap"). */
export interface FundingPlanOverlap { conflictingPlanId: string; conflictingPlanStart: string; conflictingPlanEnd: string }

export interface ApplyPlanDatesResult { start: string; end: string; changed: boolean }

export interface BillingSourceHintRow {
  id: string
  routeType: FundingRouteType
  budgetCategory?: string
  budget: number
  planStartDate?: string
  planEndDate?: string
  payerName?: string
}

/** What the participant's Billing funding sources already say, as a one-off starting point. Empty `rows` means there is nothing to start from. */
export interface BillingSourcesHintDto {
  total: number
  planStart?: string
  planEnd?: string
  managementType?: PlanType
  rows: BillingSourceHintRow[]
}

export interface BudgetSettingsDto {
  mode: BudgetLimitMode
  approachingPercent: number
  /** True while nothing is stored: these are the defaults. */
  isDefault: boolean
}

/** A change to the budget settings: each setting changes only when it is sent. */
export interface UpdateBudgetSettingsDto {
  mode?: BudgetLimitMode
  approachingPercent?: number
}

// ── The budget ledger (phase 2a) ────────────────────────────────────────────
// What a participant's current plan has been spent on, is waiting to be spent on and is booked to be spent on, per pool and funding period: GET api/v1/participants/{id}/funding/ledger.
// Computed by the server on every read, from the claims, shifts and trip bookings; no screen adds anything up. SuperAdmin, Admin and Coordinator only (money). Dates are calendar days
// ("YYYY-MM-DD", the provider's own), enums travel as their names, and a null member is left out.

/** How a pool stands in a period, or over the whole plan: the worst that applies. `None` is only ever the absence of a plan that has started: it is never an all clear. */
export const BUDGET_STATUSES = ['None', 'OnTrack', 'Approaching', 'ForecastOver', 'Over'] as const
export type BudgetStatus = typeof BUDGET_STATUSES[number]

/** The words the screens print for each status. */
export const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  None: 'No budget',
  OnTrack: 'On track',
  Approaching: 'Approaching',
  ForecastOver: 'Forecast over',
  Over: 'Over',
}

export const LEDGER_ROW_KINDS = ['ClaimLine', 'CompletedShift', 'PastShift', 'FutureShift', 'TripBooking'] as const
/** A claim line; a completed shift nobody has claimed; a shift whose day passed without it being completed or cancelled; a rostered shift from today; a confirmed trip booking. */
export type LedgerRowKind = typeof LEDGER_ROW_KINDS[number]

/** Where a row counts: the three groups of the ledger. */
export const LEDGER_GROUPS = ['Claimed', 'Pending', 'BookedAhead'] as const
export type LedgerGroup = typeof LEDGER_GROUPS[number]

/** The figures of one pool in one period, or over a whole plan. `remaining` and `forecastRemaining` are the two subtractions a sentence needs: negative means over. */
export interface LedgerFigures {
  limit: number
  /** What earlier periods of the plan left unspent, rolled forward. Not confirmed: others may have used it. */
  carried: number
  available: number
  claimed: number
  pending: number
  used: number
  bookedAhead: number
  forecast: number
  /**
   * Booked trip days no catalogue rate covers, so they contribute $0 to `bookedAhead` and `forecast`. A count, never an invented
   * rate: 0 when every day priced. Above 0 the screen says so, so the forecast can never be read as the whole claim.
   */
  unpricedTripDayCount: number
  remaining: number
  forecastRemaining: number
  status: BudgetStatus
}

export interface LedgerRow {
  /** The claim line, shift or booking the row stands for. */
  id: string
  kind: LedgerRowKind
  group: LedgerGroup
  date: string
  description: string
  amount: number
  /** The record's own status as its name: the claim's, the shift's, the booking's. */
  status: string
  /** An in-app path to the claim, shift or trip. */
  link: string
  note?: string
  /** Of this row's trip days, how many no catalogue rate covers (0 for a row that is not a trip booking). */
  unpricedTripDayCount: number
}

export interface LedgerPeriod extends LedgerFigures {
  id: string
  position: number
  periodStart: string
  periodEnd: string
  /** The period holding the provider's today. */
  isCurrent: boolean
  /** Shifts in the period never completed or cancelled although their day has passed (counted as pending). */
  pastUnresolvedCount: number
  /** How many rows the period has in all; `rows` holds the first page. */
  rowCount: number
  rows: LedgerRow[]
}

export interface LedgerPool {
  id: string
  name: string
  kind: FundingPoolKind
  /** 0 for Core (flexible). */
  paceCategory: number
  managementType: PlanType
  /** The pool's limits are set-asides, not plan amounts. */
  hasSetAside: boolean
  periods: LedgerPeriod[]
  /** The same sums over the whole plan, against the sum of the limits. */
  planTotal: LedgerFigures
  pastUnresolvedCount: number
}

/** Rows that are in no pool, or outside the plan: shown, never dropped. */
export interface LedgerBucket {
  count: number
  amount: number
  rows: LedgerRow[]
}

export interface ParticipantLedgerDto {
  /** Absent when no plan has started: there is no figure, and the screen says nothing about spending. */
  planId?: string
  planStart?: string
  planEnd?: string
  /** The plan runs today (false for a plan that has ended with no successor recorded). */
  planIsCurrent: boolean
  /** The provider's today. */
  asOf: string
  /** The time zone that day was worked out in (IANA id). */
  timeBasis: string
  approachingPercent: number
  pools: LedgerPool[]
  notInARecordedPool: LedgerBucket
  outsideThePlanDates: LedgerBucket
}

/** One more page of one period's rows ("show more"). */
export interface LedgerRowsPage {
  total: number
  skip: number
  rows: LedgerRow[]
}
