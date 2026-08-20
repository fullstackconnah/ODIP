import type { ClaimDayType, ClaimType, GSTCode } from './enums'

// ── Funding Route Type ─────────────────────────────────
export const FUNDING_ROUTE_TYPES = ['AgencyManaged', 'PlanManaged', 'SelfManaged', 'Private', 'BusinessToBusiness'] as const
export type FundingRouteType = typeof FUNDING_ROUTE_TYPES[number]

export const FUNDING_ROUTE_TYPE_LABELS: Record<FundingRouteType, string> = {
  AgencyManaged: 'Agency Managed',
  PlanManaged: 'Plan Managed',
  SelfManaged: 'Self Managed',
  Private: 'Private',
  BusinessToBusiness: 'Business to Business',
}

// ── Billable Event Status ──────────────────────────────
export const BILLABLE_EVENT_STATUSES = ['Draft', 'Validated', 'Routed', 'Claimed', 'Invoiced', 'Paid', 'Rejected', 'Cancelled'] as const
export type BillableEventStatus = typeof BILLABLE_EVENT_STATUSES[number]

export const BILLABLE_EVENT_STATUS_LABELS: Record<BillableEventStatus, string> = {
  Draft: 'Draft',
  Validated: 'Validated',
  Routed: 'Routed',
  Claimed: 'Claimed',
  Invoiced: 'Invoiced',
  Paid: 'Paid',
  Rejected: 'Rejected',
  Cancelled: 'Cancelled',
}

// ── Income Stream ───────────────────────────────────────
export const INCOME_STREAMS = ['Holidays', 'CommunityAccess', 'CapacityBuilding', 'Nursing', 'Training', 'PositiveBehaviourSupport', 'ShortTermAccommodation', 'SupportedIndependentLiving', 'WhiteLabel', 'Other'] as const
export type IncomeStream = typeof INCOME_STREAMS[number]

export const INCOME_STREAM_LABELS: Record<IncomeStream, string> = {
  Holidays: 'Holidays',
  CommunityAccess: 'Community Access',
  CapacityBuilding: 'Capacity Building',
  Nursing: 'Nursing',
  Training: 'Training',
  PositiveBehaviourSupport: 'Positive Behaviour Support',
  ShortTermAccommodation: 'Short Term Accommodation',
  SupportedIndependentLiving: 'Supported Independent Living',
  WhiteLabel: 'White Label',
  Other: 'Other',
}

// ── Billing Severity ────────────────────────────────────
export const BILLING_SEVERITIES = ['Error', 'Warning'] as const
export type BillingSeverity = typeof BILLING_SEVERITIES[number]

export const BILLING_SEVERITY_LABELS: Record<BillingSeverity, string> = {
  Error: 'Error',
  Warning: 'Warning',
}

// ── Funding Source ──────────────────────────────────────
export interface FundingSourceDto {
  id: string
  participantId: string
  participantName: string | null
  routeType: FundingRouteType
  budgetCategory: string | null
  ndisPlanNumber: string | null
  planStartDate: string | null
  planEndDate: string | null
  budget: number | null
  payerName: string | null
  payerEmail: string | null
  isActive: boolean
}

export interface CreateFundingSourceDto {
  participantId: string
  routeType: FundingRouteType
  budgetCategory?: string
  ndisPlanNumber?: string
  planStartDate?: string
  planEndDate?: string
  budget?: number
  payerName?: string
  payerEmail?: string
  isActive?: boolean
}

export type UpdateFundingSourceDto = CreateFundingSourceDto

// ── Service Booking ─────────────────────────────────────
export interface ServiceBookingLineDto {
  id: string
  supportItemNumber: string
  allocatedAmount: number
  claimedAmount: number
  remainingAmount: number
}

export interface CreateServiceBookingLineDto {
  supportItemNumber: string
  allocatedAmount: number
}

export interface ServiceBookingListDto {
  id: string
  fundingSourceId: string
  participantId: string | null
  participantName: string | null
  prodaBookingReference: string
  startDate: string
  endDate: string
  claimWindowDays: number
  claimDeadline: string
  totalAllocated: number
  totalClaimed: number
  totalRemaining: number
}

export interface ServiceBookingDetailDto extends ServiceBookingListDto {
  lines: ServiceBookingLineDto[]
}

export interface CreateServiceBookingDto {
  fundingSourceId: string
  prodaBookingReference: string
  startDate: string
  endDate: string
  claimWindowDays?: number
  lines: CreateServiceBookingLineDto[]
}

// ── Billable Event ──────────────────────────────────────
export interface BillableEventDto {
  id: string
  participantId: string
  participantName: string | null
  fundingSourceId: string
  serviceBookingId: string | null
  stream: IncomeStream
  sourceEntityType: string | null
  sourceEntityId: string | null
  supportItemNumber: string
  supportsDeliveredFrom: string
  supportsDeliveredTo: string
  dayType: ClaimDayType
  quantity: number | null
  hours: number | null
  unitPrice: number
  totalAmount: number
  gstCode: GSTCode
  claimType: ClaimType
  cancellationReasonCode: string | null
  participantApproved: boolean
  claimReference: string
  status: BillableEventStatus
  rejectionReason: string | null
  createdAt: string
}

export interface CreateBillableEventDto {
  participantId: string
  fundingSourceId: string
  serviceBookingId?: string
  stream: IncomeStream
  sourceEntityType?: string
  sourceEntityId?: string
  supportItemNumber: string
  supportsDeliveredFrom: string
  supportsDeliveredTo: string
  dayType: ClaimDayType
  quantity?: number
  hours?: number
  unitPrice: number
  totalAmount: number
  gstCode?: GSTCode
  claimType?: ClaimType
  cancellationReasonCode?: string
  participantApproved: boolean
  claimReference: string
}

export type UpdateBillableEventDto = CreateBillableEventDto

// ── Claim Batch ─────────────────────────────────────────
export interface ClaimBatchListDto {
  id: string
  fileName: string
  createdAt: string
  submittedAt: string | null
  eventCount: number
  totalAmount: number
}

export interface ClaimBatchDetailDto extends ClaimBatchListDto {
  events: BillableEventDto[]
}

export interface ValidateBillingDto {
  eventIds: string[]
}

export interface CreateClaimBatchDto {
  eventIds: string[]
}

export interface BillingValidationResultDto {
  eventId: string
  severity: BillingSeverity
  code: string
  message: string
}
