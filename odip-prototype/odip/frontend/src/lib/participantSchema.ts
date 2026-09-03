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
