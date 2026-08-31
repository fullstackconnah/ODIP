import type { PlanType, SupportRatio, OvernightSupportType, ServiceStream, Gender, FundingSource, LivingArrangement, HidpaSupportCategory } from './enums'
import { SERVICE_STREAMS, HIDPA_SUPPORT_CATEGORIES } from './enums'
import type { CreateParticipantRiskEntryDto } from './risk-entries'
import type { ParticipantConsentDto, CreateParticipantConsentDto } from './consents'

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

/**
 * DIAG-01: curated diagnoses picklist, mirroring the backend's Odip.Domain.Enums.Diagnoses.All
 * (SeedData/DataDictionarySeed.json, fieldId MED-016) — the spreadsheet is the source of truth.
 * Unlike MOBILITY_SUPPORT_OPTIONS (a closed picklist), diagnoses fields are open text — this list
 * drives the curated dropdown/checkbox UI only; DIAGNOSIS_OTHER_SENTINEL is the "Other — specify"
 * escape hatch offered alongside it (never itself a stored value — see the primary-diagnosis
 * select handling in ParticipantCreatePage.tsx).
 */
export const DIAGNOSIS_OPTIONS = [
  'Intellectual Disability',
  'Autism Spectrum Disorder',
  'Cerebral Palsy',
  'Down Syndrome',
  'Epilepsy',
  'Acquired Brain Injury',
  'Psychosocial Disability',
  'Vision Impairment',
  'Hearing Impairment',
  'Multiple Sclerosis',
  'Muscular Dystrophy',
  'Spina Bifida',
  'Stroke',
  'Dementia',
] as const
export type DiagnosisOption = typeof DIAGNOSIS_OPTIONS[number]
export const DIAGNOSIS_OTHER_SENTINEL = 'Other — specify'

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
 * DIAG-02. Short labels for the HIDPA multi-select checkboxes.
 *
 * CAVEAT: sourced from 3 corroborating secondary sources (NDS, Team DSC, CentroQMS), not the
 * primary NDIS Quality & Safeguards Commission PDF (fetch failed repeatedly during research —
 * see Odip.Domain.Enums.HidpaSupportCategory's backend doc comment for the link). Treat category
 * names as reliable; verify exact wording before it ships as end-user-facing copy elsewhere.
 */
export const HIDPA_CATEGORY_LABELS: Record<HidpaSupportCategory, string> = {
  ComplexBowelCare: 'Complex Bowel Care',
  EnteralFeeding: 'Enteral Feeding Support',
  DysphagiaManagement: 'Dysphagia Support',
  TracheostomyCare: 'Tracheostomy Support',
  VentilatorSupport: 'Ventilator Support',
  UrinaryCatheterManagement: 'Urinary Catheter Support',
  SubcutaneousInjections: 'Subcutaneous Injections',
  ComplexWoundCare: 'Complex Wound Care',
  EpilepsyManagement: 'Epilepsy and Seizure Management',
}

/** Full descriptor-style titles — surfaced as a title tooltip on the HIDPA checkboxes, same pattern as SERVICE_STREAM_TITLES. */
export const HIDPA_CATEGORY_TITLES: Record<HidpaSupportCategory, string> = {
  ComplexBowelCare: 'Manual/assisted bowel management, incl. enemas, suppositories, and ostomy/stoma bowel care.',
  EnteralFeeding: 'Delivering nutrition/fluids/medication via feeding tube (PEG, NG, jejunostomy), incl. site and equipment care.',
  DysphagiaManagement: 'Safe mealtime assistance and swallowing-risk management for a diagnosed severe swallowing disorder.',
  TracheostomyCare: 'Care of a surgical airway (tube, stoma site, suctioning) for participants who breathe via tracheostomy.',
  VentilatorSupport: 'Operating/monitoring mechanical ventilation equipment and responding to alarms/emergencies.',
  UrinaryCatheterManagement: 'Managing indwelling/suprapubic catheters — bag changes, hygiene, blockage/infection risk monitoring.',
  SubcutaneousInjections: 'Administering prescribed subcutaneous injections (incl. insulin).',
  ComplexWoundCare: 'Managing wounds requiring specialised dressing/monitoring beyond basic first aid.',
  EpilepsyManagement: "Recognising and responding to seizures per the participant's seizure-management plan.",
}

/**
 * Same comma-separated-flags-names wire format as ServiceStreams (see parseServiceStreams'
 * doc above) — HidpaSupportCategories is a [Flags] enum column with the same global
 * JsonStringEnumConverter behaviour.
 */
export function parseHidpaCategories(value: string | null | undefined): HidpaSupportCategory[] {
  if (!value || value === 'None') return []
  const known: readonly string[] = HIDPA_SUPPORT_CATEGORIES
  return value.split(',').map((s) => s.trim()).filter((s): s is HidpaSupportCategory => known.includes(s))
}

export function formatHidpaCategories(categories: HidpaSupportCategory[] | undefined): string {
  return categories && categories.length ? categories.join(', ') : 'None'
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
  /** INTAKE-08. See CreateParticipantDto.isDraft's doc. */
  isDraft: boolean
}

export interface ParticipantDetailDto extends ParticipantListDto {
  /** INTAKE sub-wave A, Master Data Dictionary PID-004. */
  middleName: string | null
  dateOfBirth: string | null
  gender: Gender | null
  genderSelfDescription: string | null
  /** INTAKE sub-wave A, PID-010. */
  placeOfBirth: string | null
  /** INTAKE sub-wave A, CON-006. */
  country: string | null
  /** INTAKE sub-wave A, CON-007 — the participant's OWN phone (not a Contact's). */
  phone: string | null
  /** INTAKE sub-wave A, CON-008 — the participant's OWN email (not a Contact's). */
  email: string | null
  ndisNumber: string | null
  planStartDate: string | null
  planEndDate: string | null
  /** INTAKE sub-wave A, NDIS-006 — Disability Support for Older Australians. */
  isDsoa: boolean
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
  /** DIAG-01. */
  primaryDiagnosis: string | null
  otherDiagnoses: string[]
  /** DIAG-02. Wire format: comma-separated HidpaSupportCategory flag names, or "None" — see parseHidpaCategories. */
  hidpaSupportCategories: string
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
  // INTAKE sub-wave A — Key Identifiers step (Master Data Dictionary CARD-*/PHY-*). All optional.
  pensionCardNumber: string | null
  pensionCardExpiry: string | null
  medicareNumber: string | null
  medicareExpiry: string | null
  companionCardNumber: string | null
  companionCardExpiry: string | null
  privateHealthFund: string | null
  privateHealthMembershipNumber: string | null
  taxiCardNumber: string | null
  hairColour: string | null
  eyeColour: string | null
  weightKg: number | null
  heightCm: number | null
  // INTAKE sub-wave B — Cultural & Consent step (Master Data Dictionary CUL-*). All optional.
  isCald: boolean | null
  isLgbtqi: boolean | null
  isFamilyCommunity: boolean | null
  isAboriginalOrTorresStraitIslander: boolean | null
  receivedRightsAndResponsibilitiesInfo: boolean | null
  receivedPrivacyAndConfidentialityInfo: boolean | null
  receivedFeedbackInfo: boolean | null
  receivedBeingSafeInfo: boolean | null
  receivedAdvocacyInfo: boolean | null
  personalInterests: string | null
  choiceControlNotes: string | null
  /** Always all seven ConsentType entries — see ParticipantConsentsController.GetForParticipant. */
  consents: ParticipantConsentDto[]
}

export interface CreateParticipantDto {
  firstName: string
  lastName: string
  /**
   * INTAKE-08: true for a "Save as draft" wizard call — the server relaxes required-field
   * checks to "at least one of firstName/lastName" (see ParticipantsController.ValidateNames)
   * while still enforcing every format/consistency check on whatever IS provided. False (the
   * default) is a normal, fully-validated create/update, including a final submission from the
   * wizard's Review step, which clears an existing draft's flag back off.
   */
  isDraft?: boolean
  preferredName?: string
  /** INTAKE sub-wave A, PID-004. */
  middleName?: string
  dateOfBirth?: string
  gender?: Gender | null
  /** Only meaningful (and validated server-side) when gender is "Other". */
  genderSelfDescription?: string
  /** INTAKE sub-wave A, PID-010. */
  placeOfBirth?: string
  /** INTAKE sub-wave A, CON-006. */
  country?: string
  /** INTAKE sub-wave A, CON-007 — the participant's OWN phone. AU-tolerant format validated
   * server-side whenever provided; absence never blocks a draft. */
  phone?: string
  /** INTAKE sub-wave A, CON-008 — the participant's OWN email. Format validated server-side
   * whenever provided; absence never blocks a draft. */
  email?: string
  ndisNumber?: string
  planStartDate?: string
  planEndDate?: string
  planType: PlanType
  region?: string
  /** INTAKE sub-wave A, NDIS-006 — Disability Support for Older Australians. */
  isDsoa?: boolean
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
  /** DIAG-01. Free text — selected from DIAGNOSIS_OPTIONS or typed via the "Other — specify" escape hatch (collapsed to this one field before submit; see ParticipantCreatePage.tsx). */
  primaryDiagnosis?: string | null
  otherDiagnoses: string[]
  /** DIAG-02. Wire format: comma-separated HidpaSupportCategory flag names, or "None" — see formatHidpaCategories. */
  hidpaSupportCategories: string
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
  /**
   * INTAKE-09. Repeatable risk-entry rows captured at intake, created transactionally with the
   * participant. Edit-mode manages risk entries via the separate nested CRUD
   * (useParticipantRiskEntries/useCreateRiskEntry/etc, surfaced on the participant detail page)
   * instead of this collection — the wizard only renders the add-rows UI in create mode.
   */
  riskEntries: CreateParticipantRiskEntryDto[]
  // INTAKE sub-wave A — Key Identifiers step (Master Data Dictionary CARD-*/PHY-*). All optional.
  pensionCardNumber?: string
  pensionCardExpiry?: string
  medicareNumber?: string
  medicareExpiry?: string
  companionCardNumber?: string
  companionCardExpiry?: string
  privateHealthFund?: string
  privateHealthMembershipNumber?: string
  taxiCardNumber?: string
  hairColour?: string
  eyeColour?: string
  weightKg?: number | null
  heightCm?: number | null
  // INTAKE sub-wave B — Cultural & Consent step. All optional.
  isCald?: boolean | null
  isLgbtqi?: boolean | null
  isFamilyCommunity?: boolean | null
  isAboriginalOrTorresStraitIslander?: boolean | null
  receivedRightsAndResponsibilitiesInfo?: boolean | null
  receivedPrivacyAndConfidentialityInfo?: boolean | null
  receivedFeedbackInfo?: boolean | null
  receivedBeingSafeInfo?: boolean | null
  receivedAdvocacyInfo?: boolean | null
  personalInterests?: string
  choiceControlNotes?: string
  /**
   * Consent rows captured on the wizard's Cultural & Consent step, upserted transactionally with
   * the participant on both create and update — unlike riskEntries (create-mode only), this list
   * is read on every save, since the step stays editable in edit mode too. See
   * CreateParticipantDto's backend doc for the fuller reasoning.
   */
  consents: CreateParticipantConsentDto[]
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
