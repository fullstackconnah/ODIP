import type { PlanType, SupportRatio, OvernightSupportType, ServiceStream, Gender, FundingSource, LivingArrangement, HidpaSupportCategory, AmbulantStatus, PersonalCareLevel, RiskRatingLevel, MemoryLevel, ShiftStatus, CompatibilityLevel } from './enums'
import { SERVICE_STREAMS, HIDPA_SUPPORT_CATEGORIES } from './enums'
import type { CreateParticipantRiskEntryDto } from './risk-entries'
import type { ParticipantConsentDto, CreateParticipantConsentDto } from './consents'
import type { ParticipantHealthConditionDto, CreateParticipantHealthConditionDto } from './health-conditions'
import type { ParticipantAdlAssessmentDto, CreateParticipantAdlAssessmentDto } from './adl-assessments'
import type { ParticipantChecklistItemDto, CreateParticipantChecklistItemDto } from './checklist-items'
import type { ParticipantCommunityAccessRiskItemDto, CreateParticipantCommunityAccessRiskItemDto } from './community-access-risk-items'

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
 * (ODIP Master Data Dictionary.xlsx at the repo root, fieldId MED-016) — the spreadsheet is the source of truth.
 * Unlike MOBILITY_SUPPORT_OPTIONS (a closed picklist), diagnoses fields are open text — this list
 * drives the curated dropdown/checkbox UI only; DIAGNOSIS_OTHER_SENTINEL is the "Other — specify"
 * escape hatch offered alongside it (never itself a stored value — see the primary-diagnosis
 * select handling in the retired single-step wizard).
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
  // INTAKE-03 — the 5 genuine-gap categories the Community Access variant's 14-item HIDPA
  // checklist added on top of DIAG-02's original 9 (research spec §3, Section 3 wording).
  StomaColostomyCare: 'Stoma / colostomy',
  DiabetesManagementInsulin: 'Diabetes management (insulin)',
  PressureCare: 'Pressure care',
  HighIntensityBehaviourSupport: 'High intensity behaviour support',
  ComplexMedicationAdministration: 'Medication administration (complex)',
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
  StomaColostomyCare: 'Managing a surgical stoma/colostomy — appliance changes, site care, output monitoring.',
  DiabetesManagementInsulin: 'Administering and managing insulin therapy for diagnosed diabetes.',
  PressureCare: 'Repositioning/skin-integrity care to prevent or manage pressure injuries.',
  HighIntensityBehaviourSupport: 'Support delivered under a formal high-intensity behaviour support plan.',
  ComplexMedicationAdministration: 'Administering medication regimes with complex dosing/timing/route requirements beyond routine oral medication.',
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

/** INTAKE sub-wave C1, Mobility & Functional (MOB-002). */
export const AMBULANT_STATUS_LABELS: Record<AmbulantStatus, string> = {
  NoAssist: 'No Assist',
  Unsteady: 'Unsteady',
  Frame: 'Frame',
  ShortDistance: 'Short Distance',
}

/** INTAKE sub-wave C1, Mobility & Functional (MOB-006). */
export const PERSONAL_CARE_LEVEL_LABELS: Record<PersonalCareLevel, string> = {
  Independent: 'Independent',
  Supervision: 'Supervision',
  OnePerson: 'One-Person Assist',
  TwoPerson: 'Two-Person Assist',
}

/** INTAKE sub-wave C1 — shared by Falls Risk (MOB-003) and Behaviour Risk (COG-011) ratings. */
export const RISK_RATING_LEVEL_LABELS: Record<RiskRatingLevel, string> = {
  Low: 'Low',
  Medium: 'Medium',
  High: 'High',
  Critical: 'Critical',
}

/** INTAKE sub-wave C1, Behaviour & Communication (COG-001). */
export const MEMORY_LEVEL_LABELS: Record<MemoryLevel, string> = {
  Excellent: 'Excellent',
  Fair: 'Fair',
  Poor: 'Poor',
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
  /**
   * Unmasked NDIS number. Some list endpoints return this instead of `maskedNdisNumber`
   * (see ParticipantDetailDto.ndisNumber); the participants table masks whichever it gets.
   * Optional because the common list response only carries the masked form.
   */
  ndisNumber?: string | null
  /** INTAKE-08. See CreateParticipantDto.isDraft's doc. */
  isDraft: boolean
  /**
   * SPEC-05 PF-10.5. Null until the Intake wizard's final step succeeds; set once, never cleared.
   * Optional (rather than required) so the many pre-existing ParticipantListDto/ParticipantDetailDto
   * test fixtures across the participant-detail section tests don't all need updating for a field
   * none of them assert on.
   */
  intakeCompletedAt?: string | null
  /**
   * What is still missing before this participant is fully ready to roster, book or activate (e.g. "Intake not complete",
   * "No signed service agreement"), shown verbatim as a quiet warning. Omitted by the server when nothing is missing.
   * Optional for the same reason as `intakeCompletedAt`: the many existing fixtures do not need to carry it.
   */
  readinessIssues?: string[]
}

