import type { PlanType, SupportRatio, OvernightSupportType, ServiceStream, Gender, FundingSource, LivingArrangement } from './enums'
import { SERVICE_STREAMS } from './enums'

export const GENDER_LABELS: Record<Gender, string> = {
  Male: 'Male',
  Female: 'Female',
  NonBinary: 'Non-binary',
  PreferNotToSay: 'Prefer not to say',
  Other: 'Other',
}

/** FUND-02. */
export const FUNDING_SOURCE_LABELS: Record<FundingSource, string> = {
  Ndis: 'NDIS',
  Other: 'Other',
}

/** LIVING-01. */
export const LIVING_ARRANGEMENT_LABELS: Record<LivingArrangement, string> = {
  Family: 'Family',
  Independent: 'Independent',
  SupportedAccommodation: 'Supported Accommodation',
}

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

export const SERVICE_STREAM_LABELS: Record<ServiceStream, string> = {
  STA: 'STA',
  BSP: 'BSP',
  InHomeSupport: 'In-Home Support',
  Trip: 'Trip',
  HIDPA: 'HIDPA',
  CommunityAccessDailyLiving: 'Community Access / Daily Living',
  CommunityNursing: 'Community Nursing',
}

/** Full expansions for the abbreviated stream labels — surfaced as a title tooltip on badges. */
export const SERVICE_STREAM_TITLES: Record<ServiceStream, string> = {
  STA: 'Short Term Accommodation',
  BSP: 'Behaviour Support Plan',
  InHomeSupport: 'In-Home Support',
  Trip: 'Trip',
  HIDPA: 'High Intensity Daily Personal Activities',
  CommunityAccessDailyLiving: 'Community Access / Daily Living',
  CommunityNursing: 'Community Nursing',
}

/**
 * The backend exposes ServiceStreams as a plain [Flags] enum column. Program.cs registers a
 * global JsonStringEnumConverter, which natively serialises a combined flags value as a
 * comma-separated list of member names (e.g. "STA, Trip", or "None" when untagged) and parses
 * that same format back on input (via Enum.Parse's built-in flags support) — so the wire value
 * is just a string. These helpers translate that string to/from the string[] shape components
 * actually want to work with (checkboxes, badges), matching how MobilitySupportOptions is
 * already handled as a plain string array elsewhere in this file.
 */
export function parseServiceStreams(value: string | null | undefined): ServiceStream[] {
  if (!value || value === 'None') return []
  const known: readonly string[] = SERVICE_STREAMS
  return value.split(',').map((s) => s.trim()).filter((s): s is ServiceStream => known.includes(s))
}

export function formatServiceStreams(streams: ServiceStream[] | undefined): string {
  return streams && streams.length ? streams.join(', ') : 'None'
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
  /** Wire format: comma-separated ServiceStreams flag names, or "None" — see parseServiceStreams. */
  serviceStreams: string
  hasActiveMedications: boolean
}

export interface ParticipantDetailDto extends ParticipantListDto {
  dateOfBirth: string | null
  gender: Gender | null
  genderSelfDescription: string | null
  ndisNumber: string | null
  planStartDate: string | null
  planEndDate: string | null
  /** FUND-02. */
  fundingSource: FundingSource
  fundingOrganisation: string | null
  /** LIVING-01. */
  livingArrangement: LivingArrangement | null
  mainSupportPersonName: string | null
  mainSupportPersonRelationship: string | null
  othersLivingInAccommodation: string | null
  residentialInfo: string | null
  livesWithOthers: boolean | null
  whoLivesWith: string | null
  silProviderName: string | null
  silProviderContactPhone: string | null
  accommodationType: string | null
  onSiteSupportHours: string | null
  livingArrangementNotes: string | null
  /** INTAKE-06. */
  addressStreet: string | null
  addressSuburb: string | null
  addressState: string | null
  addressPostcode: string | null
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
  gender?: Gender | null
  /** Only meaningful (and validated server-side) when gender is "Other". */
  genderSelfDescription?: string
  ndisNumber?: string
  planStartDate?: string
  planEndDate?: string
  planType: PlanType
  region?: string
  /** FUND-02. Defaults server-side to Ndis when omitted. */
  fundingSource?: FundingSource
  /** Reused "Other — specify" field: required iff fundingSource is Other; ignored when Ndis. */
  fundingOrganisation?: string
  /** LIVING-01. Nullable — unset until intake captures it. */
  livingArrangement?: LivingArrangement | null
  /** LIVING-02 (Family). Required iff livingArrangement is Family. */
  mainSupportPersonName?: string
  mainSupportPersonRelationship?: string
  othersLivingInAccommodation?: string
  residentialInfo?: string
  /** LIVING-03 (Independent). */
  livesWithOthers?: boolean
  /** Required iff livingArrangement is Independent and livesWithOthers is true. */
  whoLivesWith?: string
  /** LIVING-04 (Supported Accommodation). Required iff livingArrangement is SupportedAccommodation. */
  silProviderName?: string
  silProviderContactPhone?: string
  accommodationType?: string
  onSiteSupportHours?: string
  /** Shared across all three arrangement types — see participants.ts's LIVING_ARRANGEMENT_LABELS doc. */
  livingArrangementNotes?: string
  /** INTAKE-06 — structured address. */
  addressStreet?: string
  addressSuburb?: string
  addressState?: string
  /** 4-digit AU postcode. */
  addressPostcode?: string
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
  /** Wire format: comma-separated ServiceStreams flag names, or "None" — see formatServiceStreams. */
  serviceStreams: string
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
