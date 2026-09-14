import type { TripClaimStatus, ClaimLineItemStatus, ClaimDayType, ClaimType, GSTCode, PlanType, ClaimKind } from './enums'

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
}
