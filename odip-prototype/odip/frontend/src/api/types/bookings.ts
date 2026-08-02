import type { BookingStatus, SupportRatio, InsuranceStatus, PaymentStatus, PlanType } from './enums'

export interface BookingListDto {
  id: string
  tripInstanceId: string
  tripName: string | null
  participantId: string
  participantName: string | null
  bookingStatus: BookingStatus
  bookingDate: string
  wheelchairRequired: boolean
  highSupportRequired: boolean
  nightSupportRequired: boolean
  hasRestrictivePracticeFlag: boolean
  supportRatioOverride: SupportRatio | null
  actionRequired: boolean
  insuranceStatus: InsuranceStatus
  paymentStatus: PaymentStatus
}

export interface BookingDetailDto extends BookingListDto {
  planTypeOverride: PlanType | null
  fundingNotes: string | null
  roomPreference: string | null
  transportNotes: string | null
  equipmentNotes: string | null
  riskSupportNotes: string | null
  bookingNotes: string | null
  cancellationReason: string | null
  createdAt: string
  updatedAt: string
  insuranceProvider: string | null
  insurancePolicyNumber: string | null
  insuranceCoverageStart: string | null
  insuranceCoverageEnd: string | null
  isInsuranceValid: boolean
}

export interface CreateBookingDto {
  tripInstanceId: string
  participantId: string
  bookingStatus?: BookingStatus
  bookingDate?: string
  supportRatioOverride?: SupportRatio
  nightSupportRequired: boolean
  wheelchairRequired: boolean
  highSupportRequired: boolean
  hasRestrictivePracticeFlag: boolean
  planTypeOverride?: PlanType
  fundingNotes?: string
  roomPreference?: string
  transportNotes?: string
  equipmentNotes?: string
  riskSupportNotes?: string
  bookingNotes?: string
  insuranceProvider?: string
  insurancePolicyNumber?: string
  insuranceCoverageStart?: string
  insuranceCoverageEnd?: string
  insuranceStatus?: InsuranceStatus
}

export interface UpdateBookingDto extends CreateBookingDto {
  paymentStatus: PaymentStatus
  actionRequired: boolean
  cancellationReason?: string
}

export interface PatchBookingDto {
  bookingStatus?: BookingStatus
  insuranceStatus?: InsuranceStatus
  paymentStatus?: PaymentStatus
}
