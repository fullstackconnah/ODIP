/**
 * PF-10.4 (SPEC-05) — the Profile wizard's CORE-02 PATCH-group plumbing: which semantic field
 * group(s) each Profile step patches, and how to build a group's payload from the wizard's live
 * form values. Mirrors `the retired single-step wizard`'s own `PATCH_GROUP_FIELDS`/`STEP_TO_PATCH_GROUPS`/
 * `extractGroupFields`/`handleSavePartial` machinery — copied (behaviour-preserving) rather than
 * imported, since that file is untouched (PF-10.7 retires it) and none of this was exported from
 * it. The 16 SCALAR group field-lists below are IDENTICAL to that file's own (the backend's group
 * partition doesn't change depending on which wizard is saving), so this is the same PATCH
 * contract, not a reinvented one.
 *
 * THE TRAP (see PatchParticipantDto's own doc): a present group is a mini full-submit for just
 * that group — every one of its member fields must be included, and a present-but-omitted member
 * is cleared, not left alone. Several scalar groups mix a Profile-owned field with Shared/Intake-
 * owned companion fields (e.g. `culturalBackground` carries personalInterests/choiceControlNotes
 * *and* the 9 shared cultural tri-state flags) — saving a Profile step that touches such a group
 * MUST echo the companion fields' current (read-only, Intake-set) values back in the same payload,
 * never omit or blank them. `buildParticipantWirePayload` below is given the FULL live form values
 * (shared fields included, loaded via ProfileWizardPage's initial `reset()`) for exactly this
 * reason — every group extraction below pulls from that one already-complete payload.
 *
 * The 4 upsert-by-key COLLECTION groups (consents/healthConditions/adlAssessments/checklistItems)
 * have their own trap, called out per-group below and in ProfileWizardPage.tsx's save handler.
 */
import type { ParticipantFormData } from './participantSchema'
import type { PatchParticipantDto } from '@/api/types/participant-patch'
import type { HidpaSupportCategory, ConsentType, ServiceStream } from '@/api/types/enums'
import { formatHidpaCategories, formatServiceStreams } from '@/api/types/participants'
import { triStateToBool } from '@/pages/intake/intakeFormat'

const DIAGNOSIS_OTHER_SENTINEL = 'Other — specify'

/** Every scalar (non-collection) group's member fields, keyed by PatchParticipantDto's own group
 * names — copied verbatim from the retired single-step wizard's PATCH_GROUP_FIELDS. */
