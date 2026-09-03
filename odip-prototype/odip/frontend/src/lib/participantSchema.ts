/**
 * PF-10.3 (SPEC-05 `docs/specs/odip-updates-2026-09/SPEC-05-intake-profile-split.md`) — the
 * Intake wizard's Zod schema, field set, and per-step validation.
 *
 * PF-10.1 already landed `entryPhase`/`fieldsForEntry` on `documentMapping.ts` as the single
 * authoritative "which wizard captures this field" tag, but did not land its own planned
 * `participantSchema.ts` extraction (SPEC-00/SPEC-05's PF-10.1 Implementation §2) — that file
 * does not exist yet anywhere on `main`. This module is that extraction, scoped to exactly what
 * PF-10.3 needs: a schema covering every `entryPhase: 'intake'` field, so the Intake wizard never
 * hand-copies a duplicate field list — `INTAKE_FIELD_NAMES` below is derived from
 * `fieldsForEntry('intake')`, not typed out by hand, and a dedicated test
 * (`documentMapping.driftGuard.test.ts`) asserts this file's schema shape and the wizard's step
 * groupings partition that exact set with no Profile-only field ever slipping in.
 *
 * `ParticipantCreatePage.tsx` (the pre-existing 11-step monolith) is NOT modified by this file —
 * per PF-10.3's brief it stays untouched until PF-10.7 retires it. The field definitions below are
 * copied from its `baseParticipantSchema` (verbatim, for the 61 fields `entryPhase: 'intake'`
 * covers), not re-derived from scratch, so validation behaviour for shared fields matches exactly.
 * A future PF-10.4 branch building the Profile wizard's own schema is expected to add its own,
 * separate `profileParticipantSchema` here (or a sibling file) once that work starts — not done by
 * this branch, which only needs Intake.
 */
import { z } from 'zod'
import type { FieldErrors, Resolver } from 'react-hook-form'
import { fieldsForEntry } from './documentMapping'
import { contactRoleGateError } from '@/api/types/contacts'
import type { PlanType } from '@/api/types/enums'

