import type { PlanType, SupportRatio, OvernightSupportType } from './enums'

export const MOBILITY_SUPPORT_OPTIONS = [
  'Wheelchair in vehicle',
  'Full vehicle',
  'Transfers',
  'Ceiling hoist',
  'Manual hoist',
  'Sit-to-stand',
  'Slide board',
  'Walking aid',
  'Swivel board',
  'Standing frame',
] as const
export type MobilitySupportOption = typeof MOBILITY_SUPPORT_OPTIONS[number]

export const OVERNIGHT_SUPPORT_LABELS: Record<OvernightSupportType, string> = {
  None: 'None',
  ActiveNight: 'Active Night',
  PassiveNight: 'Passive Night',
  Sleepover: 'Overnight Sleepover',
  SleepoverSupport: 'Sleepover Support',
}

export const OVERNIGHT_RATIO_LABELS: Record<SupportRatio, string> = {
  OneToOne: '1:1',
  OneToTwo: '1:2',
  TwoToOne: '2:1',
  SharedSupport: 'Shared Support',
  Other: 'Other',
  OneToThree: '1:3',
  OneToFour: '1:4',
  OneToFive: '1:5',
}

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
  mobilityAidWheelchair: boolean
  mobilityAidWalker: boolean
  mobilitySupportOptions: string[]
  isHighSupport: boolean
  isIntensiveSupport: boolean
  overnightSupport: OvernightSupportType
  overnightRatio: SupportRatio
  requiresHiLoBed: boolean
  requiresHoist: boolean
  requiresShowerChair: boolean
  requiresCommode: boolean
  requiresStandingMachine: boolean
  hasRestrictivePracticeFlag?: boolean
  supportRatio: SupportRatio
}

export interface ParticipantDetailDto extends ParticipantListDto {
  dateOfBirth: string | null
  ndisNumber: string | null
  fundingOrganisation: string | null
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
  mobilityAidWheelchair: boolean
  mobilityAidWalker: boolean
  mobilitySupportOptions: string[]
  isHighSupport: boolean
  isIntensiveSupport: boolean
  overnightSupport: OvernightSupportType
  overnightRatio: SupportRatio
  requiresHiLoBed: boolean
  requiresHoist: boolean
  requiresShowerChair: boolean
  requiresCommode: boolean
  requiresStandingMachine: boolean
  // hasRestrictivePracticeFlag is intentionally NOT here — it is derived (true iff the
  // participant has any active RestrictivePractice register row) and can no longer be set
  // independently via create/update. See ParticipantListDto/ParticipantDetailDto for the
  // read-only computed value.
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
  // restrictivePracticeDetails is intentionally NOT here — the restrictive practices register
  // replaces it as the write path. Existing legacy text stays readable via SupportProfileDto.
  manualHandlingNotes?: string
  medicationHealthSummary?: string
  emergencyConsiderations?: string
  travelSpecificNotes?: string
  reviewDate?: string
}