type ScalarPatchGroup = Exclude<keyof PatchParticipantDto, 'consents' | 'healthConditions' | 'adlAssessments' | 'checklistItems'>
export const PATCH_GROUP_FIELDS: Record<ScalarPatchGroup, readonly (keyof ParticipantFormData)[]> = {
  personalDetails: ['firstName', 'lastName', 'preferredName', 'middleName', 'dateOfBirth', 'gender', 'genderSelfDescription', 'placeOfBirth', 'country', 'phone', 'email'],
  preferredStaff: ['preferredStaffId'],
  address: ['addressStreet', 'addressSuburb', 'addressState', 'addressPostcode'],
  livingArrangement: ['livingArrangement', 'mainSupportPersonName', 'mainSupportPersonRelationship', 'othersLivingInAccommodation', 'residentialInfo', 'livesWithOthers', 'whoLivesWith', 'silProviderName', 'silProviderContactPhone', 'accommodationType', 'onSiteSupportHours', 'livingArrangementNotes'],
  ndisPlan: ['ndisNumber', 'planStartDate', 'planEndDate', 'planType', 'fundingSource', 'fundingOrganisation', 'isDsoa', 'isRepeatClient'],
  serviceProfile: ['region', 'serviceStreams'],
  keyIdentifiers: ['pensionCardNumber', 'pensionCardExpiry', 'medicareNumber', 'medicareExpiry', 'companionCardNumber', 'companionCardExpiry', 'privateHealthFund', 'privateHealthMembershipNumber', 'taxiCardNumber', 'hairColour', 'eyeColour', 'weightKg', 'heightCm'],
  culturalBackground: ['isCald', 'isLgbtqi', 'isFamilyCommunity', 'isAboriginalOrTorresStraitIslander', 'receivedRightsAndResponsibilitiesInfo', 'receivedPrivacyAndConfidentialityInfo', 'receivedFeedbackInfo', 'receivedBeingSafeInfo', 'receivedAdvocacyInfo', 'personalInterests', 'choiceControlNotes'],
  supportNeedsMobility: ['isHighSupport', 'isIntensiveSupport', 'supportRatio', 'mobilityAidWheelchair', 'mobilityAidWalker', 'mobilitySupportOptions', 'overnightSupport', 'overnightRatio', 'requiresHiLoBed', 'requiresHoist', 'requiresShowerChair', 'requiresCommode', 'requiresStandingMachine', 'mobilityNotes', 'equipmentRequirements', 'transportRequirements', 'ambulantStatus', 'fallsRiskRating', 'unevenGroundFlag', 'levelOfPersonalCare', 'orthotics', 'continenceSupportDetail', 'bowelCareDetail', 'menstruationSupport', 'skinIntegrity'],
  medical: ['primaryDiagnosis', 'otherDiagnoses', 'hidpaSupportCategories', 'hidpaNotes', 'medicalSummary', 'allergiesDetail', 'isAnaphylaxisRisk', 'allergyManagementNotes'],
  behaviourCommunication: ['memory', 'memoryAids', 'impairedUnderstanding', 'impairedJudgementReasoning', 'behavioursOfConcernCurrent', 'behavioursOfConcernFiveYearHistory', 'behaviourRiskRating', 'ridsLogged', 'bspPlanProvided', 'bocChartProvided', 'expressiveSkills', 'receptiveSkills', 'readingAbility', 'communicationAids'],
  communityAccessBehaviour: ['signsHappyAndSettled', 'whatHelpsMeCalmDown', 'bocTriggers', 'bocEarlyWarningSigns', 'bocDeEscalationStrategies', 'bocWhatNotToDo', 'overallCommunityAccessRiskRating'],
  mealsAndDiet: ['mealAssistanceDetail', 'chokingRiskMealDetail', 'modifiedDietDetail', 'pegRegimeMealDetail', 'specialUtensilsDetail', 'specialDietaryNeedsDetail', 'favouriteBreakfast', 'favouriteLunch', 'favouriteDinner', 'medicationTricks', 'foodsAlwaysEaten'],
  aboutMe: ['goals', 'supportAreas', 'strengthsFears', 'thingsToKnow', 'whoIsImportant', 'likesDislikes'],
  supportsLookLike: ['supportsLookLikeMorning', 'supportsLookLikeDay', 'supportsLookLikeAfternoonEvening', 'supportsLookLikeOvernight'],
  risksHazardsSummary: ['behaviourRiskSummary', 'notes'],
}

/**
 * PF-10.4 — which CORE-02 group(s) a Profile step's "Next"/"Save" patches. Unlike
 * the retired single-step wizard's STEP_TO_PATCH_GROUPS (one step per group, mostly), several groups
 * here are split ACROSS steps by field (not by row, like the collection trap) because the Profile
 * wizard's step boundaries don't align 1:1 with the backend's group boundaries — e.g.
 * `culturalBackground` is entirely owned by `culturalDepth` (personalInterests/choiceControlNotes
 * are its only Profile-entry members), while `medical`/`supportNeedsMobility`/
 * `behaviourCommunication` are owned by `medical`/`mobility`/`behaviourCognition` respectively.
 * `personalDetails`/`ndisPlan`/`preferredStaff`/`keyIdentifiers` are all owned by `keyIdentifiers`
 * (see participantSchema.ts's PROFILE_STEP_KEY_IDENTIFIERS_FIELDS placement note).
 * `communityAccessBehaviour` also now carries PF-10.4's `overallCommunityAccessRiskRating` (see
 * PatchCommunityAccessBehaviourDto's backend doc) — owned by `communityAccess`, alongside
 * `checklistItems` (the whole 21-row collection, since PF-10.1 tags it entirely
 * CommunityAccessDailyLiving-gated here, unlike the old wizard's split-by-row ownership).
 * `address`/`livingArrangement`/`serviceProfile`/`supportsLookLike`/`aboutMe`/`mealsAndDiet`/
 * `risksHazardsSummary` are owned by other steps below.
 */
export const PROFILE_STEP_TO_PATCH_GROUPS: Partial<Record<string, (keyof PatchParticipantDto)[]>> = {
  keyIdentifiers: ['personalDetails', 'preferredStaff', 'ndisPlan', 'keyIdentifiers'],
  culturalDepth: ['culturalBackground', 'consents'],
  medical: ['medical', 'healthConditions'],
  mobility: ['supportNeedsMobility'],
  behaviourCognition: ['behaviourCommunication'],
  dailyLiving: ['adlAssessments', 'mealsAndDiet', 'aboutMe'],
  communityAccess: ['communityAccessBehaviour', 'checklistItems'],
}

