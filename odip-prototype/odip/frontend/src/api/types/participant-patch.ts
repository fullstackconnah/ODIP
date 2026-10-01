import type {
  Gender,
  PlanType,
  FundingSource,
  LivingArrangement,
  AmbulantStatus,
  RiskRatingLevel,
  PersonalCareLevel,
  MemoryLevel,
  SupportRatio,
  OvernightSupportType,
} from './enums'
import type { CreateParticipantConsentDto } from './consents'
import type { CreateParticipantHealthConditionDto } from './health-conditions'
import type { CreateParticipantAdlAssessmentDto } from './adl-assessments'
import type { CreateParticipantChecklistItemDto } from './checklist-items'

/**
 * CORE-02: the canonical unit for a partial participant save is a semantic FIELD GROUP, not a
 * wizard step or a detail-tab section — both compose from these 20 groups (16 scalar + 4
 * collections), neither defines them. See backend ParticipantPatchDTOs.cs / SPEC-00's CORE-02
 * section for the full field-group partition and reasoning.
 *
 * ATOMICITY: presence is all-or-nothing at the GROUP level, not the field level. A present group
 * must carry every one of its member fields (mirrors a mini full-submit for just that group); a
 * present group's own field set to null/undefined CLEARS that field. An absent (undefined) group
 * leaves every one of its fields completely untouched. There is no IsDraft/IsActive here at
 * all — those stay the dedicated status, restore and complete-profile endpoints' job.
 */
export interface PatchParticipantDto {
  personalDetails?: PatchPersonalDetailsDto
  preferredStaff?: PatchPreferredStaffDto
  address?: PatchAddressDto
  livingArrangement?: PatchLivingArrangementDto
  ndisPlan?: PatchNdisPlanDto
  serviceProfile?: PatchServiceProfileDto
  keyIdentifiers?: PatchKeyIdentifiersDto
  culturalBackground?: PatchCulturalBackgroundDto
  supportNeedsMobility?: PatchSupportNeedsMobilityDto
  medical?: PatchMedicalDto
  behaviourCommunication?: PatchBehaviourCommunicationDto
  communityAccessBehaviour?: PatchCommunityAccessBehaviourDto
  mealsAndDiet?: PatchMealsAndDietDto
  aboutMe?: PatchAboutMeDto
  supportsLookLike?: PatchSupportsLookLikeDto
  risksHazardsSummary?: PatchRisksHazardsSummaryDto

  /**
   * consents group. undefined = no consent rows touched. Present = upserted by ConsentType key,
   * same as Create/Update: a type omitted from the array is left untouched; a type present with
   * every field null still clears that existing row (does not delete it).
   */
  consents?: CreateParticipantConsentDto[]
  /** healthConditions group. Same upsert-by-key contract as {@link consents}, keyed by HealthConditionType. */
  healthConditions?: CreateParticipantHealthConditionDto[]
  /** adlAssessments group. Same upsert-by-key contract as {@link consents}, keyed by AdlType. */
  adlAssessments?: CreateParticipantAdlAssessmentDto[]
  /**
   * checklistItems group — ONE flat 21-row collection split across TWO wizard steps by row, not
   * by field: rows 0-8 render on Support Needs & Mobility (step 5), rows 9-20 on Behaviour &
   * Communication (step 7). Same upsert-by-key contract as {@link consents}, keyed by
   * ChecklistItemType — but the split ownership makes it load-bearing here: a type OMITTED from
   * the array is left untouched (safe — this is the mechanism a step relies on for the other
   * step's rows), while a type PRESENT in the array with every field null still CLEARS that
   * existing row (not safe for a type the calling step doesn't own). A step-scoped caller MUST
   * submit ONLY the item-types its own step owns and MUST NOT include the other step's item-types
   * at all, not even as null-valued placeholder rows — do not resend the full 21-row array here
   * the way a whole-wizard-submission (create/update) does.
   */
  checklistItems?: CreateParticipantChecklistItemDto[]
}