// ─────────────────────────────────────────────────────────────────────────────
// Base schema — every entryPhase:'intake' field, per DOCUMENT_MAPPING/fieldsForEntry('intake').
// Field defs copied verbatim from ParticipantCreatePage.tsx's baseParticipantSchema.
// ─────────────────────────────────────────────────────────────────────────────
export const baseParticipantSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  preferredName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  addressStreet: z.string().optional(),
  addressSuburb: z.string().optional(),
  addressState: z.string().optional(),
  addressPostcode: z.string().optional(),
  livingArrangement: z.string().optional(),
  mainSupportPersonName: z.string().optional(),
  mainSupportPersonRelationship: z.string().optional(),
  othersLivingInAccommodation: z.string().optional(),
  residentialInfo: z.string().optional(),
  livesWithOthers: z.boolean().optional(),
  whoLivesWith: z.string().optional(),
  silProviderName: z.string().optional(),
  silProviderContactPhone: z.string().optional(),
  accommodationType: z.string().optional(),
  onSiteSupportHours: z.string().optional(),
  livingArrangementNotes: z.string().optional(),
  ndisNumber: z.string().optional(),
  planStartDate: z.string().optional(),
  planEndDate: z.string().optional(),
  planType: z.string().optional(),
  fundingSource: z.string().min(1),
  fundingOrganisation: z.string().optional(),
  region: z.string().optional(),
  isRepeatClient: z.boolean().optional(),
  serviceStreams: z.array(z.string()).optional(),
  contactRoles: z.array(z.object({
    personMode: z.enum(['existing', 'new']),
    personId: z.string().optional(),
    newPersonFirstName: z.string().optional(),
    newPersonLastName: z.string().optional(),
    roleTypes: z.array(z.string()).min(1, 'Select at least one role'),
    relationshipToParticipant: z.string().optional(),
    isPrimary: z.boolean().optional(),
    registeredProviderFlag: z.boolean().optional(),
  })).optional(),
  mobilityAidWheelchair: z.boolean().optional(),
  mobilityAidWalker: z.boolean().optional(),
  isHighSupport: z.boolean().optional(),
  isIntensiveSupport: z.boolean().optional(),
  overnightSupport: z.string().min(1),
  overnightRatio: z.string().min(1),
  requiresHiLoBed: z.boolean().optional(),
  requiresHoist: z.boolean().optional(),
  requiresShowerChair: z.boolean().optional(),
  requiresCommode: z.boolean().optional(),
  requiresStandingMachine: z.boolean().optional(),
  supportRatio: z.string().min(1),
  medicalSummary: z.string().optional(),
  hidpaNotes: z.string().optional(),
  isCald: z.enum(['true', 'false', '']).optional(),
  isLgbtqi: z.enum(['true', 'false', '']).optional(),
  isFamilyCommunity: z.enum(['true', 'false', '']).optional(),
  isAboriginalOrTorresStraitIslander: z.enum(['true', 'false', '']).optional(),
  receivedRightsAndResponsibilitiesInfo: z.enum(['true', 'false', '']).optional(),
  receivedPrivacyAndConfidentialityInfo: z.enum(['true', 'false', '']).optional(),
  receivedFeedbackInfo: z.enum(['true', 'false', '']).optional(),
  receivedBeingSafeInfo: z.enum(['true', 'false', '']).optional(),
  receivedAdvocacyInfo: z.enum(['true', 'false', '']).optional(),
  behavioursOfConcernCurrent: z.enum(['true', 'false', '']).optional(),
  behavioursOfConcernFiveYearHistory: z.enum(['true', 'false', '']).optional(),
  expressiveSkills: z.string().optional(),
  behaviourRiskSummary: z.string().optional(),
  notes: z.string().optional(),
  riskEntries: z.array(z.object({
    atRiskParty: z.string().min(1),
    description: z.string().min(1, 'Description is required'),
    mitigationNotes: z.string().optional(),
  })).optional(),

  // ─────────────────────────────────────────────────────────────────────────────
  // PF-10.4 (SPEC-05) — Profile wizard fields. Every entryPhase:'profile' field, per
  // fieldsForEntry('profile') (85 fields). Field defs copied verbatim (behaviour-preserving) from
  // ParticipantCreatePage.tsx's baseParticipantSchema, same convention PF-10.3 used above for the
  // 61 intake fields. Kept in this SAME flat object (not a second schema) per this file's own
  // header doc — a single ParticipantFormData type covers both wizards' payload shapes.
  // ─────────────────────────────────────────────────────────────────────────────
  middleName: z.string().optional(),
  gender: z.string().optional(),
  genderSelfDescription: z.string().optional(),
  placeOfBirth: z.string().optional(),
  country: z.string().optional(),
  preferredStaffId: z.string().optional().nullable(),
  isDsoa: z.boolean().optional(),
  pensionCardNumber: z.string().optional(),
  pensionCardExpiry: z.string().optional(),
  medicareNumber: z.string().optional(),
  medicareExpiry: z.string().optional(),
  companionCardNumber: z.string().optional(),
  companionCardExpiry: z.string().optional(),
  privateHealthFund: z.string().optional(),
  privateHealthMembershipNumber: z.string().optional(),
  taxiCardNumber: z.string().optional(),
  hairColour: z.string().optional(),
  eyeColour: z.string().optional(),
  weightKg: z.coerce.number().optional(),
  heightCm: z.coerce.number().optional(),
  mobilitySupportOptions: z.array(z.string()).optional(),
  mobilityNotes: z.string().optional(),
  equipmentRequirements: z.string().optional(),
  transportRequirements: z.string().optional(),
  ambulantStatus: z.string().optional(),
  fallsRiskRating: z.string().optional(),
  unevenGroundFlag: z.enum(['true', 'false', '']).optional(),
  levelOfPersonalCare: z.string().optional(),
  orthotics: z.string().optional(),
  continenceSupportDetail: z.string().optional(),
  bowelCareDetail: z.string().optional(),
  menstruationSupport: z.string().optional(),
  skinIntegrity: z.string().optional(),
  // DIAG-01. primaryDiagnosis holds either a curated DIAGNOSIS_OPTIONS value or the
  // DIAGNOSIS_OTHER_SENTINEL; primaryDiagnosisOther is the "Other — specify" UI-only helper field
  // collapsed into primaryDiagnosis before submit (not itself a DocumentMapping/DTO field).
  primaryDiagnosis: z.string().optional(),
  primaryDiagnosisOther: z.string().optional(),
  otherDiagnoses: z.array(z.string()).optional(),
  hidpaSupportCategories: z.array(z.string()).optional(),
  allergiesDetail: z.string().optional(),
  isAnaphylaxisRisk: z.enum(['true', 'false', '']).optional(),
  allergyManagementNotes: z.string().optional(),
  // Fixed 10-row array (one per HealthConditionType, never user-add/remove).
  healthConditions: z.array(z.object({
    conditionType: z.string(),
    has: z.enum(['true', 'false', '']).optional(),
    severity: z.string().optional(),
    planProvided: z.enum(['true', 'false', '']).optional(),
    trainingRequired: z.enum(['true', 'false', '']).optional(),
    notes: z.string().optional(),
  })).optional(),
  personalInterests: z.string().optional(),
  choiceControlNotes: z.string().optional(),
  // Fixed 7-row array (one per ConsentType, never user-add/remove) — PhotoVideo/Privacy/
  // EmergencyMedical always shown; Alcohol/OtcMedication/TravelInsurance/TermsAndConditions
  // gated on serviceStreams.includes('STA') (see the Profile wizard's Consents step).
  consents: z.array(z.object({
    consentType: z.string(),
    granted: z.enum(['true', 'false', '']).optional(),
    signedByName: z.string().optional(),
    signedDate: z.string().optional(),
  })).optional(),
  memory: z.string().optional(),
  memoryAids: z.enum(['true', 'false', '']).optional(),
  impairedUnderstanding: z.enum(['true', 'false', '']).optional(),
  impairedJudgementReasoning: z.enum(['true', 'false', '']).optional(),
  behaviourRiskRating: z.string().optional(),
  ridsLogged: z.enum(['true', 'false', '']).optional(),
  bspPlanProvided: z.enum(['true', 'false', '']).optional(),
  bocChartProvided: z.enum(['true', 'false', '']).optional(),
  receptiveSkills: z.string().optional(),
  readingAbility: z.string().optional(),
  communicationAids: z.string().optional(),
  // Fixed 20-row array (one per AdlType, never user-add/remove).
  adlAssessments: z.array(z.object({
    adlType: z.string(),
    level: z.string().optional(),
    notes: z.string().optional(),
    // CommunityAccessDailyLiving-gated column — see the Daily Living step.
    howToHelpNotes: z.string().optional(),
  })).optional(),
  mealAssistanceDetail: z.string().optional(),
  chokingRiskMealDetail: z.string().optional(),
  modifiedDietDetail: z.string().optional(),
  pegRegimeMealDetail: z.string().optional(),
  specialUtensilsDetail: z.string().optional(),
  specialDietaryNeedsDetail: z.string().optional(),
  favouriteBreakfast: z.string().optional(),
  favouriteLunch: z.string().optional(),
  favouriteDinner: z.string().optional(),
  medicationTricks: z.string().optional(),
  foodsAlwaysEaten: z.string().optional(),
  goals: z.string().optional(),
  supportAreas: z.string().optional(),
  strengthsFears: z.string().optional(),
  thingsToKnow: z.string().optional(),
  whoIsImportant: z.string().optional(),
  likesDislikes: z.string().optional(),
  // ── Community Access section (CommunityAccessDailyLiving-gated in the Profile wizard) ──
  signsHappyAndSettled: z.string().optional(),
  whatHelpsMeCalmDown: z.string().optional(),
  bocTriggers: z.string().optional(),
  bocEarlyWarningSigns: z.string().optional(),
  bocDeEscalationStrategies: z.string().optional(),
  bocWhatNotToDo: z.string().optional(),
  // Fixed 21-row array (one per ChecklistItemType, never user-add/remove) — the whole field is
  // CommunityAccessDailyLiving-gated (unlike adlAssessments, where only howToHelpNotes is gated).
  checklistItems: z.array(z.object({
    itemType: z.string(),
    value: z.string().optional(),
    notes: z.string().optional(),
  })).optional(),
  // PF-10.2 — fixed 22-row array (one per CommunityAccessRiskItemType, never user-add/remove).
  // Saved via the dedicated nested-CRUD endpoint (one PUT per row), not a PatchParticipantDto
  // collection group — see the Profile wizard's Community Access step.
  communityAccessRiskItems: z.array(z.object({
    itemType: z.string(),
    rating: z.string().optional(),
    strategyNotes: z.string().optional(),
  })).optional(),
  overallCommunityAccessRiskRating: z.string().optional(),
  supportsLookLikeMorning: z.string().optional(),
  supportsLookLikeDay: z.string().optional(),
  supportsLookLikeAfternoonEvening: z.string().optional(),
  supportsLookLikeOvernight: z.string().optional(),
})