/**
 * The Profile wizard's own step -> group map: PROFILE_STEP_TO_PATCH_GROUPS plus the two groups that hold
 * intake-captured fields the wizard now lets staff correct, but that no step patched before, so an edit
 * to them would not have persisted on "Next":
 *  - `address` (street/suburb/state/postcode) on Key Identifiers;
 *  - `risksHazardsSummary` (behaviourRiskSummary) on Behaviour & Cognition. It is a mini full-submit, so it
 *    also carries `notes`, which the wizard hydrates from the participant and echoes (THE TRAP above).
 * Kept apart from PROFILE_STEP_TO_PATCH_GROUPS because the caregiver wizard reads that one and must not
 * start submitting groups whose fields it treats as read-only or internal.
 */
export const PROFILE_WIZARD_STEP_TO_PATCH_GROUPS: Partial<Record<string, (keyof PatchParticipantDto)[]>> = {
  ...PROFILE_STEP_TO_PATCH_GROUPS,
  keyIdentifiers: [...(PROFILE_STEP_TO_PATCH_GROUPS.keyIdentifiers ?? []), 'address'],
  behaviourCognition: [...(PROFILE_STEP_TO_PATCH_GROUPS.behaviourCognition ?? []), 'risksHazardsSummary'],
}

/** Pulls one scalar group's fields out of an already wire-shaped payload — verbatim copy of
 * the retired single-step wizard's extractGroupFields. */
export function extractGroupFields(payload: Record<string, unknown>, fields: readonly (keyof ParticipantFormData)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) out[f as string] = payload[f as string]
  return out
}

/** Every scalar-tri-state field (both Shared/Intake-owned and Profile-owned) that must be
 * collapsed from the wizard's 'true'|'false'|'' UI shape to boolean|null before any group extract
 * — union of IntakeWizardPage.tsx's CULTURAL_TRI_STATE_FIELDS and the retired single-step wizard's
 * clinicalField list, since a Profile-step PATCH group can carry either kind (the trap above). */
export const TRI_STATE_FIELDS = [
  'isCald', 'isLgbtqi', 'isFamilyCommunity', 'isAboriginalOrTorresStraitIslander',
  'receivedRightsAndResponsibilitiesInfo', 'receivedPrivacyAndConfidentialityInfo',
  'receivedFeedbackInfo', 'receivedBeingSafeInfo', 'receivedAdvocacyInfo',
  'behavioursOfConcernCurrent', 'behavioursOfConcernFiveYearHistory',
  'isAnaphylaxisRisk', 'unevenGroundFlag', 'memoryAids', 'impairedUnderstanding',
  'impairedJudgementReasoning', 'ridsLogged', 'bspPlanProvided', 'bocChartProvided',
] as const satisfies readonly (keyof ParticipantFormData)[]

/**
 * Transforms the wizard's live RHF values (the FULL form — shared fields included) into a flat,
 * wire-shaped payload covering every field either wizard's PATCH groups might read — same
 * responsibility as the retired single-step wizard's buildPayload, scoped to what the Profile wizard's
 * groups actually touch (no contactRoles/riskEntries expansion — Profile never owns those).
 */
