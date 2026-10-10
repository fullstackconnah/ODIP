import type { PlanBlock } from './plan-pricing'
import type { PlanType } from './enums'

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
  /** Confirmed trip bookings in the period whose trip has started and has no claim yet (counted as pending: the trip claim waits for the trip to be completed). */
  startedUnclaimedTripCount: number
  /**
   * Shifts in the period the shift claim cannot price yet (a sleepover, a passive night, a group or shared shift, or one no catalogue rate covers). They are $0 in every figure, so the figures leave
   * them out: this says how many and `unpricedShiftReasons` why. A count of shifts, apart from `unpricedTripDayCount`, which counts trip days.
   */
  unpricedShiftCount: number
  /** The distinct reasons behind `unpricedShiftCount`, each in a few words ("a sleepover", "a 1:3 group shift"); empty when nothing is unpriced. */
  unpricedShiftReasons: string[]
  /** How many rows the period has in all; `rows` holds the first page. */
  rowCount: number
  rows: LedgerRow[]
}

/**
 * A claim the NDIA refused for want of funds (V17, V18, V27 or V28), as the Funding tab says it on the pool the claim's lines belong to: "NDIA rejected a claim on {date}: not enough funds
 * in the funding period ({code})" (the plan, for V17 and V18). It carries no money, and it is there while the funding period the claim's lines fall in is the one running (a later period, or a new plan, ends it).
 */