/** personalDetails group — Identity (wizard step 0) / Identity (detail tab). */
export interface PatchPersonalDetailsDto {
  firstName: string
  lastName: string
  preferredName?: string | null
  middleName?: string | null
  dateOfBirth?: string | null
  gender?: Gender | null
  genderSelfDescription?: string | null
  placeOfBirth?: string | null
  country?: string | null
  phone?: string | null
  email?: string | null
}

/** preferredStaff group — isolated so the compatibility-link sync gates on this group's presence+diff alone. */
export interface PatchPreferredStaffDto {
  preferredStaffId?: string | null
}

/** address group — Identity (wizard step 0) / Address & Living Arrangements (detail tab). */
export interface PatchAddressDto {
  addressStreet?: string | null
  addressSuburb?: string | null
  addressState?: string | null
  addressPostcode?: string | null
}

/** livingArrangement group — Identity (wizard step 0) / Address & Living Arrangements (detail tab). */
export interface PatchLivingArrangementDto {
  livingArrangement?: LivingArrangement | null
  mainSupportPersonName?: string | null
  mainSupportPersonRelationship?: string | null
  othersLivingInAccommodation?: string | null
  residentialInfo?: string | null
  livesWithOthers?: boolean | null
  whoLivesWith?: string | null
  silProviderName?: string | null
  silProviderContactPhone?: string | null
  accommodationType?: string | null
  onSiteSupportHours?: string | null
  livingArrangementNotes?: string | null
}

/** ndisPlan group — NDIS & Funding (wizard step 1) / NDIS & Funding (detail tab). */
export interface PatchNdisPlanDto {
  ndisNumber?: string | null
  planStartDate?: string | null
  planEndDate?: string | null
  planType: PlanType
  fundingSource: FundingSource
  fundingOrganisation?: string | null
  isDsoa: boolean
  isRepeatClient: boolean
}

/** serviceProfile group — NDIS & Funding (wizard step 1) / no detail-tab section today (header-display only). */
export interface PatchServiceProfileDto {
  region?: string | null
  /** Wire format: comma-separated ServiceStreams flag names, or "None" — see formatServiceStreams. */
  serviceStreams: string
}

/** keyIdentifiers group — Key Identifiers (wizard step 2) / Key Identifiers (detail tab). */
export interface PatchKeyIdentifiersDto {
  pensionCardNumber?: string | null
  pensionCardExpiry?: string | null
  medicareNumber?: string | null
  medicareExpiry?: string | null
  companionCardNumber?: string | null
  companionCardExpiry?: string | null
  privateHealthFund?: string | null
  privateHealthMembershipNumber?: string | null
  taxiCardNumber?: string | null
  hairColour?: string | null
  eyeColour?: string | null
  weightKg?: number | null
  heightCm?: number | null
}

/** culturalBackground group — Cultural & Consent (wizard step 4) / Cultural Background (detail tab). */
export interface PatchCulturalBackgroundDto {
  isCald?: boolean | null
  isLgbtqi?: boolean | null
  isFamilyCommunity?: boolean | null
  isAboriginalOrTorresStraitIslander?: boolean | null
  receivedRightsAndResponsibilitiesInfo?: boolean | null
  receivedPrivacyAndConfidentialityInfo?: boolean | null
  receivedFeedbackInfo?: boolean | null
  receivedBeingSafeInfo?: boolean | null
  receivedAdvocacyInfo?: boolean | null
  personalInterests?: string | null
  choiceControlNotes?: string | null
}

/** supportNeedsMobility group — Support Needs & Mobility (wizard step 5) / Support Profile tab (PD-6). */
export interface PatchSupportNeedsMobilityDto {
  isHighSupport: boolean
  isIntensiveSupport: boolean
  supportRatio: SupportRatio
  mobilityAidWheelchair: boolean
  mobilityAidWalker: boolean
  mobilitySupportOptions: string[]
  overnightSupport: OvernightSupportType
  overnightRatio: SupportRatio
  requiresHiLoBed: boolean
  requiresHoist: boolean
  requiresShowerChair: boolean
  requiresCommode: boolean
  requiresStandingMachine: boolean
  mobilityNotes?: string | null
  equipmentRequirements?: string | null
  transportRequirements?: string | null
  ambulantStatus?: AmbulantStatus | null
  fallsRiskRating?: RiskRatingLevel | null
  unevenGroundFlag?: boolean | null
  levelOfPersonalCare?: PersonalCareLevel | null
  orthotics?: string | null
  continenceSupportDetail?: string | null
  bowelCareDetail?: string | null
  menstruationSupport?: string | null
  skinIntegrity?: string | null
}

