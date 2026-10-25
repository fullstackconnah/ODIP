import { parseHidpaCategories, type ParticipantDetailDto } from '@/api/types/participants'

// Whether anything in a Details card is recorded. The card hides itself from a role that cannot edit when this is false, and the
// Details tab folds an editor's empty cards into one "Not recorded" line (VISUAL-1 V2). A module of its own, not the card files:
// React Fast Refresh wants a component file to export only components.

export function hasAddressLiving(p: ParticipantDetailDto): boolean {
  return !!(p.addressStreet || p.addressSuburb || p.addressState || p.addressPostcode || p.country || p.livingArrangement)
}

export function hasKeyIdentifiers(p: ParticipantDetailDto): boolean {
  return !!(p.pensionCardNumber || p.medicareNumber || p.companionCardNumber || p.privateHealthFund
    || p.taxiCardNumber || p.hairColour || p.eyeColour || p.weightKg || p.heightCm)
}

export function hasCulturalBackground(p: ParticipantDetailDto): boolean {
  return p.isCald != null || p.isLgbtqi != null || p.isFamilyCommunity != null || p.isAboriginalOrTorresStraitIslander != null
    || p.receivedRightsAndResponsibilitiesInfo != null || p.receivedPrivacyAndConfidentialityInfo != null
    || p.receivedFeedbackInfo != null || p.receivedBeingSafeInfo != null || p.receivedAdvocacyInfo != null
    || !!p.personalInterests || !!p.choiceControlNotes
}

export function hasMedical(p: ParticipantDetailDto): boolean {
  return !!(p.primaryDiagnosis || p.otherDiagnoses?.length || parseHidpaCategories(p.hidpaSupportCategories).length || p.hidpaNotes || p.medicalSummary
    || p.allergiesDetail || p.isAnaphylaxisRisk != null || p.allergyManagementNotes)
}

export function hasBehaviourCommunication(p: ParticipantDetailDto): boolean {
  return p.memory != null || p.memoryAids != null || p.impairedUnderstanding != null || p.impairedJudgementReasoning != null
    || p.behavioursOfConcernCurrent != null || p.behavioursOfConcernFiveYearHistory != null || p.behaviourRiskRating != null
    || p.ridsLogged != null || p.bspPlanProvided != null || p.bocChartProvided != null
    || !!p.expressiveSkills || !!p.receptiveSkills || !!p.readingAbility || !!p.communicationAids
}

export function hasMealsDiet(p: ParticipantDetailDto): boolean {
  return !!(p.mealAssistanceDetail || p.chokingRiskMealDetail || p.modifiedDietDetail || p.pegRegimeMealDetail
    || p.specialUtensilsDetail || p.specialDietaryNeedsDetail || p.favouriteBreakfast || p.favouriteLunch
    || p.favouriteDinner || p.medicationTricks || p.foodsAlwaysEaten)
}

export function hasAboutMe(p: ParticipantDetailDto): boolean {
  return !!(p.goals || p.supportAreas || p.strengthsFears || p.thingsToKnow || p.whoIsImportant || p.likesDislikes)
}

export function hasRisksHazardsSummary(p: ParticipantDetailDto): boolean {
  return !!(p.behaviourRiskSummary || p.notes)
}

// shortcut: whole-value match against a fixed list of "nothing" phrases (lead G6/G7); any other wording raises a flag.
// Upgrade to a structured yes/no field in slice 3.
const NOTHING = /^(nil|none|n\/a|na|-|nka|nkda|nil known|none known|no known( (drug|food))? (allergies|allergy|conditions|issues))\.?$/i

/** True for a blank value or one that, as a whole, says there is nothing ("Nil", "None.", "NKDA"). "Nil by mouth" is not nothing. */
export const meansNothing = (t?: string | null) => {
  const s = (t ?? '').trim().replace(/\s+/g, ' ')
  return s === '' || NOTHING.test(s)
}

// Slice 2: the Health and Daily sections. Each is true when any of its fields is non-empty; the page folds a section for which it is false.
// Support-profile text fields are checked on the profile itself (see hasTopic); these cover the participant record.

export function hasSupportNeeds(p: ParticipantDetailDto): boolean {
  return !!(p.isHighSupport || p.isIntensiveSupport || p.hasRestrictivePracticeFlag || p.supportRatio)
}

export function hasMobilityPersonalCare(p: ParticipantDetailDto): boolean {
  return !!(p.mobilityAidWheelchair || p.mobilityAidWalker || p.mobilitySupportOptions?.length || p.mobilityNotes || p.ambulantStatus
    || p.fallsRiskRating || p.unevenGroundFlag != null || p.levelOfPersonalCare || p.orthotics || p.bowelCareDetail
    || p.continenceSupportDetail || p.menstruationSupport || p.skinIntegrity)
}

export function hasEquipmentOvernight(p: ParticipantDetailDto): boolean {
  return !!(p.requiresHiLoBed || p.requiresHoist || p.requiresShowerChair || p.requiresCommode || p.requiresStandingMachine
    || p.equipmentRequirements || (p.overnightSupport && p.overnightSupport !== 'None'))
}

export function hasTransportTravel(p: ParticipantDetailDto): boolean {
  return !!p.transportRequirements
}


export function hasTypicalDay(p: ParticipantDetailDto): boolean {
  return !!(p.supportsLookLikeMorning || p.supportsLookLikeDay || p.supportsLookLikeAfternoonEvening || p.supportsLookLikeOvernight)
}

export function hasEmergency(emergencyConsiderations?: string | null): boolean {
  return !!emergencyConsiderations?.trim()
}