export type ParticipantFormData = z.infer<typeof baseParticipantSchema>

// ─────────────────────────────────────────────────────────────────────────────
// PF-10.1's contract, applied: the wizard's field set IS fieldsForEntry('intake') — no
// hand-authored duplicate list. `pick()` below is driven entirely by this derived array.
// ─────────────────────────────────────────────────────────────────────────────
export const INTAKE_FIELD_NAMES = fieldsForEntry('intake').map((e) => e.field) as (keyof ParticipantFormData)[]

export function pickShape<T extends readonly (keyof ParticipantFormData)[]>(fields: T) {
  return Object.fromEntries(fields.map((f) => [f, true])) as { [K in T[number]]: true }
}

// ── Cross-field refines — audited against PF-10.1's Intake/Profile field table, not ported
// wholesale from ParticipantCreatePage.tsx. Every refine below targets ONLY intake-entry fields:
//   - fundingSourceRefine (fundingSource/fundingOrganisation/planType) — all Intake.
//   - livingArrangementRefine (livingArrangement/mainSupportPersonName/livesWithOthers/
//     whoLivesWith/silProviderName) — all Intake. SPEC-05's PF-10.3 Implementation §1 text lists
//     this refine among ones that "move to PF-10.4 or are dropped", but every one of its target
//     fields is entryPhase:'intake' per PF-10.1's own table — so it is KEPT here, not dropped.
//     Flagged explicitly in this branch's report as a spec-text/table inconsistency resolved in
//     the table's favour (the table is the authoritative allocation).
//   - addressPostcodeRefine (addressPostcode) — Intake.
//   - contactMethodRefine (phone/email) — Intake.
//   - contactRolesRefine (contactRoles rows + planType) — Intake.
// Dropped (not ported): genderRefine (gender/genderSelfDescription — both Profile-entry),
// weightHeightRefine (weightKg/heightCm — Key Identifiers step is entirely Profile-entry),
// diagnosisOtherRefine (primaryDiagnosis/primaryDiagnosisOther — Profile-entry),
// equipmentRefine (its issue-target field, equipmentRequirements, is Profile-entry; the checkbox
// fields it reads are Intake but the refine has nothing to validate without the Profile-only
// notes field it gates).
type FundingFields = { fundingSource?: string; fundingOrganisation?: string; planType?: string }
export function fundingSourceRefine(data: FundingFields, ctx: z.RefinementCtx) {
  if (data.fundingSource === 'Other' && !data.fundingOrganisation?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fundingOrganisation'], message: 'Please specify the funding organisation.' })
  }
  if (data.fundingSource === 'Ndis' && !data.planType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['planType'], message: 'Plan type is required.' })
  }
}