export interface ParticipantDetailDto extends ParticipantListDto {
  inquiryId?: string | null
  inquirySource?: string | null
  inquiryProvenance?: string | null
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
  /** DIAG-02/INTAKE-03 reconciliation — free-text HIDPA notes. Ungated, same visibility as hidpaSupportCategories itself. */
  hidpaNotes: string | null
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

  // INTAKE sub-wave C1 — Allergies/Anaphylaxis (Medical step, Master Data Dictionary MED-012).
  allergiesDetail: string | null
  isAnaphylaxisRisk: boolean | null
  allergyManagementNotes: string | null
  /** Always all ten HealthConditionType entries — see ParticipantHealthConditionsController.GetForParticipant. */
  healthConditions: ParticipantHealthConditionDto[]

  // INTAKE sub-wave C1 — Mobility & Functional (Support Needs & Mobility step).
  ambulantStatus: AmbulantStatus | null
  fallsRiskRating: RiskRatingLevel | null
  unevenGroundFlag: boolean | null
  levelOfPersonalCare: PersonalCareLevel | null
  orthotics: string | null
  continenceSupportDetail: string | null
  bowelCareDetail: string | null
  menstruationSupport: string | null
  skinIntegrity: string | null

  // INTAKE sub-wave C1 — Behaviour & Communication step.
  memory: MemoryLevel | null
  memoryAids: boolean | null
  impairedUnderstanding: boolean | null
  impairedJudgementReasoning: boolean | null
  behavioursOfConcernCurrent: boolean | null
  behavioursOfConcernFiveYearHistory: boolean | null
  behaviourRiskRating: RiskRatingLevel | null
  ridsLogged: boolean | null
  bspPlanProvided: boolean | null
  bocChartProvided: boolean | null
  expressiveSkills: string | null
  receptiveSkills: string | null
  readingAbility: string | null
  communicationAids: string | null

  // ── INTAKE sub-wave C2 — the structured ADL rating grid (Daily Living step).
  /** Always all twenty AdlType entries — see ParticipantAdlAssessmentsController.GetForParticipant. */
  adlAssessments: ParticipantAdlAssessmentDto[]

  // ── INTAKE-03/04, CommunityAccessDailyLiving stream — the structured Community Mobility &
  // Transport Risk / Community Behaviours of Concern checklist grid.
  /** Always all twenty-one ChecklistItemType entries — see ParticipantChecklistItemsController.MaterializeAll. */
  checklistItems: ParticipantChecklistItemDto[]

  // ── INTAKE sub-wave C2 — Meals & Diet (Daily Living step, Master Data Dictionary MEAL-001..012
  // minus the allergies dedup — see the backend Participant.cs field group doc).
  mealAssistanceDetail: string | null
  chokingRiskMealDetail: string | null
  modifiedDietDetail: string | null
  pegRegimeMealDetail: string | null
  specialUtensilsDetail: string | null
  specialDietaryNeedsDetail: string | null
  favouriteBreakfast: string | null
  favouriteLunch: string | null
  favouriteDinner: string | null
  medicationTricks: string | null
  foodsAlwaysEaten: string | null

  // ── INTAKE sub-wave C2 — About Me (Daily Living step, Master Data Dictionary GOAL-001..008
  // minus the Hobbies dedup onto personalInterests — see the backend field group doc).
  goals: string | null
  supportAreas: string | null
  strengthsFears: string | null
  thingsToKnow: string | null
  whoIsImportant: string | null
  likesDislikes: string | null

  // ── INTAKE-03 — Community Access Behaviour & Support Detail (CommunityAccessDailyLiving
  // stream, research spec §3). CA-gated in the wizard (not on the wire — the backend accepts
  // these unconditionally; the wizard hides them when the stream isn't selected).
  signsHappyAndSettled: string | null
  whatHelpsMeCalmDown: string | null
  bocTriggers: string | null
  bocEarlyWarningSigns: string | null
  bocDeEscalationStrategies: string | null
  bocWhatNotToDo: string | null
  supportsLookLikeMorning: string | null
  supportsLookLikeDay: string | null
  supportsLookLikeAfternoonEvening: string | null
  supportsLookLikeOvernight: string | null

