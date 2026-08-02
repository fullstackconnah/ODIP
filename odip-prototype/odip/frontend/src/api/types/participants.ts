import type { PlanType, SupportRatio } from './enums'

export interface ParticipantListDto {
  id: string
  firstName: string
  lastName: string
  preferredName: string | null
  fullName: string
  maskedNdisNumber: string | null
  planType: PlanType
  region: string | null
  isRepeatClient: boolean
  isActive: boolean
  wheelchairRequired: boolean
  isHighSupport: boolean
  isIntensiveSupport: boolean
  requiresOvernightSupport?: boolean
  hasRestrictivePracticeFlag?: boolean
  supportRatio: SupportRatio
}

export interface ParticipantDetailDto extends ParticipantListDto {
  dateOfBirth: string | null
  ndisNumber: string | null
  fundingOrganisation: string | null
  requiresOvernightSupport: boolean
  hasRestrictivePracticeFlag: boolean
  mobilityNotes: string | null
  equipmentRequirements: string | null
  transportRequirements: string | null
  medicalSummary: string | null
  behaviourRiskSummary: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  preferredStaffId: string | null
  preferredStaffName: string | null
}

export interface CreateParticipantDto {
  firstName: string
  lastName: string
  preferredName?: string
  dateOfBirth?: string
  ndisNumber?: string
  planType: PlanType
  region?: string
  fundingOrganisation?: string
  isRepeatClient: boolean
  wheelchairRequired: boolean
  isHighSupport: boolean
  isIntensiveSupport: boolean
  requiresOvernightSupport: boolean
  hasRestrictivePracticeFlag: boolean
  supportRatio: SupportRatio
  mobilityNotes?: string
  equipmentRequirements?: string
  transportRequirements?: string
  medicalSummary?: string
  behaviourRiskSummary?: string
  notes?: string
  preferredStaffId?: string | null
}

export interface UpdateParticipantDto extends CreateParticipantDto {
  isActive: boolean
}

export interface SupportProfileDto {
  id: string
  participantId: string
  communicationNotes: string | null
  behaviourSupportNotes: string | null
  restrictivePracticeDetails: string | null
  manualHandlingNotes: string | null
  medicationHealthSummary: string | null
  emergencyConsiderations: string | null
  travelSpecificNotes: string | null
  reviewDate: string | null
}

export interface UpdateSupportProfileDto {
  communicationNotes?: string
  behaviourSupportNotes?: string
  restrictivePracticeDetails?: string
  manualHandlingNotes?: string
  medicationHealthSummary?: string
  emergencyConsiderations?: string
  travelSpecificNotes?: string
  reviewDate?: string
}