type LivingFields = {
  livingArrangement?: string
  mainSupportPersonName?: string
  livesWithOthers?: boolean
  whoLivesWith?: string
  silProviderName?: string
}
export function livingArrangementRefine(data: LivingFields, ctx: z.RefinementCtx) {
  if (data.livingArrangement === 'Family' && !data.mainSupportPersonName?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mainSupportPersonName'], message: "Please provide the main support person's name." })
  }
  if (data.livingArrangement === 'Independent' && data.livesWithOthers && !data.whoLivesWith?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['whoLivesWith'], message: 'Please specify who the participant lives with.' })
  }
  if (data.livingArrangement === 'SupportedAccommodation' && !data.silProviderName?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['silProviderName'], message: 'Please provide the SIL provider name.' })
  }
}

type AddressFields = { addressPostcode?: string }
export function addressPostcodeRefine(data: AddressFields, ctx: z.RefinementCtx) {
  if (data.addressPostcode && !/^\d{4}$/.test(data.addressPostcode)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['addressPostcode'], message: 'Postcode must be exactly 4 digits.' })
  }
}

type ContactMethodFields = { phone?: string; email?: string }
export function contactMethodRefine(data: ContactMethodFields, ctx: z.RefinementCtx) {
  if (data.phone && !/^\+?[\d\s\-()]{6,20}$/.test(data.phone)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone'], message: 'Please provide a valid phone number.' })
  }
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Please provide a valid email address.' })
  }
}