export interface NdiaRejection {
  /** The provider's calendar day the claim was marked Rejected. */
  date: string
  code: string
  claimId: string
  claimReference: string
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
  startedUnclaimedTripCount: number
  /** The periods' unpriced shifts over the whole plan. */
  unpricedShiftCount: number
  /** The NDIA's "the funds ran out" word on this pool, while it is active (budget phase 2b). Absent when there is none. */
  ndiaRejection?: NdiaRejection
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

// ── The Budgets list (phase 2b) ─────────────────────────────────────────────
// GET api/v1/funding/budgets: every active participant's pools for the funding period running now, from the ledger's own figures, sorted by risk (Over, Forecast over, Approaching, On track).
// SuperAdmin, Admin and Coordinator only (money). No screen adds anything up.

/** One pool of one participant's current plan, for the funding period running now. */
export interface BudgetListRow {
  participantId: string
  participantName: string
  poolId: string
  /** The pool as a sentence names it: "Core", the stated support's name, or "Core (plan managed)" when the plan holds two Core pools. */
  poolName: string
  kind: FundingPoolKind
  managementType: PlanType
  periodStart: string
  periodEnd: string
  /** The period's limit plus what earlier periods left unspent. */
  available: number
  /** How much of `available` is rolled over from earlier periods of the plan (0 when none): not confirmed, because somebody else may have used it. */
  carried: number
  /** Claimed plus pending. */
  used: number
  /** Available minus used: what is left, or, below zero, how far over the period already is. The server works it out, so no screen subtracts. */
  remaining: number
  bookedAhead: number
  /** Used plus booked ahead. */
  forecast: number
  status: BudgetStatus
  /** How many shifts of this period the shift claim cannot price yet (a sleepover, a passive night, a group shift): each is $0 in every figure above, so they leave those shifts out. 0 when every shift priced. */
  unpricedShiftCount: number
  /** The NDIA's own word that this pool's funds ran out (a claim of the pool refused for want of funds, while its funding period is the one running); left out when it has none. ODIP's figures can say On track beside it. */
  ndiaRejection?: NdiaRejection
}

/**
 * Why an NDIS-funded participant has no row: no plan is recorded, the plan they have has ended, or a plan is recorded for later (and `planStart` is its first day: the soonest one, which outranks a
 * plan that ended, because the next plan is already there).
 */
export const BUDGET_LIST_NO_BUDGET_REASONS = ['NotRecorded', 'PlanEnded', 'NotStarted'] as const
export type BudgetListNoBudgetReason = typeof BUDGET_LIST_NO_BUDGET_REASONS[number]

/** An NDIS-funded participant with no budget in force: no figure, and nothing ever warns about them. */
export interface BudgetListNoBudget {
  participantId: string
  participantName: string
  reason: BudgetListNoBudgetReason
  /** The last day of the plan that ended; absent when none was recorded. */
  planEnd?: string
  /** The first day of the soonest plan recorded for later, for `NotStarted`; absent otherwise. */
  planStart?: string
}

export interface BudgetListDto {
  /** The provider's today, which every "current period" was decided against. */
  asOf: string
  approachingPercent: number
  /** Sorted by risk, then by name. */
  rows: BudgetListRow[]
  /** NDIS-funded participants with no budget in force, by name. */
  noBudget: BudgetListNoBudget[]
}

// ── The agreement check (phase 2b) ──────────────────────────────────────────
// POST api/v1/participants/{id}/funding/agreement-check: what an agreement would cost against what the participant's real pools have left, for each pool and funding period it touches. The
// agreement is priced in process by the plan pricing engine and placed with the ledger's own rule. A warning and nothing more: it never blocks a save or an approval.

/** Say what to price in ONE of two ways: the draft's blocks with the agreement's dates, or the id of a saved draft. */
export interface AgreementCheckRequest {
  draftId?: string
  blocks?: PlanBlock[]
  periodFrom?: string
  periodTo?: string
}

export interface AgreementCheckPeriod {
  periodId: string
  periodStart: string
  periodEnd: string
  isCurrent: boolean
  /** What the agreement costs in this period. */
  agreementCost: number
  /** The period's limit plus what earlier periods would leave unspent once this agreement had spent its share of them (the ledger's figure when no earlier period has an agreement cost). */
  available: number
  /** Claimed plus pending (the ledger's figure). */
  used: number
  /** Available minus used. May be below zero when the period is already over before the agreement. */
  remaining: number
  /** How far the agreement passes what is left; 0 when it fits. */
  overBy: number
}

export interface AgreementCheckPool {
  poolId: string
  poolName: string
  kind: FundingPoolKind
  managementType: PlanType
  /** What the agreement costs in this pool over all the periods it touches. */
  agreementCost: number
  /** Some period would be over. */
  over: boolean
  /** How far the agreement passes what the pool has across the periods it touches: the sum of the periods' own over-bys (each overspend leaves nothing to carry), 0 when every period fits. */
  overBy: number
  /**
   * The part of `overBy` that the pool was already over before the agreement: the sum, over the periods the agreement touches, of what is used past what they have (a period's negative remaining).
   * A period's over-by is the agreement's cost PLUS that, so `overBy` can pass the agreement's cost; `overBy` less this is the agreement's own overshoot. 0 when no period was over before.
   */
  alreadyOverBy: number
  /** The periods the agreement touches, in date order. */
  periods: AgreementCheckPeriod[]
}

export interface AgreementCheck {
  /** The participant has a plan that is running now to check against. False is "No budget recorded": the answer then has no pools and no figures. */
  hasBudget: boolean
  /** Why there is nothing to compare with, when `hasBudget` is false, in the Budgets list's own two words: no plan that has started is recorded, or the plan ended (and `planEnd` is its last day). */
  noBudgetReason?: BudgetListNoBudgetReason
  planId?: string
  planStart?: string
  planEnd?: string
  /** The provider's today. */
  asOf: string
  periodFrom: string
  periodTo: string
  /** Everything the engine could price in the agreement, in the pools or not. */
  agreementCost: number
  /** Only the pools and periods the agreement touches, in the plan's order of pools. */
  pools: AgreementCheckPool[]
  /** The part of the agreement whose category no recorded pool of the plan covers: shown, never dropped. */
  notInARecordedPool: number
  /** The part of the agreement delivered outside the plan's dates: shown, never dropped. */
  outsideThePlan: number
}
