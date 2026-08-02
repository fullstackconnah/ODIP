import type { TripClaimStatus, ClaimLineItemStatus, ClaimDayType, ClaimType, GSTCode, PlanType } from './enums'

export interface TripClaimListDto {
  id: string
  tripInstanceId: string
  tripName: string
  status: TripClaimStatus
  claimReference: string
  totalAmount: number
  createdAt: string
  submittedDate: string | null
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
  participantBookingId: string
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
