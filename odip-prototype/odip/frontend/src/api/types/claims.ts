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
  /** When the claim was marked Rejected (a UTC instant). Absent while it is not rejected, and for a claim rejected before this was recorded. */
  rejectedDate?: string
  /** The NDIA's code for the rejection, when one was recorded: V17, V18, V27 and V28 say the funds ran out; anything else is as it was typed. Absent otherwise. */
  rejectionCode?: string
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
  /**
   * The NDIA's code for rejecting the claim (budget phase 2b), sent with `status: 'Rejected'` (or later, on a claim that is already rejected). At most 10 characters; V17, V18, V27 and V28
   * (any case) say the funds ran out. Left out, the code is unchanged; blank clears it. The server refuses it on a claim that is not rejected.
   */
  rejectionCode?: string
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
}

export interface ShiftClaimPreviewResponseDto {
  totalAmount: number
  lineItems: ShiftClaimPreviewLineItemDto[]
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