  // ── PF-10.2/PF-10.4 (SPEC-05), CommunityAccessDailyLiving stream — the structured 22-item
  // Community Access Risk Assessment matrix and its single overall rating.
  /**
   * Always all twenty-two CommunityAccessRiskItemType entries — see
   * ParticipantCommunityAccessRiskItemsController.GetForParticipant. Optional (rather than
   * required), same convention as intakeCompletedAt above, so the many pre-existing
   * ParticipantDetailDto test fixtures across the participant-detail section tests don't all need
   * updating for a field most of them don't assert on.
   */
  communityAccessRiskItems?: ParticipantCommunityAccessRiskItemDto[]
  overallCommunityAccessRiskRating?: RiskRatingLevel | null
  /** PF-2 (SPEC-02): advisory-only plan-type↔contact-role completeness warning, computed
   * server-side from this participant's persisted active contactRoles — see
   * Odip.Domain.Enums.ContactRoleRules.PlanTypeComplianceWarning. Null when the condition for
   * this participant's planType is satisfied (or there is no condition, e.g. SelfManaged). Never
   * blocks a save; persists across reads until a qualifying contact role actually exists. */
  planTypeComplianceWarning: string | null
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
  /**
   * SPEC-05 (PF-10.3) — set true only by the Intake wizard's own final-step create call, to
   * stamp the participant's IntakeCompletedAt server-side. A mid-intake "save as draft" POST
   * (isDraft=true) must NOT also set this.
   */
  completeIntake?: boolean
  /** Stable client-generated idempotency key for an explicit intake completion retry. */
  completionRequestId?: string
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
  /** DIAG-01. Free text — selected from DIAGNOSIS_OPTIONS or typed via the "Other — specify" escape hatch (collapsed to this one field before submit; see the retired single-step wizard). */
  primaryDiagnosis?: string | null
  otherDiagnoses: string[]
  /** DIAG-02. Wire format: comma-separated HidpaSupportCategory flag names, or "None" — see formatHidpaCategories. */
  hidpaSupportCategories: string
  /** DIAG-02/INTAKE-03 reconciliation — free-text HIDPA notes. Ungated, same visibility as hidpaSupportCategories itself. */
  hidpaNotes?: string
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

  // INTAKE sub-wave C1 — Allergies/Anaphylaxis (Master Data Dictionary MED-012). All optional.
  allergiesDetail?: string
  isAnaphylaxisRisk?: boolean | null
  allergyManagementNotes?: string

  /**
   * The structured health-condition grid, upserted transactionally with the participant on both
   * create and update — same read-on-both-paths convention as consents above.
   */
  healthConditions: CreateParticipantHealthConditionDto[]

  // INTAKE sub-wave C1 — Mobility & Functional (Master Data Dictionary MOB-002/003/005..010/012). All optional.
  ambulantStatus?: AmbulantStatus | null
  fallsRiskRating?: RiskRatingLevel | null
  unevenGroundFlag?: boolean | null
  levelOfPersonalCare?: PersonalCareLevel | null
  orthotics?: string
  continenceSupportDetail?: string
  bowelCareDetail?: string
  menstruationSupport?: string
  skinIntegrity?: string

  // INTAKE sub-wave C1 — Behaviour & Communication (Master Data Dictionary COG-*/COM-*). All optional.
  memory?: MemoryLevel | null
  memoryAids?: boolean | null
  impairedUnderstanding?: boolean | null
  impairedJudgementReasoning?: boolean | null
  behavioursOfConcernCurrent?: boolean | null
  behavioursOfConcernFiveYearHistory?: boolean | null
  behaviourRiskRating?: RiskRatingLevel | null
  ridsLogged?: boolean | null
  bspPlanProvided?: boolean | null
  bocChartProvided?: boolean | null
  expressiveSkills?: string
  receptiveSkills?: string
  readingAbility?: string
  communicationAids?: string

  /**
   * INTAKE sub-wave C2 — the structured ADL rating grid, upserted transactionally with the
   * participant on both create and update — same read-on-both-paths convention as
   * healthConditions above.
   */
  adlAssessments: CreateParticipantAdlAssessmentDto[]