type ContactRoleRowFields = {
  personMode?: 'existing' | 'new'
  personId?: string
  newPersonFirstName?: string
  newPersonLastName?: string
  roleTypes?: string[]
  registeredProviderFlag?: boolean
}
type ContactRolesFields = { contactRoles?: ContactRoleRowFields[]; planType?: string }
export function contactRolesRefine(data: ContactRolesFields, ctx: z.RefinementCtx) {
  data.contactRoles?.forEach((row, index) => {
    if (row.personMode === 'existing' && !row.personId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contactRoles', index, 'personId'], message: 'Select a person.' })
    }
    if (row.personMode === 'new' && !row.newPersonFirstName?.trim() && !row.newPersonLastName?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contactRoles', index, 'newPersonFirstName'], message: "Provide the new person's name." })
    }
    if (row.roleTypes?.includes('ProviderContact')) {
      const gateError = contactRoleGateError('ProviderContact', data.planType as PlanType | undefined, undefined, row.registeredProviderFlag)
      if (gateError) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contactRoles', index, 'registeredProviderFlag'], message: gateError })
      }
    }
  })
}

/** The full-submit schema — every intake field, picked via the fieldsForEntry-derived name list. */
export const intakeParticipantSchema = baseParticipantSchema
  .pick(pickShape(INTAKE_FIELD_NAMES))
  .superRefine(fundingSourceRefine)
  .superRefine(livingArrangementRefine)
  .superRefine(addressPostcodeRefine)
  .superRefine(contactMethodRefine)
  .superRefine(contactRolesRefine)

// Sets a react-hook-form-shaped error at an arbitrary zod issue path — copied verbatim from
// ParticipantCreatePage.tsx (see that file for the fuller doc comment on why this exists instead
// of a flat `errors[field] = {...}`).
export function setPathError(errors: Record<string, unknown>, path: PropertyKey[], message: string, code: string) {
  let node: Record<PropertyKey, unknown> = errors
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (node[key] === undefined) node[key] = typeof path[i + 1] === 'number' ? [] : {}
    node = node[key] as Record<PropertyKey, unknown>
  }
  const last = path[path.length - 1]
  if (node[last] === undefined) node[last] = { type: code, message }
}

/**
 * @hookform/resolvers 3.x's zodResolver reads ZodError.errors (a getter zod v4 removed in favour
 * of .issues), so it throws past react-hook-form instead of populating formState.errors on
 * validation failure. Resolve directly against zod's safeParse/.issues API instead — same
 * hand-rolled-resolver workaround as ParticipantCreatePage.tsx's `participantResolver`.
 */
export const intakeParticipantResolver: Resolver<ParticipantFormData> = (values) => {
  const result = intakeParticipantSchema.safeParse(values)
  if (result.success) return { values: result.data, errors: {} }
  const errors: FieldErrors<ParticipantFormData> = {}
  for (const issue of result.error.issues) {
    setPathError(errors as Record<string, unknown>, issue.path, issue.message, issue.code)
  }
  return { values: {}, errors }
}

// ─────────────────────────────────────────────────────────────────────────────
// Intake wizard step field groups — re-grouped under PF-10.3's section headings. The UNION of
// these arrays must equal INTAKE_FIELD_NAMES exactly, with no field repeated — enforced by
// documentMapping.driftGuard.test.ts, not just asserted here in prose.
// ─────────────────────────────────────────────────────────────────────────────
export const STEP_PARTICIPANT_DETAILS_FIELDS = [
  'firstName', 'lastName', 'preferredName', 'dateOfBirth', 'phone', 'email',
  'addressStreet', 'addressSuburb', 'addressState', 'addressPostcode',
  'livingArrangement', 'mainSupportPersonName', 'mainSupportPersonRelationship',
  'othersLivingInAccommodation', 'residentialInfo', 'livesWithOthers', 'whoLivesWith',
  'silProviderName', 'silProviderContactPhone', 'accommodationType', 'onSiteSupportHours',
  'livingArrangementNotes',
] as const satisfies readonly (keyof ParticipantFormData)[]

export const STEP_NDIS_FUNDING_FIELDS = [
  'ndisNumber', 'planStartDate', 'planEndDate', 'planType', 'fundingSource', 'fundingOrganisation',
  'region', 'isRepeatClient', 'serviceStreams',
] as const satisfies readonly (keyof ParticipantFormData)[]

export const STEP_CONTACTS_FIELDS = ['contactRoles'] as const satisfies readonly (keyof ParticipantFormData)[]

export const STEP_CULTURAL_FIELDS = [
  'isCald', 'isLgbtqi', 'isFamilyCommunity', 'isAboriginalOrTorresStraitIslander',
  'receivedRightsAndResponsibilitiesInfo', 'receivedPrivacyAndConfidentialityInfo',
  'receivedFeedbackInfo', 'receivedBeingSafeInfo', 'receivedAdvocacyInfo',
] as const satisfies readonly (keyof ParticipantFormData)[]