/** medical group — Medical (wizard step 6) / Medical (detail tab). */
export interface PatchMedicalDto {
  primaryDiagnosis?: string | null
  otherDiagnoses: string[]
  /** Wire format: comma-separated HidpaSupportCategory flag names, or "None" — see formatHidpaCategories. */
  hidpaSupportCategories: string
  hidpaNotes?: string | null
  medicalSummary?: string | null
  allergiesDetail?: string | null
  isAnaphylaxisRisk?: boolean | null
  allergyManagementNotes?: string | null
}

/** behaviourCommunication group — Behaviour & Communication (wizard step 7) / Behaviour & Communication (detail tab). */
export interface PatchBehaviourCommunicationDto {
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
  expressiveSkills?: string | null
  receptiveSkills?: string | null
  readingAbility?: string | null
  communicationAids?: string | null
}

/**
 * communityAccessBehaviour group — Behaviour & Communication (wizard step 7, CA-gated) / Community
 * Access tab (with supportsLookLike). PF-10.4 (SPEC-05): also carries
 * `overallCommunityAccessRiskRating` — PF-10.2's single overall rating alongside the 22-row
 * communityAccessRiskItems matrix (that matrix stays on its own nested-CRUD endpoint,
 * `/participants/{id}/community-access-risk-items/{itemType}`, unaffected by core02 — the Profile
 * wizard's Community Access section PUTs each changed row there directly rather than through this
 * PATCH group).
 */
export interface PatchCommunityAccessBehaviourDto {
  signsHappyAndSettled?: string | null
  whatHelpsMeCalmDown?: string | null
  bocTriggers?: string | null
  bocEarlyWarningSigns?: string | null
  bocDeEscalationStrategies?: string | null
  bocWhatNotToDo?: string | null
  overallCommunityAccessRiskRating?: RiskRatingLevel | null
}

/** mealsAndDiet group — Daily Living (wizard step 8) / Meals & Diet (detail tab). */
export interface PatchMealsAndDietDto {
  mealAssistanceDetail?: string | null
  chokingRiskMealDetail?: string | null
  modifiedDietDetail?: string | null
  pegRegimeMealDetail?: string | null
  specialUtensilsDetail?: string | null
  specialDietaryNeedsDetail?: string | null
  favouriteBreakfast?: string | null
  favouriteLunch?: string | null
  favouriteDinner?: string | null
  medicationTricks?: string | null
  foodsAlwaysEaten?: string | null
}

/** aboutMe group — Daily Living (wizard step 8) / About Me (detail tab). */
export interface PatchAboutMeDto {
  goals?: string | null
  supportAreas?: string | null
  strengthsFears?: string | null
  thingsToKnow?: string | null
  whoIsImportant?: string | null
  likesDislikes?: string | null
}

/** supportsLookLike group — Daily Living (wizard step 8, CA-gated) / Community Access tab (with communityAccessBehaviour). */
export interface PatchSupportsLookLikeDto {
  supportsLookLikeMorning?: string | null
  supportsLookLikeDay?: string | null
  supportsLookLikeAfternoonEvening?: string | null
  supportsLookLikeOvernight?: string | null
}

/** risksHazardsSummary group — Risks & Hazards (wizard step 9) / Risks & Hazards Summary (detail tab). RiskEntries stays its own nested CRUD, unaffected. */
export interface PatchRisksHazardsSummaryDto {
  behaviourRiskSummary?: string | null
  notes?: string | null
}
