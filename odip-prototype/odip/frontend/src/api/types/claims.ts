import type { TripClaimStatus, ClaimLineItemStatus, ClaimDayType, ClaimType, GSTCode, PlanType, ClaimKind } from './enums'
import type { BudgetStatus } from './funding'

// Shift-completion design spec §1/§2, PR 3 — TripClaim gained a Kind discriminator. Trip-kind
// claims keep tripInstanceId set and participantId/periodFrom/periodTo unset; Shift-kind claims
// are the reverse. The backend omits null fields from the JSON envelope rather than sending
// them as null (Program.cs's JsonIgnoreCondition.WhenWritingNull), so every field that's null
// for one Kind is typed optional here, not `T | null`.
export interface TripClaimListDto {
  id: string
  kind: ClaimKind
  /** Set for Kind === 'Trip'; absent for Kind === 'Shift'. */
  tripInstanceId?: string
  tripName: string
  /** Set for Kind === 'Shift'; absent for Kind === 'Trip'. */
  participantId?: string
  periodFrom?: string
  periodTo?: string
  status: TripClaimStatus
  claimReference: string
  totalAmount: number
  createdAt: string
  submittedDate?: string
}

export interface TripClaimDetailDto extends TripClaimListDto {
  totalApprovedAmount: number
  authorisedByStaffId: string | null
  authorisedByStaffName: string | null
  paidDate: string | null
  notes: string | null
  lineItems: ClaimLineItemDto[]
  /** What this claim does to the participants' budgets, as of now (budget phase 2a). Absent when none of them has a plan that has started. A warning, never a block. */
  budget?: ClaimBudgetDto
}

export interface ClaimLineItemDto {
  id: string
  tripClaimId: string
  /** Set for Kind === 'Trip' line items; absent for Kind === 'Shift'. */
  participantBookingId?: string
  /** Set for Kind === 'Shift' line items; absent for Kind === 'Trip'. */
  shiftId?: string
  participantId: string | null
  participantName: string
  ndisNumber: string
  planType: PlanType
  supportItemCode: string
  dayType: ClaimDayType
  supportsDeliveredFrom: string
  supportsDeliveredTo: string
  hours: number
  unitPrice: number
  totalAmount: number
  gstCode: GSTCode
  claimType: ClaimType
  cancellationReason: string | null
  participantApproved: boolean
  status: ClaimLineItemStatus
  rejectionReason: string | null
  paidAmount: number | null
}

export interface UpdateClaimDto {
  authorisedByStaffId?: string
  notes?: string
  status?: TripClaimStatus
}

export interface UpdateClaimLineItemDto {
  hours?: number
  unitPrice?: number
  supportItemCode?: string
  claimType?: ClaimType
  cancellationReason?: string
  participantApproved?: boolean
  status?: ClaimLineItemStatus
  rejectionReason?: string
  paidAmount?: number
}

export interface ClaimPreviewRequestDto {
  departureTime?: string
  returnTime?: string
  activeHoursPerDay?: number
}

export interface GenerateClaimRequestDto {
  departureTime?: string
  returnTime?: string
  activeHoursPerDay?: number
}

export interface ClaimPreviewResponseDto {
  departureTime: string
  returnTime: string
  activeHoursPerDay: number
  staffCount: number
  state: string
  confirmedParticipantCount: number
  lineItems: ClaimPreviewLineItemDto[]
  totalAmount: number
  /** What generating this claim would do to each participant's budget (budget phase 2a). Absent when none has a plan that has started. A warning, never a block. */
  budget?: ClaimBudgetDto
}

export interface ClaimPreviewLineItemDto {
  participantName: string
  ndisNumber: string
  supportItemCode: string
  dayTypeLabel: string
  dayType: ClaimDayType
  supportsDeliveredFrom: string
  supportsDeliveredTo: string
  hours: number
  unitPrice: number
  totalAmount: number
}

// ── Claim-from-shifts (shift-completion design spec §2/§3, PR 3) ──────────────

export interface GenerateShiftClaimRequestDto {
  from: string
  to: string
}

export interface ShiftClaimPreviewLineItemDto {
  shiftId: string
  serviceDate: string
  dayTypeLabel: string
  dayType: ClaimDayType
  supportItemCode: string
  hours: number
  unitPrice: number
  totalAmount: number
  /** Something worth saying about a line that is priced but not worked out fully (an overnight shift: evening and night rates are not applied yet). Absent when there is nothing to say. */
  note?: string
}

/** A completed, unclaimed shift a shift claim leaves out, and why. It stays completed and unclaimed. */
export interface ShiftClaimLeftOutDto {
  shiftId: string
  serviceDate: string
  /** The shift as the ledger describes it ("Shift 22:00–06:00 · 8 h"). */
  description: string
  /** A sentence ("It is a sleepover, which shift claims do not price yet."). */
  reason: string
}

/**
 * A shift that is in the claim but was priced with a caveat (an overnight shift: evening and night rates are not applied yet). The preview says it on the line; a claim line has no column to
 * keep it in, so the generate response echoes it for the screen that generated the claim.
 */
export interface ShiftClaimFlaggedDto {
  shiftId: string
  serviceDate: string
  /** The shift as the ledger describes it ("Shift 22:00–06:00 · 8 h"). */
  description: string
  /** What is not worked out ("Evening and night rates are not applied yet."). */
  caveat: string
}

/** The claim made from shifts, the shifts in the range it left out, and the shifts in it that carry a pricing caveat. */
export interface ShiftClaimGeneratedDto extends TripClaimListDto {
  /** The server always sends it (empty when nothing was left out). */
  leftOut?: ShiftClaimLeftOutDto[]
  /** The server always sends it (empty when no shift carries a caveat). */
  flagged?: ShiftClaimFlaggedDto[]
}

export interface ShiftClaimPreviewResponseDto {
  totalAmount: number
  lineItems: ShiftClaimPreviewLineItemDto[]
  /** The shifts this claim leaves out and why: never dropped silently. The server always sends it (empty when nothing is left out). */
  leftOut?: ShiftClaimLeftOutDto[]
  /** What generating this claim would do to the participant's budget (budget phase 2a). Absent when they have no plan that has started. A warning, never a block. */
  budget?: ClaimBudgetDto
}

// ── What a claim does to a budget (phase 2a) ──────────────────────────────────

/** Where the part of a claim in a budget row landed: in a recorded pool, in none (it uses no pool's money), or outside the plan's dates. */
export type ClaimBudgetPlacement = 'Pool' | 'NotInAPool' | 'OutsideThePlan'

/** One affected pool and period of a claim. For a row in no pool or outside the plan only `thisClaim` is there. A negative `leftAfter` means the claim leaves the period over. */
export interface ClaimBudgetRowDto {
  placement: ClaimBudgetPlacement
  poolName: string
  periodStart?: string
  periodEnd?: string
  available?: number
  usedBefore?: number
  thisClaim: number
  usedAfter?: number
  leftAfter?: number
  statusAfter?: BudgetStatus
}

export interface ClaimBudgetParticipantDto {
  participantId: string
  participantName: string
  rows: ClaimBudgetRowDto[]
}

/** The budget effect of a claim for each participant it covers (a trip claim covers several): one row for each affected pool and period. */
export interface ClaimBudgetDto {
  participants: ClaimBudgetParticipantDto[]
}