export const STEP_SUPPORT_FIELDS = [
  'mobilityAidWheelchair', 'mobilityAidWalker', 'isHighSupport', 'isIntensiveSupport',
  'overnightSupport', 'overnightRatio',
  'requiresHiLoBed', 'requiresHoist', 'requiresShowerChair', 'requiresCommode', 'requiresStandingMachine',
  'supportRatio',
] as const satisfies readonly (keyof ParticipantFormData)[]

export const STEP_MEDICAL_FIELDS = ['medicalSummary', 'hidpaNotes'] as const satisfies readonly (keyof ParticipantFormData)[]

export const STEP_BEHAVIOUR_FIELDS = [
  'behavioursOfConcernCurrent', 'behavioursOfConcernFiveYearHistory', 'expressiveSkills',
] as const satisfies readonly (keyof ParticipantFormData)[]

export const STEP_RISKS_FIELDS = ['behaviourRiskSummary', 'notes', 'riskEntries'] as const satisfies readonly (keyof ParticipantFormData)[]

/** Per-step Next-validation schemas, keyed by step key — mirrors ParticipantCreatePage.tsx's
 * STEP_SCHEMAS_BY_KEY pattern, scoped to intake fields only. */
export const INTAKE_STEP_SCHEMAS_BY_KEY: Record<string, z.ZodTypeAny> = {
  participantDetails: baseParticipantSchema.pick(pickShape(STEP_PARTICIPANT_DETAILS_FIELDS))
    .superRefine(livingArrangementRefine).superRefine(addressPostcodeRefine).superRefine(contactMethodRefine),
  ndisFunding: baseParticipantSchema.pick(pickShape(STEP_NDIS_FUNDING_FIELDS)).superRefine(fundingSourceRefine),
  contacts: baseParticipantSchema.pick({ ...pickShape(STEP_CONTACTS_FIELDS), planType: true }).superRefine(contactRolesRefine),
  culturalConsiderations: baseParticipantSchema.pick(pickShape(STEP_CULTURAL_FIELDS)),
  support: baseParticipantSchema.pick(pickShape(STEP_SUPPORT_FIELDS)),
  medical: baseParticipantSchema.pick(pickShape(STEP_MEDICAL_FIELDS)),
  behaviour: baseParticipantSchema.pick(pickShape(STEP_BEHAVIOUR_FIELDS)),
  risks: baseParticipantSchema.pick(pickShape(STEP_RISKS_FIELDS)),
}

// ═════════════════════════════════════════════════════════════════════════════
// PF-10.4 (SPEC-05) — the Profile wizard's field set/steps/schemas. Same "reuse this one file"
// convention PF-10.3 established above for Intake — no second schema file.
// ═════════════════════════════════════════════════════════════════════════════

// weightHeightRefine/diagnosisOtherRefine — copied verbatim from ParticipantCreatePage.tsx (both
// target only entryPhase:'profile' fields: weightKg/heightCm are Key Identifiers; primaryDiagnosis/
// primaryDiagnosisOther are Medical Detail).
type WeightHeightFields = { weightKg?: number; heightCm?: number }
export function weightHeightRefine(data: WeightHeightFields, ctx: z.RefinementCtx) {
  if (data.weightKg && (data.weightKg <= 0 || data.weightKg > 999.99)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weightKg'], message: 'Weight must be greater than 0 and no more than 999.99 kg.' })
  }
  if (data.heightCm && (data.heightCm <= 0 || data.heightCm > 999.99)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['heightCm'], message: 'Height must be greater than 0 and no more than 999.99 cm.' })
  }
}

type DiagnosisFields = { primaryDiagnosis?: string; primaryDiagnosisOther?: string }
export function diagnosisOtherRefine(data: DiagnosisFields, ctx: z.RefinementCtx) {
  if (data.primaryDiagnosis === 'Other — specify' && !data.primaryDiagnosisOther?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['primaryDiagnosisOther'], message: 'Please specify the primary diagnosis.' })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PF-10.1's contract, applied to Profile: the wizard's field set IS fieldsForEntry('profile') —
// no hand-authored duplicate list. `primaryDiagnosisOther` is a UI-only helper field (the "Other —
// specify" typed value collapsed into `primaryDiagnosis` before submit, same convention as
// ParticipantCreatePage.tsx) — it has no DOCUMENT_MAPPING entry of its own (neither does its
// Intake-side counterpart), so it is deliberately excluded from PROFILE_FIELD_NAMES but still
// picked into profileParticipantSchema and included in the Medical Detail step's own field list.
// ─────────────────────────────────────────────────────────────────────────────
export const PROFILE_FIELD_NAMES = fieldsForEntry('profile').map((e) => e.field) as (keyof ParticipantFormData)[]