export function buildParticipantWirePayload(data: ParticipantFormData): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...data }

  // Not editable by the Profile wizard (Intake-owned), but must round-trip in wire format for the
  // final full-PUT (see ProfileWizardPage.tsx's completion handler) — same convention as
  // the retired single-step wizard's buildPayload.
  payload.serviceStreams = formatServiceStreams(data.serviceStreams as ServiceStream[] | undefined)

  for (const field of TRI_STATE_FIELDS) {
    payload[field] = triStateToBool(data[field] as string | undefined)
  }

  // DIAG-01 — same two-field-to-one collapse as the retired single-step wizard's buildPayload.
  payload.primaryDiagnosis = data.primaryDiagnosis === DIAGNOSIS_OTHER_SENTINEL
    ? data.primaryDiagnosisOther
    : data.primaryDiagnosis
  delete payload.primaryDiagnosisOther

  payload.hidpaSupportCategories = formatHidpaCategories(data.hidpaSupportCategories as HidpaSupportCategory[] | undefined)

  for (const numField of ['weightKg', 'heightCm'] as const) {
    const raw = payload[numField]
    const num = raw === '' || raw === null || raw === undefined ? NaN : Number(raw)
    payload[numField] = Number.isFinite(num) && num !== 0 ? num : null
  }

  payload.consents = (data.consents ?? []).map((c) => ({
    consentType: c.consentType,
    granted: triStateToBool(c.granted),
    signedByName: c.granted === 'true' ? (c.signedByName || null) : null,
    signedDate: c.granted === 'true' ? (c.signedDate || null) : null,
  }))
  payload.healthConditions = (data.healthConditions ?? []).map((c) => ({
    conditionType: c.conditionType,
    has: triStateToBool(c.has),
    severity: c.has === 'true' ? (c.severity || null) : null,
    planProvided: c.has === 'true' ? triStateToBool(c.planProvided) : null,
    trainingRequired: c.has === 'true' ? triStateToBool(c.trainingRequired) : null,
    notes: c.has === 'true' ? (c.notes || null) : null,
  }))
  payload.adlAssessments = (data.adlAssessments ?? []).map((a) => ({
    adlType: a.adlType,
    level: a.level || null,
    notes: a.level ? (a.notes || null) : null,
    howToHelpNotes: a.level ? (a.howToHelpNotes || null) : null,
  }))
  payload.checklistItems = (data.checklistItems ?? []).map((c) => ({
    itemType: c.itemType,
    value: c.value || null,
    notes: c.value ? (c.notes || null) : null,
  }))
  payload.communityAccessRiskItems = (data.communityAccessRiskItems ?? []).map((r) => ({
    itemType: r.itemType,
    rating: r.rating || null,
    strategyNotes: r.rating ? (r.strategyNotes || null) : null,
  }))

  for (const key of Object.keys(payload)) {
    if (payload[key] === '' || payload[key] === undefined) payload[key] = null
  }
  return payload
}

/**
 * PF-10.4 — the Holiday/STA-gated consent types (see PROFILE_CONDITIONAL_SECTIONS' `holidaySta`
 * entry). PhotoVideo/Privacy/EmergencyMedical are always collectible regardless of serviceStreams.
 */
export const HOLIDAY_STA_CONSENT_TYPES: readonly ConsentType[] = ['Alcohol', 'OtcMedication', 'TravelInsurance', 'TermsAndConditions']

/**
 * THE TRAP, consents flavour: the `consents` collection group is upsert-by-key — a ConsentType
 * OMITTED from the array is left untouched, but one PRESENT with null values still CLEARS it. When
 * `staVisible` is false, the Cultural Depth/Consents step's save MUST omit the 4 Holiday/STA
 * consent types entirely (not send them as null-valued rows) so a participant moved off `STA`
 * keeps its previously-recorded Alcohol/OtcMedication/TravelInsurance/TermsAndConditions consent
 * rows untouched server-side (SPEC-05's retained-but-hidden acceptance criterion) — never re-send
 * the full 7-row array unconditionally the way a whole-wizard create/update does.
 */
export function filterConsentsForSave(consents: { consentType: string }[], staVisible: boolean): { consentType: string }[] {
  if (staVisible) return consents
  return consents.filter((c) => !HOLIDAY_STA_CONSENT_TYPES.includes(c.consentType as ConsentType))
}

/** Builds one CORE-02 group's payload value from the already-transformed wire payload. */
export function buildGroupPayload(group: keyof PatchParticipantDto, payload: Record<string, unknown>, staVisible: boolean): unknown {
  if (group === 'consents') {
    return filterConsentsForSave(payload.consents as { consentType: string }[], staVisible)
  }
  if (group === 'healthConditions' || group === 'adlAssessments' || group === 'checklistItems') {
    return payload[group]
  }
  return extractGroupFields(payload, PATCH_GROUP_FIELDS[group as ScalarPatchGroup])
}

/** Assembles a full PatchParticipantDto for one Profile step, applying every group it owns.
 * `groupsByStep` defaults to the caregiver-safe map; the Profile wizard passes PROFILE_WIZARD_STEP_TO_PATCH_GROUPS. */
export function buildProfileStepPatch(
  stepKey: string,
  data: ParticipantFormData,
  staVisible: boolean,
  groupsByStep: Partial<Record<string, (keyof PatchParticipantDto)[]>> = PROFILE_STEP_TO_PATCH_GROUPS,
): PatchParticipantDto | null {
  const groups = groupsByStep[stepKey]
  if (!groups) return null
  const payload = buildParticipantWirePayload(data)
  const dto: Record<string, unknown> = {}
  for (const group of groups) {
    dto[group] = buildGroupPayload(group, payload, staVisible)
  }
  return dto as PatchParticipantDto
}
