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