export const profileParticipantSchema = baseParticipantSchema
  .pick({ ...pickShape(PROFILE_FIELD_NAMES), primaryDiagnosisOther: true })
  .superRefine(weightHeightRefine)
  .superRefine(diagnosisOtherRefine)

/** Same hand-rolled-resolver workaround as intakeParticipantResolver above — used only by the
 * Profile wizard's final Review step (a full-payload PUT, see ProfileWizardPage.tsx). */
export const profileParticipantResolver: Resolver<ParticipantFormData> = (values) => {
  const result = profileParticipantSchema.safeParse(values)
  if (result.success) return { values: result.data, errors: {} }
  const errors: FieldErrors<ParticipantFormData> = {}
  for (const issue of result.error.issues) {
    setPathError(errors as Record<string, unknown>, issue.path, issue.message, issue.code)
  }
  return { values: {}, errors }
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile wizard step field groups. The UNION of these arrays, MINUS the one documented UI-only
// exception (primaryDiagnosisOther, Medical Detail), must equal PROFILE_FIELD_NAMES exactly, with
// no field repeated — enforced by ProfileWizardPage.test.tsx's "drift guard" describe block.
//
// Placement note (spec ambiguity, resolved — see this branch's report): SPEC-05's PF-10.4 prose
// names 8 sections but never says where the leftover Profile-entry Identity fields (middleName,
// gender, genderSelfDescription, placeOfBirth, country, preferredStaffId, isDsoa) live — every
// other Profile-entry field maps cleanly onto one of the 8 named sections, these 7 do not. They
// are folded into "Key Identifiers" (the closest existing "additional profile-only personal detail"
// home, and the only step that otherwise has no natural claimant for them) rather than inventing a
// 9th, unnamed step.
// ─────────────────────────────────────────────────────────────────────────────
export const PROFILE_STEP_KEY_IDENTIFIERS_FIELDS = [
  'middleName', 'gender', 'genderSelfDescription', 'placeOfBirth', 'country', 'preferredStaffId', 'isDsoa',
  'pensionCardNumber', 'pensionCardExpiry', 'medicareNumber', 'medicareExpiry',
  'companionCardNumber', 'companionCardExpiry', 'privateHealthFund', 'privateHealthMembershipNumber',
  'taxiCardNumber', 'hairColour', 'eyeColour', 'weightKg', 'heightCm',
] as const satisfies readonly (keyof ParticipantFormData)[]

/** "Cultural depth / Consents" per this branch's task brief — Personal Interests/Choice & Control
 * plus the full Consent & Terms block (ungated PhotoVideo/Privacy/EmergencyMedical always shown;
 * Alcohol/OtcMedication/TravelInsurance/TermsAndConditions gated on serviceStreams.includes('STA')
 * — see PROFILE_CONDITIONAL_SECTIONS below and the Cultural Depth step component). */
export const PROFILE_STEP_CULTURAL_DEPTH_FIELDS = [
  'personalInterests', 'choiceControlNotes', 'consents',
] as const satisfies readonly (keyof ParticipantFormData)[]

export const PROFILE_STEP_MEDICAL_FIELDS = [
  'primaryDiagnosis', 'primaryDiagnosisOther', 'otherDiagnoses', 'hidpaSupportCategories',
  'allergiesDetail', 'isAnaphylaxisRisk', 'allergyManagementNotes', 'healthConditions',
] as const satisfies readonly (keyof ParticipantFormData)[]

export const PROFILE_STEP_MOBILITY_FIELDS = [
  'mobilitySupportOptions', 'mobilityNotes', 'equipmentRequirements', 'transportRequirements',
  'ambulantStatus', 'fallsRiskRating', 'unevenGroundFlag', 'levelOfPersonalCare', 'orthotics',
  'continenceSupportDetail', 'bowelCareDetail', 'menstruationSupport', 'skinIntegrity',
] as const satisfies readonly (keyof ParticipantFormData)[]

export const PROFILE_STEP_BEHAVIOUR_FIELDS = [
  'memory', 'memoryAids', 'impairedUnderstanding', 'impairedJudgementReasoning',
  'behaviourRiskRating', 'ridsLogged', 'bspPlanProvided', 'bocChartProvided',
  'receptiveSkills', 'readingAbility', 'communicationAids',
] as const satisfies readonly (keyof ParticipantFormData)[]

export const PROFILE_STEP_DAILY_LIVING_FIELDS = [
  'adlAssessments',
  'mealAssistanceDetail', 'chokingRiskMealDetail', 'modifiedDietDetail', 'pegRegimeMealDetail',
  'specialUtensilsDetail', 'specialDietaryNeedsDetail',
  'favouriteBreakfast', 'favouriteLunch', 'favouriteDinner', 'medicationTricks', 'foodsAlwaysEaten',
  'goals', 'supportAreas', 'strengthsFears', 'thingsToKnow', 'whoIsImportant', 'likesDislikes',
] as const satisfies readonly (keyof ParticipantFormData)[]

/** CommunityAccessDailyLiving-gated (entire step) — see PROFILE_CONDITIONAL_SECTIONS below. */
export const PROFILE_STEP_COMMUNITY_ACCESS_FIELDS = [
  'signsHappyAndSettled', 'whatHelpsMeCalmDown', 'bocTriggers', 'bocEarlyWarningSigns',
  'bocDeEscalationStrategies', 'bocWhatNotToDo', 'checklistItems',
  'communityAccessRiskItems', 'overallCommunityAccessRiskRating',
  'supportsLookLikeMorning', 'supportsLookLikeDay', 'supportsLookLikeAfternoonEvening', 'supportsLookLikeOvernight',
] as const satisfies readonly (keyof ParticipantFormData)[]

/** Per-step Next-validation schemas, keyed by step key — mirrors INTAKE_STEP_SCHEMAS_BY_KEY above. */
export const PROFILE_STEP_SCHEMAS_BY_KEY: Record<string, z.ZodTypeAny> = {
  keyIdentifiers: baseParticipantSchema.pick(pickShape(PROFILE_STEP_KEY_IDENTIFIERS_FIELDS)).superRefine(weightHeightRefine),
  culturalDepth: baseParticipantSchema.pick(pickShape(PROFILE_STEP_CULTURAL_DEPTH_FIELDS)),
  medical: baseParticipantSchema.pick({ ...pickShape(PROFILE_STEP_MEDICAL_FIELDS), primaryDiagnosisOther: true }).superRefine(diagnosisOtherRefine),
  mobility: baseParticipantSchema.pick(pickShape(PROFILE_STEP_MOBILITY_FIELDS)),
  behaviourCognition: baseParticipantSchema.pick(pickShape(PROFILE_STEP_BEHAVIOUR_FIELDS)),
  dailyLiving: baseParticipantSchema.pick(pickShape(PROFILE_STEP_DAILY_LIVING_FIELDS)),
  communityAccess: baseParticipantSchema.pick(pickShape(PROFILE_STEP_COMMUNITY_ACCESS_FIELDS)),
}

/**
 * SPEC-05's PF-10.4 generic conditional-section shape — `{ key, label, fields, isVisible }` — used
 * for BOTH of the Profile wizard's independently-gated regions, not two special cases:
 *  - `communityAccess`: gates whether the whole Community Access STEP appears in the wizard's step
 *    list (ProfileWizardPage.tsx filters WIZARD_STEPS by this entry's `isVisible`).
 *  - `holidaySta`: gates a SUB-BLOCK within the Cultural Depth/Consents step (the Alcohol/
 *    OtcMedication/TravelInsurance/TermsAndConditions consent rows) — same shape, consumed by that
 *    step component to decide what to render AND by the save path to decide which consent types
 *    to include in the PATCH payload (see participantPatchGroups.ts's HOLIDAY_STA_CONSENT_TYPES).
 * A third future gate is a new entry here, not a new branch of conditional logic.
 */
export type ProfileConditionalSection = {
  key: string
  label: string
  fields: readonly (keyof ParticipantFormData)[]
  isVisible: (serviceStreams: readonly string[]) => boolean
}

export const PROFILE_CONDITIONAL_SECTIONS: ProfileConditionalSection[] = [
  {
    key: 'communityAccess',
    label: 'Community Access',
    fields: PROFILE_STEP_COMMUNITY_ACCESS_FIELDS,
    isVisible: (serviceStreams) => serviceStreams.includes('CommunityAccessDailyLiving'),
  },
  {
    key: 'holidaySta',
    label: 'Holiday / STA Consents',
    fields: ['consents'] as const satisfies readonly (keyof ParticipantFormData)[],
    isVisible: (serviceStreams) => serviceStreams.includes('STA'),
  },
]