  /**
   * INTAKE-03/04, CommunityAccessDailyLiving stream — the structured Community Mobility &
   * Transport Risk / Community Behaviours of Concern checklist grid, upserted transactionally
   * with the participant on both create and update (same read-on-both-paths convention as
   * adlAssessments above).
   */
  checklistItems: CreateParticipantChecklistItemDto[]

  // ── INTAKE sub-wave C2 — Meals & Diet. All optional.
  mealAssistanceDetail?: string
  chokingRiskMealDetail?: string
  modifiedDietDetail?: string
  pegRegimeMealDetail?: string
  specialUtensilsDetail?: string
  specialDietaryNeedsDetail?: string
  favouriteBreakfast?: string
  favouriteLunch?: string
  favouriteDinner?: string
  medicationTricks?: string
  foodsAlwaysEaten?: string

  // ── INTAKE sub-wave C2 — About Me. All optional.
  goals?: string
  supportAreas?: string
  strengthsFears?: string
  thingsToKnow?: string
  whoIsImportant?: string
  likesDislikes?: string

  // ── INTAKE-03 — Community Access Behaviour & Support Detail (CommunityAccessDailyLiving
  // stream, research spec §3). All optional; conditional-visibility gating on serviceStreams
  // happens in the wizard, not here — see ParticipantDetailDto's matching field group doc.
  signsHappyAndSettled?: string
  whatHelpsMeCalmDown?: string
  bocTriggers?: string
  bocEarlyWarningSigns?: string
  bocDeEscalationStrategies?: string
  bocWhatNotToDo?: string
  supportsLookLikeMorning?: string
  supportsLookLikeDay?: string
  supportsLookLikeAfternoonEvening?: string
  supportsLookLikeOvernight?: string

  /**
   * PF-10.2 (SPEC-05) — the structured Community Access Risk Assessment matrix, upserted
   * transactionally with the participant on both create and update (same read-on-both-paths
   * convention as checklistItems above).
   */
  communityAccessRiskItems: CreateParticipantCommunityAccessRiskItemDto[]
  overallCommunityAccessRiskRating?: RiskRatingLevel | null
}

export interface UpdateParticipantDto extends CreateParticipantDto {
  isActive: boolean
}

/**
 * What `POST /participants/{id}/status` and `POST /participants/{id}/restore` answer. `changed` is false when the
 * participant was already in the requested state. `warnings` never block the change (upcoming shifts that still
 * reference an archived participant, readiness gaps on activation); the screen shows them verbatim after a success.
 */
export interface ParticipantStatusResultDto {
  id: string
  isActive: boolean
  isDraft: boolean
  changed: boolean
  warnings: string[]
}

/**
 * What `PUT /participants/{id}/intake` takes: the Intake wizard's own payload, the same shape `POST /participants` takes. The
 * server reads only the intake scope from it (never gender, diagnoses, allergies, key identifiers or any other profile-owned
 * field, and never whether the participant is a draft or active), creates the contacts and risk entries in it that the
 * participant does not already have, and is idempotent on `completionRequestId`.
 */
export type SaveParticipantIntakeDto = Partial<CreateParticipantDto>

/** Tenant-scoped immutable intake evidence; use its exact revision for the PDF download route. */
export interface ParticipantIntakeSnapshotDto {
  revision: number
  completedAtUtc: string
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

/** Connection map item 12 — one row of GET /participants/{id}/rostering's upcomingShifts (next 28
 * days). staffId/staffName are omitted (never sent as null) for an unfilled shift. */
export interface ParticipantRosteringShiftDto {
  shiftId: string
  serviceDate: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  staffId?: string
  staffName?: string
  status: ShiftStatus
  /** See ShiftDto.assigneeOnApprovedLeave — true when the assigned staff member's leave was
   * approved after the assignment was made, so this filled shift is actually a hole. */
  assigneeOnApprovedLeave: boolean
}

/** Connection map item 12 — one row of GET /participants/{id}/rostering's assignedStaff. */
export interface ParticipantRosteringStaffDto {
  staffId: string
  staffName: string
  shiftCount: number
  compatibility: CompatibilityLevel
}

/**
 * Connection map item 12 — GET /participants/{id}/rostering, backing the participant hub's new
 * Rostering tab (RosteringTab.tsx): who's rostered on for this participant and what's coming up,
 * without sending the coordinator all the way to the full roster board.
 */
export interface ParticipantRosteringDto {
  upcomingShifts: ParticipantRosteringShiftDto[]
  assignedStaff: ParticipantRosteringStaffDto[]
}
