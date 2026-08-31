import { useNavigate, useParams, Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, useFieldArray, useWatch, Controller, type Resolver, type FieldErrors, type Control, type FieldPath } from 'react-hook-form'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { z } from 'zod'
import type { AxiosError } from 'axios'
import { useCreateParticipant, useUpdateParticipant, useParticipant, useStaff, usePersons } from '@/api/hooks'
import { ArrowLeft, Check, Plus, Trash2 } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { ToggleGroup } from '@/components/ToggleGroup'
import { FormField, labelClass } from '@/components/FormField'
import { Card } from '@/components/Card'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { StatusBadge } from '@/components/StatusBadge'
import { OVERNIGHT_SUPPORT_TYPES, SUPPORT_RATIOS, SERVICE_STREAMS, GENDERS, FUNDING_SOURCES, LIVING_ARRANGEMENTS, AU_STATES, HIDPA_SUPPORT_CATEGORIES, AT_RISK_PARTIES, CONTACT_ROLE_TYPES, CONSENT_TYPES } from '@/api/types/enums'
import type { SupportRatio, OvernightSupportType, ServiceStream, Gender, FundingSource, LivingArrangement, HidpaSupportCategory, PlanType, ContactRoleType, ConsentType } from '@/api/types/enums'
import { CONTACT_ROLE_TYPE_LABELS, availableContactRoleTypes, contactRoleGateError } from '@/api/types/contacts'
import { CONSENT_TYPE_LABELS } from '@/api/types/consents'
import {
  MOBILITY_SUPPORT_OPTIONS, OVERNIGHT_SUPPORT_LABELS, OVERNIGHT_RATIO_LABELS, SERVICE_STREAM_LABELS,
  GENDER_LABELS, FUNDING_SOURCE_LABELS, LIVING_ARRANGEMENT_LABELS, parseServiceStreams, formatServiceStreams,
  DIAGNOSIS_OPTIONS, DIAGNOSIS_OTHER_SENTINEL, HIDPA_CATEGORY_LABELS, HIDPA_CATEGORY_TITLES,
  parseHidpaCategories, formatHidpaCategories,
} from '@/api/types/participants'
import { AT_RISK_PARTY_LABELS } from '@/api/types/risk-entries'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import {
  useConditionalFields, useUnregisterHiddenFields, useFocusFallbackOnHide, stripHiddenFieldKeys,
  useDeriveFieldValues,
  type ConditionalFieldDef, type ConditionPredicate, type FieldDerivationDef,
} from '@/lib/conditionalFields'

const baseParticipantSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  preferredName: z.string().optional(),
  // INTAKE sub-wave A, PID-004.
  middleName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  genderSelfDescription: z.string().optional(),
  // INTAKE sub-wave A — Participant Details additions (research spec §5). placeOfBirth/country
  // are free text; phone/email are the participant's OWN contact methods (previously the
  // Participant had none — every phone/email elsewhere in this codebase belongs to a Contact/
  // Person row instead). Format checked by phoneEmailRefine below, only when non-blank.
  placeOfBirth: z.string().optional(),
  country: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  // INTAKE-06 — structured address. Lives on the Identity step (see the wizard-placement note
  // above CONDITIONAL_FIELDS below): a participant's address doesn't depend on funding/support
  // answers, so it sits with the other core-identity fields rather than opening a dedicated step.
  addressStreet: z.string().optional(),
  addressSuburb: z.string().optional(),
  addressState: z.string().optional(),
  addressPostcode: z.string().optional(),
  // LIVING-01/02/03/04. Required-ness of the per-arrangement fields is enforced by
  // livingArrangementRefine below, not by the base shape (each field is only relevant, and only
  // rendered, when the matching arrangement type is selected — see CONDITIONAL_FIELDS).
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
  // Required only when fundingSource is Ndis (see fundingSourceRefine) — hidden+excluded
  // entirely when Other, so it must not be unconditionally required here.
  planType: z.string().optional(),
  region: z.string().optional(),
  fundingSource: z.string().min(1),
  // Required only when fundingSource is Other (see fundingSourceRefine) — hidden+excluded
  // entirely when Ndis.
  fundingOrganisation: z.string().optional(),
  // INTAKE sub-wave A, NDIS-006 — Disability Support for Older Australians.
  isDsoa: z.boolean().optional(),
  isRepeatClient: z.boolean().optional(),
  serviceStreams: z.array(z.string()).optional(),
  mobilityAidWheelchair: z.boolean().optional(),
  mobilityAidWalker: z.boolean().optional(),
  mobilitySupportOptions: z.array(z.string()).optional(),
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
  mobilityNotes: z.string().optional(),
  equipmentRequirements: z.string().optional(),
  transportRequirements: z.string().optional(),
  // DIAG-01. primaryDiagnosis holds either a curated DIAGNOSIS_OPTIONS value or the
  // DIAGNOSIS_OTHER_SENTINEL — required-ness of primaryDiagnosisOther (the "Other — specify"
  // typed value) is enforced by diagnosisOtherRefine below, not the base shape, since it's only
  // relevant when the sentinel is selected (see CONDITIONAL_FIELDS). Collapsed to a single
  // primaryDiagnosis string before submit — see onSubmit.
  primaryDiagnosis: z.string().optional(),
  primaryDiagnosisOther: z.string().optional(),
  otherDiagnoses: z.array(z.string()).optional(),
  // DIAG-02. hidpaSupportCategories mirrors serviceStreams' array-of-flag-names shape/handling.
  hidpaSupportCategories: z.array(z.string()).optional(),
  medicalSummary: z.string().optional(),
  behaviourRiskSummary: z.string().optional(),
  notes: z.string().optional(),
  preferredStaffId: z.string().optional().nullable(),
  // INTAKE-09. Repeatable risk-entry rows — create-mode only (see riskEntryFields' guard below);
  // each row's description is required, but the collection as a whole is optional (zero rows is
  // fine). Submitted alongside a new participant only; edit-mode instead manages risk entries via
  // the nested CRUD (see the participant detail page's Risks section).
  riskEntries: z.array(z.object({
    atRiskParty: z.string().min(1),
    description: z.string().min(1, 'Description is required'),
    mitigationNotes: z.string().optional(),
  })).optional(),
  // CONTACT-02. Repeatable contact-role rows — create-mode only (same shape/reasoning as
  // riskEntries above): rows entered here are created transactionally with the participant
  // (CreateParticipantDto.contactRoles, via buildPayload's mapping to the full DTO shape below).
  // Edit-mode instead manages contacts via the nested CRUD (the detail page's Contacts tab), so
  // this field is never populated from `existing` on reset. Deliberately a lean field set — the
  // richer per-role-type fields (guardian order scope, nominee scope, etc.) are only editable
  // from the Contacts tab after the participant is saved.
  contactRoles: z.array(z.object({
    personMode: z.enum(['existing', 'new']),
    personId: z.string().optional(),
    newPersonFirstName: z.string().optional(),
    newPersonLastName: z.string().optional(),
    roleType: z.string().min(1, 'Role type is required'),
    relationshipToParticipant: z.string().optional(),
    isPrimary: z.boolean().optional(),
  })).optional(),
  // INTAKE sub-wave A — "Key Identifiers" wizard step (research spec §4.4/§5). All optional;
  // expiries are plain date strings (YYYY-MM-DD, same shape as planStartDate/planEndDate above).
  // weightKg/heightCm use z.coerce.number() — same convention as AccommodationCreatePage's
  // bedroomCount/bedCount/maxCapacity — since a native number input still hands react-hook-form
  // a string; buildPayload treats a coerced 0 (an empty input) as null, same as that page does.
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
  // INTAKE sub-wave B — "Cultural & Consent" wizard step (research spec §4.5/§5). Every flag is
  // tri-state (Yes/No/not-yet-answered) to match the backend's nullable bool — represented here
  // as a string ('true' | 'false' | '' for unanswered) rather than z.boolean(), the same
  // tri-state-as-string shape as each consents[].granted row below, so both render through the
  // same YesNoToggleField helper. Collapsed to boolean|null in buildPayload before submit.
  isCald: z.enum(['true', 'false', '']).optional(),
  isLgbtqi: z.enum(['true', 'false', '']).optional(),
  isFamilyCommunity: z.enum(['true', 'false', '']).optional(),
  isAboriginalOrTorresStraitIslander: z.enum(['true', 'false', '']).optional(),
  receivedRightsAndResponsibilitiesInfo: z.enum(['true', 'false', '']).optional(),
  receivedPrivacyAndConfidentialityInfo: z.enum(['true', 'false', '']).optional(),
  receivedFeedbackInfo: z.enum(['true', 'false', '']).optional(),
  receivedBeingSafeInfo: z.enum(['true', 'false', '']).optional(),
  receivedAdvocacyInfo: z.enum(['true', 'false', '']).optional(),
  personalInterests: z.string().optional(),
  choiceControlNotes: z.string().optional(),
  // Fixed 7-row array (one per ConsentType, never user-add/remove — unlike riskEntries/
  // contactRoles) — always all 7 rows, submitted on both create and edit saves (see
  // CreateParticipantDto.consents' backend doc for why this differs from riskEntries/
  // contactRoles' create-mode-only convention).
  consents: z.array(z.object({
    consentType: z.string(),
    granted: z.enum(['true', 'false', '']).optional(),
    signedByName: z.string().optional(),
    signedDate: z.string().optional(),
  })).optional(),
})

type ParticipantFormData = z.infer<typeof baseParticipantSchema>

// Cross-field check shared by the full-schema (final submit) and the "Support Needs &
// Equipment" step schema (Next validation) — kept as a standalone function, rather than
// inline in .superRefine(), so both schemas can apply the exact same rule.
type EquipmentFields = {
  requiresHiLoBed?: boolean
  requiresHoist?: boolean
  requiresShowerChair?: boolean
  requiresCommode?: boolean
  requiresStandingMachine?: boolean
  equipmentRequirements?: string
}
// Equipment-notes gating (the notes field stays visible but disabled/read-only until an
// equipment item is ticked) is a visible-but-disabled pattern, not a hide — it intentionally
// stays outside the INTAKE-07 conditional-visibility engine (see src/lib/conditionalFields.ts's
// module doc for why), but expresses its predicate with the engine's own ConditionPredicate type
// for a shared vocabulary between the two.
const equipmentEnabledPredicate: ConditionPredicate<EquipmentFields> = (data) => !!(
  data.requiresHiLoBed
  || data.requiresHoist
  || data.requiresShowerChair
  || data.requiresCommode
  || data.requiresStandingMachine
)
function equipmentRefine(data: EquipmentFields, ctx: z.RefinementCtx) {
  if (data.equipmentRequirements && data.equipmentRequirements.trim() !== '' && !equipmentEnabledPredicate(data)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['equipmentRequirements'],
      message: 'Select an equipment item, or clear these notes.',
    })
  }
}

// INTAKE-05: Gender "Other" requires the self-description free-text field — same
// standalone-function pattern as equipmentRefine, shared by the full schema and the Identity
// step schema.
type GenderFields = { gender?: string; genderSelfDescription?: string }
function genderRefine(data: GenderFields, ctx: z.RefinementCtx) {
  if (data.gender === 'Other' && !data.genderSelfDescription?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['genderSelfDescription'],
      message: 'Please provide a gender self-description.',
    })
  }
}

// FUND-02: FundingSource "Other" requires the reused FundingOrganisation "specify" field;
// FundingSource "Ndis" requires PlanType (the field the NDIS plan fields step has always
// required, now conditional since it's hidden+excluded when Other). Same standalone-function
// pattern as genderRefine/equipmentRefine.
type FundingFields = { fundingSource?: string; fundingOrganisation?: string; planType?: string }
function fundingSourceRefine(data: FundingFields, ctx: z.RefinementCtx) {
  if (data.fundingSource === 'Other' && !data.fundingOrganisation?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fundingOrganisation'],
      message: 'Please specify the funding organisation.',
    })
  }
  if (data.fundingSource === 'Ndis' && !data.planType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['planType'],
      message: 'Plan type is required.',
    })
  }
}

// LIVING-01/02/03/04: each arrangement type requires its one key identifying field, both ends —
// same shape as genderRefine/fundingSourceRefine. Independent's whoLivesWith is only required
// when livesWithOthers is true (a second level of conditionality nested inside the
// arrangement-type gate); mirrors the backend's ValidateLivingArrangement.
type LivingFields = {
  livingArrangement?: string
  mainSupportPersonName?: string
  livesWithOthers?: boolean
  whoLivesWith?: string
  silProviderName?: string
}
function livingArrangementRefine(data: LivingFields, ctx: z.RefinementCtx) {
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

// INTAKE-06: AU postcode is exactly 4 digits when supplied (optional field, so blank is fine) —
// mirrors the backend's ValidateAddressPostcode.
type AddressFields = { addressPostcode?: string }
function addressPostcodeRefine(data: AddressFields, ctx: z.RefinementCtx) {
  if (data.addressPostcode && !/^\d{4}$/.test(data.addressPostcode)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['addressPostcode'], message: 'Postcode must be exactly 4 digits.' })
  }
}

// INTAKE sub-wave A: the participant's own Phone/Email — AU-tolerant, non-strict format checks,
// same "optional field, blank is fine" shape as addressPostcodeRefine, mirroring the backend's
// ParticipantsController.ValidatePhone/ValidateEmail exactly (same regexes).
type ContactMethodFields = { phone?: string; email?: string }
function contactMethodRefine(data: ContactMethodFields, ctx: z.RefinementCtx) {
  if (data.phone && !/^\+?[\d\s\-()]{6,20}$/.test(data.phone)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone'], message: 'Please provide a valid phone number.' })
  }
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Please provide a valid email address.' })
  }
}

// INTAKE sub-wave A polish round: WeightKg/HeightCm are numeric(5,2) columns server-side — mirror
// ParticipantsController.ValidateWeight/ValidateHeight's bounds (0 < value <= 999.99) exactly so a
// full submit blocks with a message instead of only failing at the server. A blank input coerces
// to 0 via z.coerce.number() (see weightKg/heightCm's schema doc) — treated as "not provided" here
// too, same as buildPayload's numField loop, so leaving the field empty is never itself an error.
type WeightHeightFields = { weightKg?: number; heightCm?: number }
function weightHeightRefine(data: WeightHeightFields, ctx: z.RefinementCtx) {
  if (data.weightKg && (data.weightKg <= 0 || data.weightKg > 999.99)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weightKg'], message: 'Weight must be greater than 0 and no more than 999.99 kg.' })
  }
  if (data.heightCm && (data.heightCm <= 0 || data.heightCm > 999.99)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['heightCm'], message: 'Height must be greater than 0 and no more than 999.99 cm.' })
  }
}

// DIAG-01: primaryDiagnosis "Other — specify" requires the typed free-text field — same
// standalone-function pattern as genderRefine/fundingSourceRefine.
type DiagnosisFields = { primaryDiagnosis?: string; primaryDiagnosisOther?: string }
function diagnosisOtherRefine(data: DiagnosisFields, ctx: z.RefinementCtx) {
  if (data.primaryDiagnosis === DIAGNOSIS_OTHER_SENTINEL && !data.primaryDiagnosisOther?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['primaryDiagnosisOther'], message: 'Please specify the primary diagnosis.' })
  }
}

// CONTACT-02/03: each contact-role row needs either an existing person selected or a new
// person's name typed — same standalone-function pattern as the refines above, but per-row
// (array index in the issue path) rather than a single top-level field, mirroring how
// riskEntries' row-level errors are handled (see setPathError's doc below).
type ContactRoleRowFields = { personMode?: 'existing' | 'new'; personId?: string; newPersonFirstName?: string; newPersonLastName?: string }
type ContactRolesFields = { contactRoles?: ContactRoleRowFields[] }
function contactRolesRefine(data: ContactRolesFields, ctx: z.RefinementCtx) {
  data.contactRoles?.forEach((row, index) => {
    if (row.personMode === 'existing' && !row.personId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contactRoles', index, 'personId'], message: 'Select a person.' })
    }
    if (row.personMode === 'new' && !row.newPersonFirstName?.trim() && !row.newPersonLastName?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contactRoles', index, 'newPersonFirstName'], message: "Provide the new person's name." })
    }
  })
}

const participantSchema = baseParticipantSchema
  .superRefine(equipmentRefine)
  .superRefine(genderRefine)
  .superRefine(fundingSourceRefine)
  .superRefine(livingArrangementRefine)
  .superRefine(addressPostcodeRefine)
  .superRefine(contactMethodRefine)
  .superRefine(weightHeightRefine)
  .superRefine(diagnosisOtherRefine)
  .superRefine(contactRolesRefine)

// Sets a react-hook-form-shaped error at an arbitrary zod issue path (e.g.
// ['riskEntries', 0, 'description']), building the intermediate array/object nodes as it goes —
// react-hook-form's FieldErrors tree already expects exactly this nested array-of-objects shape
// for a useFieldArray-backed field, so no flattening is needed for a row-level error (e.g.
// errors.riskEntries?.[0]?.description) to reach the row that owns it. A single-segment path
// (every pre-existing field) degenerates to the old flat `errors[field] = {...}` behaviour.
function setPathError(errors: Record<string, unknown>, path: PropertyKey[], message: string, code: string) {
  let node: Record<PropertyKey, unknown> = errors
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (node[key] === undefined) node[key] = typeof path[i + 1] === 'number' ? [] : {}
    node = node[key] as Record<PropertyKey, unknown>
  }
  const last = path[path.length - 1]
  if (node[last] === undefined) node[last] = { type: code, message }
}

// @hookform/resolvers 3.x's zodResolver reads ZodError.errors (a getter zod v4 removed in
// favour of .issues), so it throws past react-hook-form instead of populating
// formState.errors on validation failure. Resolve directly against zod's safeParse/.issues
// API instead of routing through that resolver.
const participantResolver: Resolver<ParticipantFormData> = (values) => {
  const result = participantSchema.safeParse(values)
  if (result.success) return { values: result.data, errors: {} }
  const errors: FieldErrors<ParticipantFormData> = {}
  for (const issue of result.error.issues) {
    setPathError(errors as Record<string, unknown>, issue.path, issue.message, issue.code)
  }
  return { values: {}, errors }
}

function pickShape<T extends readonly (keyof ParticipantFormData)[]>(fields: T) {
  return Object.fromEntries(fields.map((f) => [f, true])) as { [K in T[number]]: true }
}

// Same shape as RiskEntriesSection's extractErrorMessage — surfaces the server's ApiResponse
// error message (e.g. ValidateNames' "Provide at least a first or last name...") for the
// Save-as-draft banner rather than a generic string.
function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

function focusField(fieldName: string) {
  const el = document.getElementById(fieldName)
  if (el instanceof HTMLElement) el.focus()
}

/** Review-step display helper for a tri-state ('true' | 'false' | '' | undefined) field. */
function yesNoUnknown(value: string | undefined): string {
  return value === 'true' ? 'Yes' : value === 'false' ? 'No' : 'Not recorded'
}

/** boolean|null (the wire shape) -> the wizard's tri-state string shape, for reset()'s round-trip. */
function boolToTriState(value: boolean | null | undefined): 'true' | 'false' | '' {
  return value === true ? 'true' : value === false ? 'false' : ''
}

/** The tri-state string shape -> boolean|null (the wire shape), for buildPayload. */
function triStateToBool(value: string | undefined): boolean | null {
  return value === 'true' ? true : value === 'false' ? false : null
}

/**
 * INTAKE sub-wave B — a Yes/No ToggleGroup bound to a tri-state string field via Controller,
 * shared by the 9 cultural/rights flags and each of the 7 consent rows' `granted` field. An
 * unmatched value (the '' unanswered state) leaves both ToggleGroup options unselected, per
 * ToggleGroup's own "no match" behaviour — exactly the "not yet answered" visual this tri-state
 * needs, with no third explicit button.
 */
// Three explicit options, not two: an honest bool? control must be able to go back to "not
// recorded" after being answered, not just toggle between Yes and No — on a compliance record
// (consents especially), "I don't know what to put so I'll leave it on whatever it last said" is
// a real data-entry-error trap. Shared by every tri-state field so the affordance is consistent
// everywhere it appears (review-round polish).
const YES_NO_UNANSWERED_OPTIONS = [
  { key: 'true', label: 'Yes' },
  { key: 'false', label: 'No' },
  { key: '', label: 'Not recorded' },
]

function YesNoToggleField({ control, name, label, hint }: {
  control: Control<ParticipantFormData>
  name: FieldPath<ParticipantFormData>
  label: string
  hint?: string
}) {
  return (
    <FormField label={label} hint={hint} className="mb-0">
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <ToggleGroup
            options={YES_NO_UNANSWERED_OPTIONS}
            value={(field.value as string) ?? ''}
            onChange={field.onChange}
            // FormField's cloneElement labelling can't reach through this Controller (see
            // ToggleGroup.tsx's ariaLabel doc) — pass the field's own label through explicitly so
            // the radiogroup has a real accessible name instead of none at all.
            ariaLabel={label}
          />
        )}
      />
    </FormField>
  )
}

// Living arrangements (LIVING-01..04) and address (INTAKE-06) live on the Identity step rather
// than a new wizard step or the Support Needs step: neither depends on funding/support-need
// answers, and where/how a participant lives is core identity/intake context — putting them here
// avoids inserting a step, which would renumber every later step and break every test that
// assumes the current step order (see the Wave-3 report for the fuller reasoning).
const STEP_IDENTITY_FIELDS = [
  'firstName', 'lastName', 'preferredName', 'middleName', 'dateOfBirth', 'gender', 'genderSelfDescription', 'preferredStaffId',
  // INTAKE sub-wave A — Participant Details additions (research spec §5).
  'placeOfBirth', 'country', 'phone', 'email',
  'addressStreet', 'addressSuburb', 'addressState', 'addressPostcode',
  'livingArrangement', 'mainSupportPersonName', 'mainSupportPersonRelationship', 'othersLivingInAccommodation', 'residentialInfo',
  'livesWithOthers', 'whoLivesWith',
  'silProviderName', 'silProviderContactPhone', 'accommodationType', 'onSiteSupportHours',
  'livingArrangementNotes',
] as const
const STEP_NDIS_FIELDS = ['ndisNumber', 'planStartDate', 'planEndDate', 'planType', 'region', 'fundingSource', 'fundingOrganisation', 'isDsoa', 'isRepeatClient', 'serviceStreams'] as const
// INTAKE sub-wave A — new "Key Identifiers" step (research spec §4.4/§5), placed after "NDIS &
// Funding" and before "Contacts" (the spec's placement instruction: "after NDIS & Funding,
// before whatever follows" — Contacts was, and remains, the next step). All fields optional.
const STEP_KEY_IDENTIFIERS_FIELDS = [
  'pensionCardNumber', 'pensionCardExpiry', 'medicareNumber', 'medicareExpiry',
  'companionCardNumber', 'companionCardExpiry', 'privateHealthFund', 'privateHealthMembershipNumber',
  'taxiCardNumber', 'hairColour', 'eyeColour', 'weightKg', 'heightCm',
] as const
// CONTACT-02: the Contacts step sits immediately after NDIS & Funding (now, after Key
// Identifiers too) — available role types depend on funding/plan-type answers (and, for Plan
// Nominee, the participant's date of birth captured on the Identity step), so it must come after
// NDIS & Funding regardless of what else sits between them.
const STEP_CONTACTS_FIELDS = ['contactRoles'] as const
// INTAKE sub-wave B — "Cultural & Consent" step (research spec §4.5/§5), placed immediately
// after Contacts per this PR's brief. All fields optional — draft-save must work with any subset
// filled, same doctrine as every other wizard step.
const STEP_CULTURAL_CONSENT_FIELDS = [
  'isCald', 'isLgbtqi', 'isFamilyCommunity', 'isAboriginalOrTorresStraitIslander',
  'receivedRightsAndResponsibilitiesInfo', 'receivedPrivacyAndConfidentialityInfo',
  'receivedFeedbackInfo', 'receivedBeingSafeInfo', 'receivedAdvocacyInfo',
  'personalInterests', 'choiceControlNotes', 'consents',
] as const
const STEP_SUPPORT_FIELDS = [
  'isHighSupport', 'isIntensiveSupport', 'supportRatio',
  'mobilityAidWheelchair', 'mobilityAidWalker', 'mobilitySupportOptions',
  'overnightSupport', 'overnightRatio',
  'requiresHiLoBed', 'requiresHoist', 'requiresShowerChair', 'requiresCommode', 'requiresStandingMachine',
  'mobilityNotes', 'equipmentRequirements', 'transportRequirements',
] as const
// DIAG-01/02: diagnoses (primary + other), then HIDPA directly below them (a direct derivation —
// see the epilepsy rule — so they must share this step/schema), then the pre-existing free-text
// summary last as overflow for anything the structured fields don't capture. See the HIDPA
// research note on wizard placement for the fuller reasoning against opening a new step.
const STEP_MEDICAL_FIELDS = ['primaryDiagnosis', 'primaryDiagnosisOther', 'otherDiagnoses', 'hidpaSupportCategories', 'medicalSummary'] as const
const STEP_RISK_FIELDS = ['behaviourRiskSummary', 'notes', 'riskEntries'] as const
const STEP_REVIEW_FIELDS = [] as const

type WizardStep = {
  key: string
  label: string
  fields: readonly (keyof ParticipantFormData)[]
}

const WIZARD_STEPS: WizardStep[] = [
  { key: 'identity', label: 'Identity', fields: STEP_IDENTITY_FIELDS },
  { key: 'ndis', label: 'NDIS & Funding', fields: STEP_NDIS_FIELDS },
  // INTAKE sub-wave A — see STEP_KEY_IDENTIFIERS_FIELDS's doc comment above for placement.
  { key: 'keyIdentifiers', label: 'Key Identifiers', fields: STEP_KEY_IDENTIFIERS_FIELDS },
  // CONTACT-02: moved after NDIS & Funding (was folded into the Identity step's label before
  // CONTACT-01/02/03 existed) — see STEP_CONTACTS_FIELDS's doc comment above.
  { key: 'contacts', label: 'Contacts', fields: STEP_CONTACTS_FIELDS },
  // INTAKE sub-wave B — see STEP_CULTURAL_CONSENT_FIELDS's doc comment above for placement.
  { key: 'culturalConsent', label: 'Cultural & Consent', fields: STEP_CULTURAL_CONSENT_FIELDS },
  { key: 'support', label: 'Support Needs & Equipment', fields: STEP_SUPPORT_FIELDS },
  { key: 'medical', label: 'Medical', fields: STEP_MEDICAL_FIELDS },
  // INTAKE sub-wave B: renamed from "Risks & Consents" — consent content now has its own step
  // (this one carried none to begin with: just Behaviour Risk Summary/General Notes/INTAKE-09
  // risk entries, nothing consent-shaped), so the two step names no longer overlap.
  { key: 'risks', label: 'Risks & Hazards', fields: STEP_RISK_FIELDS },
  { key: 'review', label: 'Review', fields: STEP_REVIEW_FIELDS },
]
const REVIEW_STEP_INDEX = WIZARD_STEPS.length - 1

// Per-step schemas driving "Next" validation — derived from the same base schema/refine
// used by the final-submit resolver above, via zod's .pick(), so a step only ever validates
// the fields it owns. The Review step (index REVIEW_STEP_INDEX) has no schema — it has no
// inputs of its own, so there is nothing to validate before landing on it besides the
// preceding step.
const STEP_SCHEMAS: (z.ZodTypeAny | null)[] = [
  baseParticipantSchema.pick(pickShape(STEP_IDENTITY_FIELDS)).superRefine(genderRefine).superRefine(livingArrangementRefine).superRefine(addressPostcodeRefine).superRefine(contactMethodRefine),
  baseParticipantSchema.pick(pickShape(STEP_NDIS_FIELDS)).superRefine(fundingSourceRefine),
  // INTAKE sub-wave A — Key Identifiers: every field optional except the weight/height bounds.
  baseParticipantSchema.pick(pickShape(STEP_KEY_IDENTIFIERS_FIELDS)).superRefine(weightHeightRefine),
  baseParticipantSchema.pick(pickShape(STEP_CONTACTS_FIELDS)).superRefine(contactRolesRefine),
  // INTAKE sub-wave B — every field optional, no cross-field requirement.
  baseParticipantSchema.pick(pickShape(STEP_CULTURAL_CONSENT_FIELDS)),
  baseParticipantSchema.pick(pickShape(STEP_SUPPORT_FIELDS)).superRefine(equipmentRefine),
  baseParticipantSchema.pick(pickShape(STEP_MEDICAL_FIELDS)).superRefine(diagnosisOtherRefine),
  baseParticipantSchema.pick(pickShape(STEP_RISK_FIELDS)),
  null,
]

const PLAN_TYPE_LABELS: Record<string, string> = {
  SelfManaged: 'Self Managed',
  PlanManaged: 'Plan Managed',
  AgencyManaged: 'Agency Managed',
}

// INTAKE-07 conditional-visibility declarations for this wizard — see
// src/lib/conditionalFields.ts's module doc for the engine's full API. Two consumers today:
// gender self-description (migrated ad-hoc conditional, INTAKE-05) and FUND-02's funding-source
// gating (the first "real" consumer this capability was built for). Later waves (diagnoses
// gating, living arrangements, service-specific fields) extend this same array.
const CONDITIONAL_FIELDS: ConditionalFieldDef<ParticipantFormData>[] = [
  {
    fields: ['genderSelfDescription'],
    visibleWhen: (v) => v.gender === 'Other',
    focusFallback: 'gender',
  },
  {
    // FUND-02: "Other" reveals the reused free-text specify field...
    fields: ['fundingOrganisation'],
    visibleWhen: (v) => v.fundingSource === 'Other',
    focusFallback: 'fundingSource',
  },
  {
    // ...and hides the NDIS-specific plan fields — "subsequent form content changing per
    // source" per the FUND-02 backlog text. Grouped as one unit since they're all gated by
    // the exact same answer.
    fields: ['ndisNumber', 'planStartDate', 'planEndDate', 'planType'],
    visibleWhen: (v) => v.fundingSource !== 'Other',
    focusFallback: 'fundingSource',
  },
  {
    // LIVING-02 (Family arrangement fields).
    fields: ['mainSupportPersonName', 'mainSupportPersonRelationship', 'othersLivingInAccommodation', 'residentialInfo'],
    visibleWhen: (v) => v.livingArrangement === 'Family',
    focusFallback: 'livingArrangement',
  },
  {
    // LIVING-03 (Independent arrangement) — the "lives with others" toggle itself.
    fields: ['livesWithOthers'],
    visibleWhen: (v) => v.livingArrangement === 'Independent',
    focusFallback: 'livingArrangement',
  },
  {
    // LIVING-03 — "who" is a second level of conditionality nested inside the arrangement gate:
    // only shown once the participant is Independent AND said they live with others.
    fields: ['whoLivesWith'],
    visibleWhen: (v) => v.livingArrangement === 'Independent' && !!v.livesWithOthers,
    focusFallback: 'livesWithOthers',
  },
  {
    // LIVING-04 (Supported Accommodation fields) — controller ruling, since the backlog's
    // source bullet was empty.
    fields: ['silProviderName', 'silProviderContactPhone', 'accommodationType', 'onSiteSupportHours'],
    visibleWhen: (v) => v.livingArrangement === 'SupportedAccommodation',
    focusFallback: 'livingArrangement',
  },
  {
    // LIVING-01's one genuinely shared field: modelled ONCE and shown for whichever arrangement
    // is selected, rather than duplicated per arrangement type (mirrors INTAKE-04's
    // de-duplication principle). Deliberately a single def unioning all three arrangement types
    // — see conditionalFields.ts's multi-def pitfall warning for why listing the same field name
    // in three separate per-arrangement defs would be wrong (AND-visibility across defs means it
    // would only ever show when every def's predicate is true simultaneously, i.e. never, for a
    // single-select field).
    fields: ['livingArrangementNotes'],
    visibleWhen: (v) => v.livingArrangement === 'Family' || v.livingArrangement === 'Independent' || v.livingArrangement === 'SupportedAccommodation',
    focusFallback: 'livingArrangement',
  },
  {
    // DIAG-01: "Other — specify" reveals the typed free-text field, same shape as
    // genderSelfDescription/fundingOrganisation above.
    fields: ['primaryDiagnosisOther'],
    visibleWhen: (v) => v.primaryDiagnosis === DIAGNOSIS_OTHER_SENTINEL,
    focusFallback: 'primaryDiagnosis',
  },
]

// DIAG-02: the epilepsy -> epilepsy-management HIDPA default, implemented via conditionalFields.ts's
// useDeriveFieldValues (see that module's VALUE DERIVATION doc for the full transition-only/
// user-override/edit-mode-safe semantics this relies on). Fires when primaryDiagnosis or any
// otherDiagnoses entry equals the curated "Epilepsy" value — matches on that exact string
// regardless of whether it arrived via the curated dropdown/checkboxes or (in principle) a custom
// "Epilepsy"-spelled other-diagnosis entry.
const FIELD_DERIVATIONS: FieldDerivationDef<ParticipantFormData>[] = [
  {
    when: (v) => v.primaryDiagnosis === 'Epilepsy' || !!v.otherDiagnoses?.includes('Epilepsy'),
    apply: (v, setValue) => {
      const current = (v.hidpaSupportCategories ?? []) as string[]
      if (!current.includes('EpilepsyManagement')) {
        setValue('hidpaSupportCategories', [...current, 'EpilepsyManagement'], { shouldDirty: true })
      }
    },
  },
]

export default function ParticipantCreatePage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = !!id
  const createParticipant = useCreateParticipant()
  const updateParticipant = useUpdateParticipant()
  const { data: existing, isLoading: isLoadingExisting } = useParticipant(isEdit ? id : undefined)
  const { data: staffList = [] } = useStaff()
  const activeStaff = staffList.filter(s => s.isActive)
  const mutation = isEdit ? updateParticipant : createParticipant

  const { register, handleSubmit, reset, control, setValue, getValues, setError, clearErrors, unregister, formState: { errors, isDirty } } = useForm<ParticipantFormData>({
    resolver: participantResolver,
    defaultValues: {
      genderSelfDescription: '',
      livingArrangement: '',
      livesWithOthers: false,
      fundingSource: 'Ndis',
      isDsoa: false,
      planType: 'SelfManaged',
      supportRatio: 'SharedSupport',
      isRepeatClient: false,
      serviceStreams: [],
      mobilityAidWheelchair: false,
      mobilityAidWalker: false,
      mobilitySupportOptions: [],
      primaryDiagnosis: '',
      primaryDiagnosisOther: '',
      otherDiagnoses: [],
      hidpaSupportCategories: [],
      isHighSupport: false,
      isIntensiveSupport: false,
      overnightSupport: 'None',
      overnightRatio: 'OneToOne',
      requiresHiLoBed: false,
      requiresHoist: false,
      requiresShowerChair: false,
      requiresCommode: false,
      requiresStandingMachine: false,
      preferredStaffId: null,
      riskEntries: [],
      contactRoles: [],
      // INTAKE sub-wave B — fixed 7-row array, one per ConsentType, all unanswered by default.
      consents: CONSENT_TYPES.map((type) => ({ consentType: type, granted: '' as const, signedByName: '', signedDate: '' })),
    },
  })
  // INTAKE-09: create-mode-only repeatable risk-entry rows — see riskEntries' schema doc above.
  const { fields: riskEntryFields, append: appendRiskEntry, remove: removeRiskEntry } = useFieldArray({ control, name: 'riskEntries' })
  // CONTACT-02: create-mode-only repeatable contact-role rows — see contactRoles' schema doc above.
  const { fields: contactRoleFields, append: appendContactRole, remove: removeContactRole } = useFieldArray({ control, name: 'contactRoles' })
  const { data: people = [] } = usePersons()

  // Edit mode loads an already-complete record — every step is immediately explorable rather
  // than gated behind a linear Next walk, which only makes sense for a blank intake form.
  const [stepIndex, setStepIndex] = useState(0)
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(
    () => new Set(isEdit ? WIZARD_STEPS.map((_, i) => i) : [0])
  )
  // Field to focus once the DOM for its step has (re-)rendered. A fresh object each request
  // (rather than the field name alone) guarantees the effect below re-fires even when the
  // same field is re-requested twice in a row; the effect only reads it, it never needs to
  // clear it back out via setState.
  //
  // Deliberately depends on `focusRequest` ONLY, not `stepIndex`: a plain step change (Back,
  // or clicking a step pill) never creates a new focusRequest object, so it must not re-run
  // this effect — otherwise a stale request from an earlier failure would silently re-steal
  // focus on every later, unrelated visit to that step. When a request IS created together
  // with a step change (handleNext / handleInvalidSubmit call setStepIndex and requestFocus
  // in the same handler, batched into one commit), the effect still sees the already-updated
  // DOM for the new step by the time it runs, since effects fire after the full commit.
  const [focusRequest, setFocusRequest] = useState<{ field: string } | null>(null)
  const requestFocus = (fieldName: string) => setFocusRequest({ field: fieldName })

  const fieldToStepIndex = useMemo(() => {
    const map: Partial<Record<keyof ParticipantFormData, number>> = {}
    WIZARD_STEPS.forEach((step, idx) => {
      for (const f of step.fields) map[f] = idx
    })
    return map
  }, [])

  useEffect(() => {
    if (focusRequest) focusField(focusRequest.field)
  }, [focusRequest])

  // Focus First Name once, on the wizard's initial mount only — a plain DOM focus() call (no
  // state involved) rather than the native `autoFocus` HTML attribute, since step content is
  // conditionally mounted/unmounted as steps change and `autoFocus` would otherwise re-fire
  // (stealing focus back) on every later remount of step 0.
  useEffect(() => {
    focusField('firstName')
  }, [])

  const currentStep = WIZARD_STEPS[stepIndex]
  const currentStepFieldSet = useMemo(() => new Set<keyof ParticipantFormData>(currentStep.fields), [currentStep])
  const currentStepErrorMessages = Object.entries(errors)
    .filter(([key]) => currentStepFieldSet.has(key as keyof ParticipantFormData))
    .map(([, err]) => (err as { message?: string } | undefined)?.message)
    .filter((m): m is string => !!m)

  const goToStep = (index: number) => {
    if (!visitedSteps.has(index)) return
    setStepIndex(index)
  }

  const handleBack = () => setStepIndex(i => Math.max(0, i - 1))

  const handleNext = () => {
    const schema = STEP_SCHEMAS[stepIndex]
    if (!schema) return
    for (const f of currentStep.fields) clearErrors(f)
    const result = schema.safeParse(getValues())
    if (!result.success) {
      let firstField: string | null = null
      for (const issue of result.error.issues) {
        // Full dot/index path (e.g. "riskEntries.0.description"), not just issue.path[0] — a
        // row-level error must land on that row, not collapse onto the whole array field, or
        // FormField's per-row `error={errors.riskEntries?.[i]?.description?.message}` lookup
        // below would never find it.
        const field = issue.path.map(String).join('.')
        if (!firstField) firstField = field
        setError(field as keyof ParticipantFormData, { type: issue.code, message: issue.message })
      }
      if (firstField) requestFocus(firstField)
      return
    }
    setVisitedSteps(prev => new Set(prev).add(stepIndex + 1))
    setStepIndex(i => Math.min(i + 1, REVIEW_STEP_INDEX))
  }

  // Safety net for the case where a value edited from the Review step's "Edit" link becomes
  // invalid again without the user re-running Next: the final-submit resolver (full schema)
  // still catches it, but the Review step renders no inputs to show the error against — so
  // jump back to whichever step owns the first invalid field and focus it there.
  const handleInvalidSubmit = (formErrors: FieldErrors<ParticipantFormData>) => {
    const firstField = Object.keys(formErrors)[0] as keyof ParticipantFormData | undefined
    if (!firstField) return
    const targetStep = fieldToStepIndex[firstField]
    if (targetStep === undefined) return
    setVisitedSteps(prev => new Set(prev).add(targetStep))
    setStepIndex(targetStep)
    requestFocus(firstField)
  }

  const overnightSupportValue = useWatch({ control, name: 'overnightSupport' })

  // Watches the whole form (no `name`) so the Review step can render live values without
  // relying on getValues(), which wouldn't reflect uncontrolled register()'d input changes. Also
  // the single source of truth for the equipment-notes enabled predicate and the INTAKE-07
  // conditional-visibility engine below, both of which read across several fields at once.
  const watchedValues = useWatch({ control })
  const hasAnyEquipment = equipmentEnabledPredicate(watchedValues)

  // INTAKE-07 — see src/lib/conditionalFields.ts's module doc. isVisible/hiddenFields drive JSX
  // gating and the Review step below; the two hooks handle unregister-on-hide (validation +
  // payload exclusion) and focus-fallback (accessibility) as side effects.
  // `as Partial<...>`: useWatch's return type deep-partials array-item fields (riskEntries'
  // atRiskParty/description become optional there), while these shared utilities' `Partial<V>`
  // signature is TS's shallow Partial (only top-level keys), which doesn't follow suit — a
  // spurious structural mismatch, not a real behavioural one.
  const { isVisible, hiddenFields } = useConditionalFields(watchedValues as Partial<ParticipantFormData>, CONDITIONAL_FIELDS)
  useUnregisterHiddenFields(unregister, hiddenFields)
  useFocusFallbackOnHide(CONDITIONAL_FIELDS, hiddenFields)

  // DIAG-02: `existing` (undefined until the edit-mode fetch resolves, then a stable object
  // reference) is the resetKey — see useDeriveFieldValues' doc for why this keeps a saved
  // participant's deliberately-unticked HIDPA selection from being silently re-derived on every
  // edit-page load, while still deriving live off real edits in both create and edit modes.
  useDeriveFieldValues(watchedValues as Partial<ParticipantFormData>, FIELD_DERIVATIONS, setValue, existing)

  // FUND-02 review-round fix: the server unconditionally clears FundingOrganisation on save
  // whenever FundingSource != Other (defence in depth against a stale value lingering — see
  // ParticipantsController.ValidateFundingSource's neighbouring assignment). That means a
  // same-session Other -> Ndis switch silently loses whatever the user typed into "Funding
  // Organisation" the moment they save, with no warning. Guarded here: switching AWAY from
  // Other while the specify field holds non-blank text is intercepted before it commits to the
  // form (see the Funding Source <select>'s onChange below) and held as a pending value until
  // the user confirms via the dialog below Cancel reverts the select to Other with the text
  // untouched; Confirm applies the switch (the field then hides/unregisters as normal, and the
  // text is what the server clears on save).
  // DIAG-01: transient typing buffer for the "add another diagnosis" text input on the Other
  // Diagnoses list — not itself a form field; its value is pushed into otherDiagnoses on Add,
  // then cleared, same "type then commit" shape as a tag input.
  const [customDiagnosisInput, setCustomDiagnosisInput] = useState('')

  const [pendingFundingSourceValue, setPendingFundingSourceValue] = useState<string | null>(null)
  const fundingSourceRegistration = register('fundingSource')
  const handleFundingSourceChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const nextValue = e.target.value
    const previousValue = watchedValues.fundingSource // still the pre-change value at this point
    const specify = getValues('fundingOrganisation')
    const leavingOtherWithText = previousValue === 'Other' && nextValue !== 'Other' && !!specify?.trim()
    if (leavingOtherWithText) {
      // The browser already applied the user's pick to the native <select> before this event
      // fires (this field is registered uncontrolled, no `value` prop) — revert that immediately
      // so the control visibly stays on "Other" while the dialog is open. RHF's own state was
      // never touched (its onChange isn't invoked on this path), so it's still in sync.
      e.target.value = 'Other'
      setPendingFundingSourceValue(nextValue)
      return
    }
    fundingSourceRegistration.onChange(e)
  }
  const confirmFundingSourceChange = () => {
    if (pendingFundingSourceValue) {
      setValue('fundingSource', pendingFundingSourceValue, { shouldDirty: true, shouldValidate: true })
    }
    setPendingFundingSourceValue(null)
  }
  const cancelFundingSourceChange = () => setPendingFundingSourceValue(null)

  useEffect(() => {
    if (overnightSupportValue === 'None') {
      setValue('overnightRatio', 'OneToOne')
    }
  }, [overnightSupportValue, setValue])

  // Round-trip fix: planType is unregistered (its value dropped entirely, by design — see
  // useUnregisterHiddenFields) whenever fundingSource is Other, since it's hidden then. Nothing
  // restores that value when the field reappears on a later switch back to Ndis (unregister vs.
  // register isn't a save/restore pair) — left alone, a user who tries Other and switches back to
  // Ndis would find Plan Type silently blank and Next blocked by fundingSourceRefine's "Ndis
  // requires planType" rule, with no field visibly showing why. Same pattern as the
  // overnightRatio effect above: re-apply the schema default the moment Ndis is selected with no
  // planType value, whatever caused it to be missing.
  useEffect(() => {
    if (watchedValues.fundingSource === 'Ndis' && !watchedValues.planType) {
      setValue('planType', 'SelfManaged')
    }
  }, [watchedValues.fundingSource, watchedValues.planType, setValue])

  useEffect(() => {
    if (existing) {
      reset({
        firstName: existing.firstName ?? '',
        lastName: existing.lastName ?? '',
        preferredName: existing.preferredName ?? '',
        middleName: existing.middleName ?? '',
        dateOfBirth: existing.dateOfBirth ? existing.dateOfBirth.split('T')[0] : '',
        gender: existing.gender ?? '',
        genderSelfDescription: existing.genderSelfDescription ?? '',
        placeOfBirth: existing.placeOfBirth ?? '',
        country: existing.country ?? '',
        phone: existing.phone ?? '',
        email: existing.email ?? '',
        addressStreet: existing.addressStreet ?? '',
        addressSuburb: existing.addressSuburb ?? '',
        addressState: existing.addressState ?? '',
        addressPostcode: existing.addressPostcode ?? '',
        livingArrangement: existing.livingArrangement ?? '',
        mainSupportPersonName: existing.mainSupportPersonName ?? '',
        mainSupportPersonRelationship: existing.mainSupportPersonRelationship ?? '',
        othersLivingInAccommodation: existing.othersLivingInAccommodation ?? '',
        residentialInfo: existing.residentialInfo ?? '',
        livesWithOthers: existing.livesWithOthers ?? false,
        whoLivesWith: existing.whoLivesWith ?? '',
        silProviderName: existing.silProviderName ?? '',
        silProviderContactPhone: existing.silProviderContactPhone ?? '',
        accommodationType: existing.accommodationType ?? '',
        onSiteSupportHours: existing.onSiteSupportHours ?? '',
        livingArrangementNotes: existing.livingArrangementNotes ?? '',
        ndisNumber: existing.ndisNumber ?? '',
        planStartDate: existing.planStartDate ? existing.planStartDate.split('T')[0] : '',
        planEndDate: existing.planEndDate ? existing.planEndDate.split('T')[0] : '',
        planType: existing.planType ?? 'SelfManaged',
        region: existing.region ?? '',
        fundingSource: existing.fundingSource ?? 'Ndis',
        fundingOrganisation: existing.fundingOrganisation ?? '',
        isDsoa: existing.isDsoa ?? false,
        isRepeatClient: existing.isRepeatClient ?? false,
        serviceStreams: parseServiceStreams(existing.serviceStreams),
        mobilityAidWheelchair: existing.mobilityAidWheelchair ?? false,
        mobilityAidWalker: existing.mobilityAidWalker ?? false,
        mobilitySupportOptions: existing.mobilitySupportOptions ?? [],
        // DIAG-01: a saved value outside the curated list (typed via "Other — specify" at intake)
        // round-trips back into that same UI shape — the select shows the sentinel, and the
        // actual saved text reappears in the specify field. A saved curated value shows directly.
        primaryDiagnosis: existing.primaryDiagnosis
          ? (DIAGNOSIS_OPTIONS as readonly string[]).includes(existing.primaryDiagnosis)
            ? existing.primaryDiagnosis
            : DIAGNOSIS_OTHER_SENTINEL
          : '',
        primaryDiagnosisOther: existing.primaryDiagnosis && !(DIAGNOSIS_OPTIONS as readonly string[]).includes(existing.primaryDiagnosis)
          ? existing.primaryDiagnosis
          : '',
        otherDiagnoses: existing.otherDiagnoses ?? [],
        hidpaSupportCategories: parseHidpaCategories(existing.hidpaSupportCategories),
        isHighSupport: existing.isHighSupport ?? false,
        isIntensiveSupport: existing.isIntensiveSupport ?? false,
        overnightSupport: existing.overnightSupport ?? 'None',
        overnightRatio: existing.overnightRatio ?? 'OneToOne',
        requiresHiLoBed: existing.requiresHiLoBed ?? false,
        requiresHoist: existing.requiresHoist ?? false,
        requiresShowerChair: existing.requiresShowerChair ?? false,
        requiresCommode: existing.requiresCommode ?? false,
        requiresStandingMachine: existing.requiresStandingMachine ?? false,
        supportRatio: existing.supportRatio ?? 'SharedSupport',
        mobilityNotes: existing.mobilityNotes ?? '',
        equipmentRequirements: existing.equipmentRequirements ?? '',
        transportRequirements: existing.transportRequirements ?? '',
        medicalSummary: existing.medicalSummary ?? '',
        behaviourRiskSummary: existing.behaviourRiskSummary ?? '',
        notes: existing.notes ?? '',
        preferredStaffId: existing.preferredStaffId ?? '',
        // INTAKE sub-wave A — Key Identifiers step round-trip.
        pensionCardNumber: existing.pensionCardNumber ?? '',
        pensionCardExpiry: existing.pensionCardExpiry ? existing.pensionCardExpiry.split('T')[0] : '',
        medicareNumber: existing.medicareNumber ?? '',
        medicareExpiry: existing.medicareExpiry ? existing.medicareExpiry.split('T')[0] : '',
        companionCardNumber: existing.companionCardNumber ?? '',
        companionCardExpiry: existing.companionCardExpiry ? existing.companionCardExpiry.split('T')[0] : '',
        privateHealthFund: existing.privateHealthFund ?? '',
        privateHealthMembershipNumber: existing.privateHealthMembershipNumber ?? '',
        taxiCardNumber: existing.taxiCardNumber ?? '',
        hairColour: existing.hairColour ?? '',
        eyeColour: existing.eyeColour ?? '',
        weightKg: existing.weightKg ?? undefined,
        heightCm: existing.heightCm ?? undefined,
        // INTAKE-09: edit-mode never populates this from `existing` — risk entries for an
        // already-created participant are managed via the nested CRUD (the detail page's Risks
        // section), not through this wizard. Reset to empty so useFieldArray stays consistent.
        riskEntries: [],
        // CONTACT-02: same reasoning as riskEntries above — contacts for an already-created
        // participant are managed via the Contacts tab's nested CRUD, not through this wizard.
        contactRoles: [],
        // INTAKE sub-wave B — cultural/rights flags. Tri-state boolean|null -> 'true'|'false'|''.
        isCald: boolToTriState(existing.isCald),
        isLgbtqi: boolToTriState(existing.isLgbtqi),
        isFamilyCommunity: boolToTriState(existing.isFamilyCommunity),
        isAboriginalOrTorresStraitIslander: boolToTriState(existing.isAboriginalOrTorresStraitIslander),
        receivedRightsAndResponsibilitiesInfo: boolToTriState(existing.receivedRightsAndResponsibilitiesInfo),
        receivedPrivacyAndConfidentialityInfo: boolToTriState(existing.receivedPrivacyAndConfidentialityInfo),
        receivedFeedbackInfo: boolToTriState(existing.receivedFeedbackInfo),
        receivedBeingSafeInfo: boolToTriState(existing.receivedBeingSafeInfo),
        receivedAdvocacyInfo: boolToTriState(existing.receivedAdvocacyInfo),
        personalInterests: existing.personalInterests ?? '',
        choiceControlNotes: existing.choiceControlNotes ?? '',
        // INTAKE sub-wave B — unlike riskEntries/contactRoles above, consents ARE populated from
        // `existing` in edit mode (see CreateParticipantDto.consents' backend doc): the wizard
        // step stays editable after the participant already exists, not create-mode-only. Always
        // all 7 ConsentType rows, in CONSENT_TYPES order regardless of what order the server
        // returned them in.
        consents: CONSENT_TYPES.map((type) => {
          const c = existing.consents?.find((row) => row.consentType === type)
          return {
            consentType: type,
            granted: boolToTriState(c?.granted ?? null),
            signedByName: c?.signedByName ?? '',
            signedDate: c?.signedDate ? c.signedDate.split('T')[0] : '',
          }
        }),
      })
    }
  }, [existing, reset])

  // INTAKE-08: shared shaping logic between a full submit (draft=false, always validated by
  // participantResolver first) and a "Save as draft" call (draft=true, called directly off
  // getValues() with NO zod validation at all — a draft persists whatever is filled). Both
  // paths still run stripHiddenFieldKeys/the DIAG-01 collapse/the '' -> null pass identically;
  // only the isDraft flag on the resulting payload differs.
  const buildPayload = (data: ParticipantFormData, draft: boolean) => {
    // INTAKE-07: unregister-on-hide should already have dropped hidden fields' keys from `data`
    // (react-hook-form's default unregister options exclude them from validation AND from the
    // values object handleSubmit builds) — stripHiddenFieldKeys is the defence-in-depth pass
    // guaranteeing it regardless, per the engine's module doc.
    const payload: any = stripHiddenFieldKeys({ ...data }, hiddenFields)
    payload.serviceStreams = formatServiceStreams(data.serviceStreams as ServiceStream[] | undefined)
    // DIAG-01: collapse the two-field UI representation (curated select + "Other — specify" text)
    // down to the one backend string field — the typed text when the sentinel is selected,
    // otherwise the curated value as-is. primaryDiagnosisOther is UI-only and never sent.
    payload.primaryDiagnosis = data.primaryDiagnosis === DIAGNOSIS_OTHER_SENTINEL
      ? data.primaryDiagnosisOther
      : data.primaryDiagnosis
    delete payload.primaryDiagnosisOther
    // DIAG-02.
    payload.hidpaSupportCategories = formatHidpaCategories(data.hidpaSupportCategories as HidpaSupportCategory[] | undefined)
    // CONTACT-02: expand the wizard's lean per-row shape (personMode/personId/newPerson*/roleType/
    // relationshipToParticipant/isPrimary) into the full CreateParticipantContactRoleDto shape the
    // server expects — every other role-specific field (guardian order scope, nominee scope, GP
    // registration number, etc.) is left null here and filled in later via the Contacts tab, since
    // the wizard step deliberately doesn't surface all 25+ of them.
    payload.contactRoles = (data.contactRoles ?? []).map((row) => ({
      personId: row.personMode === 'existing' ? (row.personId || null) : null,
      newPersonFirstName: row.personMode === 'new' ? (row.newPersonFirstName || null) : null,
      newPersonLastName: row.personMode === 'new' ? (row.newPersonLastName || null) : null,
      newPersonPhone: null, newPersonMobile: null, newPersonEmail: null, newPersonOrganisation: null,
      roleType: row.roleType,
      relationshipToParticipant: row.relationshipToParticipant || null,
      isPrimary: !!row.isPrimary,
      status: 'Active',
      orderScopeDomains: [],
      priorityOrder: null, authorisedForMedicalInfo: null, appointingTribunal: null,
      orderStartDate: null, orderReviewDate: null, orderEndDate: null, nomineeScope: null, appointmentDate: null,
      reasonForAppointment: null, alternateRepresentativeName: null, fundingLineItemType: null, organisationName: null,
      registrationNumber: null, lastVisitDate: null, consentToShare: null, discipline: null, frequencyOfContact: null,
      websterPackFlag: null, roleTitle: null, registeredProviderFlag: null, scopeNotes: null,
      authorisationDocumentReference: null, preferredLanguage: null, startDate: null, endDate: null, notes: null,
    }))
    // INTAKE sub-wave A: weightKg/heightCm are z.coerce.number() fields, but only a full submit
    // (participantResolver) actually runs that coercion — "Save as draft" reads getValues()
    // directly (bypassing the resolver entirely, by design — see handleSaveDraft's doc), so the
    // raw value here may still be the native number input's string. Coerce explicitly for both
    // paths rather than relying on the resolver having already run; empty/non-numeric coerces to
    // null (same "0 means not provided" convention as AccommodationCreatePage's
    // bedroomCount/bedCount/maxCapacity).
    for (const numField of ['weightKg', 'heightCm']) {
      const raw = payload[numField]
      const num = raw === '' || raw === null || raw === undefined ? NaN : Number(raw)
      payload[numField] = Number.isFinite(num) && num !== 0 ? num : null
    }
    // INTAKE sub-wave B: collapse each tri-state 'true'|'false'|'' UI field down to the backend's
    // boolean|null shape.
    for (const culturalField of [
      'isCald', 'isLgbtqi', 'isFamilyCommunity', 'isAboriginalOrTorresStraitIslander',
      'receivedRightsAndResponsibilitiesInfo', 'receivedPrivacyAndConfidentialityInfo',
      'receivedFeedbackInfo', 'receivedBeingSafeInfo', 'receivedAdvocacyInfo',
    ] as const) {
      payload[culturalField] = triStateToBool(data[culturalField])
    }
    // Signed-by/date only travel with the payload once granted — clearing them here (rather than
    // relying on the JSX simply not rendering them) means a user who typed a name then flipped
    // the toggle back to No/blank doesn't leave stale signed-by data sitting in form state.
    payload.consents = (data.consents ?? []).map((c) => ({
      consentType: c.consentType,
      granted: triStateToBool(c.granted),
      signedByName: c.granted === 'true' ? (c.signedByName || null) : null,
      signedDate: c.granted === 'true' ? (c.signedDate || null) : null,
    }))
    for (const key of Object.keys(payload)) {
      if (payload[key] === '' || payload[key] === undefined) payload[key] = null
    }
    payload.isDraft = draft
    return payload
  }

  const onSubmit = async (data: ParticipantFormData) => {
    const payload = buildPayload(data, false)
    try {
      if (isEdit) {
        // INTAKE-09/CONTACT-02: edit-mode never renders the riskEntries/contactRoles rows UI (see
        // their schema docs) — drop the always-empty arrays rather than send a meaningless key
        // the Update endpoint ignores anyway.
        delete payload.riskEntries
        delete payload.contactRoles
        const res = await updateParticipant.mutateAsync({ id, data: { ...payload, isActive: existing?.isActive ?? true } })
        if (res.success) {
          // Clear isDirty synchronously (flushSync) before navigating so the
          // unsaved-changes blocker doesn't fire for this intentional navigation.
          // `as unknown as ...`: react-hook-form's DeepPartial helper doesn't recurse into array-of-object
          // fields (riskEntries), so it keeps that nested item shape non-optional in reset()'s
          // parameter type — a spurious mismatch against `data`'s own (correctly non-optional)
          // shape, not a real one.
          flushSync(() => reset(data as unknown as Parameters<typeof reset>[0]))
          navigate(`/participants/${id}`)
        }
      } else {
        const res = await createParticipant.mutateAsync(payload)
        if (res.success && res.data?.id) {
          // `as unknown as ...`: react-hook-form's DeepPartial helper doesn't recurse into array-of-object
          // fields (riskEntries), so it keeps that nested item shape non-optional in reset()'s
          // parameter type — a spurious mismatch against `data`'s own (correctly non-optional)
          // shape, not a real one.
          flushSync(() => reset(data as unknown as Parameters<typeof reset>[0]))
          navigate(`/participants/${res.data.id}`)
        }
      }
    } catch {
      // error handled by mutation state
    }
  }

  // INTAKE-08: "Save as draft" — available on every wizard step, not just Review. Deliberately
  // bypasses handleSubmit/participantResolver entirely (reads getValues() directly) so a
  // partially-completed form — missing fields the per-step zod schemas would otherwise block
  // Next on — still saves. The server applies its own, much looser, draft floor (see
  // ParticipantsController.ValidateNames): at least one of firstName/lastName, plus every
  // format/consistency check on whatever else IS filled in (unchanged from a full submit).
  const [draftError, setDraftError] = useState<string | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const handleSaveDraft = async () => {
    setDraftError(null)
    setSavingDraft(true)
    const data = getValues()
    const payload = buildPayload(data, true)
    try {
      if (isEdit) {
        delete payload.riskEntries
        delete payload.contactRoles
        const res = await updateParticipant.mutateAsync({ id, data: { ...payload, isActive: existing?.isActive ?? true } })
        if (res.success) {
          flushSync(() => reset(data as unknown as Parameters<typeof reset>[0]))
        }
      } else {
        const res = await createParticipant.mutateAsync(payload)
        if (res.success && res.data?.id) {
          flushSync(() => reset(data as unknown as Parameters<typeof reset>[0]))
          // Switch into the edit route for the just-created draft — same wizard, now resumable
          // (and re-saveable as a draft again) via its own id.
          navigate(`/participants/${res.data.id}/edit`)
        }
      }
    } catch (err) {
      setDraftError(extractErrorMessage(err, 'Failed to save draft. Please try again.'))
    } finally {
      setSavingDraft(false)
    }
  }

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  if (isEdit && isLoadingExisting) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading...</div>

  // INTAKE-08 fix round 1 (Finding 1a): "Save as draft" is offered on create (no existing
  // record yet — nothing to un-finalise) and on resuming an existing draft, never while editing
  // an already-finalised participant. `existing` is guaranteed resolved here (the loading guard
  // above already returned for edit mode while it was pending).
  const canSaveDraft = !isEdit || existing?.isDraft === true

  const preferredStaffName = activeStaff.find(s => s.id === watchedValues.preferredStaffId)?.fullName ?? 'None'
  const supportRatioLabel = OVERNIGHT_RATIO_LABELS[(watchedValues.supportRatio as SupportRatio) ?? 'SharedSupport'] ?? '—'
  const overnightSupportLabel = OVERNIGHT_SUPPORT_LABELS[(watchedValues.overnightSupport as OvernightSupportType) ?? 'None'] ?? '—'
  const overnightRatioLabel = watchedValues.overnightSupport && watchedValues.overnightSupport !== 'None'
    ? OVERNIGHT_RATIO_LABELS[(watchedValues.overnightRatio as SupportRatio) ?? 'OneToOne'] ?? '—'
    : 'N/A'

  const reviewGroups: { step: number; rows: { label: string; value: string }[] }[] = [
    {
      step: 0,
      rows: [
        { label: 'First Name', value: watchedValues.firstName || '—' },
        { label: 'Last Name', value: watchedValues.lastName || '—' },
        { label: 'Preferred Name', value: watchedValues.preferredName || '—' },
        { label: 'Middle Name', value: watchedValues.middleName || '—' },
        { label: 'Date of Birth', value: watchedValues.dateOfBirth || '—' },
        {
          label: 'Gender',
          value: watchedValues.gender
            ? (GENDER_LABELS[watchedValues.gender as Gender] ?? watchedValues.gender)
              + (watchedValues.gender === 'Other' && watchedValues.genderSelfDescription ? ` (${watchedValues.genderSelfDescription})` : '')
            : '—',
        },
        { label: 'Preferred Staff Member', value: preferredStaffName },
        { label: 'Place of Birth', value: watchedValues.placeOfBirth || '—' },
        { label: 'Phone', value: watchedValues.phone || '—' },
        { label: 'Email', value: watchedValues.email || '—' },
        {
          label: 'Address',
          value: [watchedValues.addressStreet, watchedValues.addressSuburb, watchedValues.addressState, watchedValues.addressPostcode, watchedValues.country]
            .filter(Boolean).join(', ') || '—',
        },
        {
          label: 'Living Arrangement',
          value: watchedValues.livingArrangement
            ? (LIVING_ARRANGEMENT_LABELS[watchedValues.livingArrangement as LivingArrangement] ?? watchedValues.livingArrangement)
            : '—',
        },
        // LIVING-02/03/04: only the fields relevant to the selected arrangement type appear in
        // the review summary — same isVisible gate the step's own inputs use.
        ...(isVisible('mainSupportPersonName') ? [{ label: 'Main Support Person', value: watchedValues.mainSupportPersonName || '—' }] : []),
        ...(isVisible('mainSupportPersonRelationship') ? [{ label: 'Relationship to Participant', value: watchedValues.mainSupportPersonRelationship || '—' }] : []),
        ...(isVisible('othersLivingInAccommodation') ? [{ label: 'Others Living in the Accommodation', value: watchedValues.othersLivingInAccommodation || '—' }] : []),
        ...(isVisible('residentialInfo') ? [{ label: 'Residential Information', value: watchedValues.residentialInfo || '—' }] : []),
        ...(isVisible('livesWithOthers') ? [{ label: 'Lives With Others', value: watchedValues.livesWithOthers ? 'Yes' : 'No' }] : []),
        ...(isVisible('whoLivesWith') ? [{ label: 'Who They Live With', value: watchedValues.whoLivesWith || '—' }] : []),
        ...(isVisible('silProviderName') ? [{ label: 'SIL Provider Name', value: watchedValues.silProviderName || '—' }] : []),
        ...(isVisible('silProviderContactPhone') ? [{ label: 'SIL Provider Contact', value: watchedValues.silProviderContactPhone || '—' }] : []),
        ...(isVisible('accommodationType') ? [{ label: 'Accommodation Type', value: watchedValues.accommodationType || '—' }] : []),
        ...(isVisible('onSiteSupportHours') ? [{ label: 'On-Site Support Hours', value: watchedValues.onSiteSupportHours || '—' }] : []),
        ...(isVisible('livingArrangementNotes') ? [{ label: 'Living Arrangement Notes', value: watchedValues.livingArrangementNotes || '—' }] : []),
      ],
    },
    {
      step: 1,
      rows: [
        {
          label: 'Funding Source',
          value: watchedValues.fundingSource
            ? (FUNDING_SOURCE_LABELS[watchedValues.fundingSource as FundingSource] ?? watchedValues.fundingSource)
            : '—',
        },
        // FUND-02: only the fields relevant to the selected funding source appear in the
        // review summary — same isVisible gate the step's own inputs use.
        ...(isVisible('ndisNumber') ? [{ label: 'NDIS Number', value: watchedValues.ndisNumber || '—' }] : []),
        ...(isVisible('planStartDate') ? [{ label: 'Plan Start Date', value: watchedValues.planStartDate || '—' }] : []),
        ...(isVisible('planEndDate') ? [{ label: 'Plan End Date', value: watchedValues.planEndDate || '—' }] : []),
        ...(isVisible('planType') ? [{ label: 'Plan Type', value: PLAN_TYPE_LABELS[watchedValues.planType ?? ''] ?? '—' }] : []),
        { label: 'Region', value: watchedValues.region || '—' },
        ...(isVisible('fundingOrganisation') ? [{ label: 'Funding Organisation', value: watchedValues.fundingOrganisation || '—' }] : []),
        { label: 'Disability Support for Older Australians (DSOA)', value: watchedValues.isDsoa ? 'Yes' : 'No' },
        { label: 'Repeat Client', value: watchedValues.isRepeatClient ? 'Yes' : 'No' },
        {
          label: 'Service Streams',
          value: watchedValues.serviceStreams?.length
            ? watchedValues.serviceStreams.map((s) => SERVICE_STREAM_LABELS[s as ServiceStream] ?? s).join(', ')
            : 'None',
        },
      ],
    },
    {
      // INTAKE sub-wave A — Key Identifiers step review summary.
      step: 2,
      rows: [
        { label: 'Pension Card Number', value: watchedValues.pensionCardNumber || '—' },
        { label: 'Pension Card Expiry', value: watchedValues.pensionCardExpiry || '—' },
        { label: 'Medicare Number', value: watchedValues.medicareNumber || '—' },
        { label: 'Medicare Expiry', value: watchedValues.medicareExpiry || '—' },
        { label: 'Companion Card Number', value: watchedValues.companionCardNumber || '—' },
        { label: 'Companion Card Expiry', value: watchedValues.companionCardExpiry || '—' },
        { label: 'Private Health Fund', value: watchedValues.privateHealthFund || '—' },
        { label: 'Private Health Membership Number', value: watchedValues.privateHealthMembershipNumber || '—' },
        { label: 'Taxi Card Number', value: watchedValues.taxiCardNumber || '—' },
        { label: 'Hair Colour', value: watchedValues.hairColour || '—' },
        { label: 'Eye Colour', value: watchedValues.eyeColour || '—' },
        { label: 'Weight (kg)', value: watchedValues.weightKg ? String(watchedValues.weightKg) : '—' },
        { label: 'Height (cm)', value: watchedValues.heightCm ? String(watchedValues.heightCm) : '—' },
      ],
    },
    {
      // CONTACT-02: contacts entered on the Contacts step (create-mode only, mirroring risk
      // entries) — one row per contact, "New: Firstname Lastname" or "Existing: <personId>"
      // depending on personMode, since the person's real name isn't known client-side for a
      // not-yet-saved "existing person" selection beyond whatever the picker already resolved.
      step: 3,
      rows: (watchedValues.contactRoles?.length ?? 0) === 0
        ? [{ label: 'Contacts', value: 'None added' }]
        : (watchedValues.contactRoles ?? []).map((row, i) => ({
            label: `Contact ${i + 1}`,
            value: `${CONTACT_ROLE_TYPE_LABELS[(row?.roleType as ContactRoleType) ?? 'NextOfKin']} — ${
              row?.personMode === 'new'
                ? [row?.newPersonFirstName, row?.newPersonLastName].filter(Boolean).join(' ') || '—'
                : people.find(p => p.id === row?.personId)?.fullName ?? '—'
            }`,
          })),
    },
    {
      // INTAKE sub-wave B — Cultural & Consent step review summary.
      step: 4,
      rows: [
        { label: 'CALD', value: yesNoUnknown(watchedValues.isCald) },
        { label: 'LGBTIQA+', value: yesNoUnknown(watchedValues.isLgbtqi) },
        { label: 'Family / Community', value: yesNoUnknown(watchedValues.isFamilyCommunity) },
        { label: 'Aboriginal and/or Torres Strait Islander', value: yesNoUnknown(watchedValues.isAboriginalOrTorresStraitIslander) },
        { label: 'Received: Rights and Responsibilities', value: yesNoUnknown(watchedValues.receivedRightsAndResponsibilitiesInfo) },
        { label: 'Received: Privacy and Confidentiality', value: yesNoUnknown(watchedValues.receivedPrivacyAndConfidentialityInfo) },
        { label: 'Received: Feedback Information and Form', value: yesNoUnknown(watchedValues.receivedFeedbackInfo) },
        { label: 'Received: Being Safe Information', value: yesNoUnknown(watchedValues.receivedBeingSafeInfo) },
        { label: 'Received: Advocacy Information', value: yesNoUnknown(watchedValues.receivedAdvocacyInfo) },
        { label: 'Personal Interests', value: watchedValues.personalInterests || '—' },
        { label: 'Choice & Control Notes', value: watchedValues.choiceControlNotes || '—' },
        ...CONSENT_TYPES.map((type, index) => ({
          label: CONSENT_TYPE_LABELS[type],
          value: yesNoUnknown(watchedValues.consents?.[index]?.granted as string | undefined),
        })),
      ],
    },
    {
      step: 5,
      rows: [
        { label: 'High Support', value: watchedValues.isHighSupport ? 'Yes' : 'No' },
        { label: 'Intensive Support (NDIS billing)', value: watchedValues.isIntensiveSupport ? 'Yes' : 'No' },
        { label: 'Support Ratio', value: supportRatioLabel },
        { label: 'Wheelchair', value: watchedValues.mobilityAidWheelchair ? 'Yes' : 'No' },
        { label: 'Walker', value: watchedValues.mobilityAidWalker ? 'Yes' : 'No' },
        { label: 'Mobility Support', value: watchedValues.mobilitySupportOptions?.length ? watchedValues.mobilitySupportOptions.join(', ') : 'None selected' },
        { label: 'Overnight Support', value: overnightSupportLabel },
        { label: 'Overnight Ratio', value: overnightRatioLabel },
        { label: 'Hi-Lo Bed', value: watchedValues.requiresHiLoBed ? 'Yes' : 'No' },
        { label: 'Hoist', value: watchedValues.requiresHoist ? 'Yes' : 'No' },
        { label: 'Shower Chair', value: watchedValues.requiresShowerChair ? 'Yes' : 'No' },
        { label: 'Commode', value: watchedValues.requiresCommode ? 'Yes' : 'No' },
        { label: 'Standing Machine', value: watchedValues.requiresStandingMachine ? 'Yes' : 'No' },
        { label: 'Mobility Notes', value: watchedValues.mobilityNotes || '—' },
        { label: 'Equipment Requirements', value: watchedValues.equipmentRequirements || '—' },
        { label: 'Transport Requirements', value: watchedValues.transportRequirements || '—' },
      ],
    },
    {
      step: 6,
      rows: [
        {
          label: 'Primary Diagnosis',
          value: watchedValues.primaryDiagnosis === DIAGNOSIS_OTHER_SENTINEL
            ? (watchedValues.primaryDiagnosisOther || '—')
            : (watchedValues.primaryDiagnosis || '—'),
        },
        { label: 'Other Diagnoses', value: watchedValues.otherDiagnoses?.length ? watchedValues.otherDiagnoses.join(', ') : 'None' },
        {
          label: 'HIDPA Support Categories',
          value: watchedValues.hidpaSupportCategories?.length
            ? watchedValues.hidpaSupportCategories.map((c) => HIDPA_CATEGORY_LABELS[c as HidpaSupportCategory] ?? c).join(', ')
            : 'None',
        },
        { label: 'Medical Summary', value: watchedValues.medicalSummary || '—' },
      ],
    },
    {
      step: 7,
      rows: [
        { label: 'Behaviour Risk Summary', value: watchedValues.behaviourRiskSummary || '—' },
        { label: 'General Notes', value: watchedValues.notes || '—' },
        // INTAKE-09 — create-mode only; edit-mode never populates riskEntries (see its schema doc).
        ...(!isEdit ? [{
          label: 'Risk Entries',
          value: watchedValues.riskEntries?.length
            ? `${watchedValues.riskEntries.length} entered`
            : 'None',
        }] : []),
      ],
    },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      {unsavedChangesDialog}
      <ConfirmDialog
        open={pendingFundingSourceValue !== null}
        onCancel={cancelFundingSourceChange}
        onConfirm={confirmFundingSourceChange}
        title="Switch away from Other funding source?"
        message="The funding organisation you specified will be cleared when you save this participant. Switching back to Other later won't bring it back."
        confirmLabel="Switch and clear"
        variant="danger"
      />
      <div className="flex items-center gap-4">
        <Link to={isEdit ? `/participants/${id}` : '/participants'} className="p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl md:text-2xl font-bold">{isEdit ? 'Edit Participant' : 'Create New Participant'}</h1>
        {/* INTAKE-08: a clear, always-visible indicator that this record is still a draft —
            amber rather than StatusBadge's default muted "draft" style, so it reads as
            "needs attention" rather than blending into the page. */}
        {isEdit && existing?.isDraft && (
          <StatusBadge status="Draft" colorMap={{ draft: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]' }} />
        )}
      </div>

      {mutation.isError && (
        <div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          Failed to {isEdit ? 'update' : 'create'} participant. Please check your input and try again.
        </div>
      )}

      {draftError && (
        <div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          {draftError}
        </div>
      )}

      <nav aria-label="Intake wizard steps" className="overflow-x-auto">
        <ol className="flex items-center gap-2 md:gap-4 min-w-max pb-2">
          {WIZARD_STEPS.map((step, idx) => {
            const isCurrent = idx === stepIndex
            const isCompleted = idx < stepIndex
            const isClickable = visitedSteps.has(idx)
            return (
              <li key={step.key} className="flex items-center gap-2 md:gap-4">
                <button
                  type="button"
                  aria-current={isCurrent ? 'step' : undefined}
                  disabled={!isClickable}
                  onClick={() => goToStep(idx)}
                  className={`flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-full text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${
                    isCurrent
                      ? 'bg-[var(--color-primary)] text-white'
                      : isCompleted
                      ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                      : 'bg-[var(--color-accent)] text-[var(--color-muted-foreground)]'
                  } ${!isClickable ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                  <span
                    className={`flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shrink-0 ${
                      isCurrent ? 'bg-white/20' : isCompleted ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-border)]'
                    }`}
                  >
                    {isCompleted ? <Check className="w-3 h-3" /> : idx + 1}
                  </span>
                  {/* Visually hidden below sm rather than removed from the DOM (a plain
                      `hidden` utility would strip it from the accessible name too, leaving
                      screen reader users with only a bare digit like "2" for the button) —
                      the full step label stays available to assistive tech at every width. */}
                  <span className="sr-only sm:not-sr-only sm:inline">{step.label}</span>
                </button>
                {idx < WIZARD_STEPS.length - 1 && (
                  <span className="w-4 md:w-8 h-px bg-[var(--color-border)]" aria-hidden="true" />
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {currentStepErrorMessages.length > 0 && (
        <div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          <p className="font-medium">Please fix the following before continuing:</p>
          <ul className="list-disc list-inside mt-1">
            {currentStepErrorMessages.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit, handleInvalidSubmit)} noValidate>
        {stepIndex === 0 && (
          <div className="grid md:grid-cols-2 gap-6">
            <Card title="Personal Information" className="space-y-4">
              <FormField label="First Name" required error={errors.firstName?.message}>
                <input id="firstName" {...register('firstName')} placeholder="e.g. John" />
              </FormField>

              <FormField label="Last Name" required error={errors.lastName?.message}>
                <input id="lastName" {...register('lastName')} placeholder="e.g. Smith" />
              </FormField>

              <FormField label="Preferred Name">
                <input id="preferredName" {...register('preferredName')} placeholder="e.g. Johnny" />
              </FormField>

              {/* INTAKE sub-wave A, PID-004. */}
              <FormField label="Middle Name">
                <input id="middleName" {...register('middleName')} placeholder="e.g. Robert" />
              </FormField>

              <FormField label="Date of Birth">
                <input id="dateOfBirth" type="date" {...register('dateOfBirth')} />
              </FormField>

              <FormField label="Gender">
                <select id="gender" {...register('gender')}>
                  <option value="">Not specified</option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>{GENDER_LABELS[g]}</option>
                  ))}
                </select>
              </FormField>

              {isVisible('genderSelfDescription') && (
                <FormField label="Gender Self-Description" required error={errors.genderSelfDescription?.message}>
                  <input id="genderSelfDescription" {...register('genderSelfDescription')} placeholder="How the participant describes their gender" />
                </FormField>
              )}

              {/* INTAKE sub-wave A, PID-010. */}
              <FormField label="Place of Birth">
                <input id="placeOfBirth" {...register('placeOfBirth')} placeholder="e.g. Brisbane, QLD" />
              </FormField>

              {/* INTAKE sub-wave A, CON-007/CON-008 — the participant's OWN phone/email
                  (previously the only phone/email fields on a participant belonged to a
                  Contact/Person row — see research spec §5). */}
              <FormField label="Phone" error={errors.phone?.message}>
                <input id="phone" type="tel" {...register('phone')} placeholder="e.g. 0400 000 000" />
              </FormField>

              <FormField label="Email" error={errors.email?.message}>
                <input id="email" type="email" {...register('email')} placeholder="e.g. name@example.com" />
              </FormField>
            </Card>

            <Card title="Staff Preferences" className="space-y-4">
              {/* UX-01: participant/staff-scale picker — was a Dropdown `searchable`, now
                  SearchableSelect per components/README.md "Picking a picker". Scoped to this one
                  field's control only — see feat/intake08-drafts, a different lane touching other
                  parts of this same wizard file. */}
              <FormField label="Preferred Staff Member">
                <Controller
                  control={control}
                  name="preferredStaffId"
                  render={({ field }) => (
                    <SearchableSelect
                      id="preferredStaffId"
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      items={[
                        { value: '', label: 'None' },
                        ...activeStaff.map(s => ({ value: s.id, label: s.fullName })),
                      ]}
                    />
                  )}
                />
              </FormField>
            </Card>

            {/* INTAKE-06 — structured address. */}
            <Card title="Address" className="space-y-4">
              <FormField label="Street">
                <input id="addressStreet" {...register('addressStreet')} placeholder="e.g. 12 Example Street" />
              </FormField>

              <FormField label="Suburb">
                <input id="addressSuburb" {...register('addressSuburb')} placeholder="e.g. Fortitude Valley" />
              </FormField>

              <FormField label="State">
                <select id="addressState" {...register('addressState')}>
                  <option value="">Not specified</option>
                  {AU_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </FormField>

              <FormField label="Postcode" error={errors.addressPostcode?.message} hint="4 digits, e.g. 4000">
                <input id="addressPostcode" {...register('addressPostcode')} inputMode="numeric" maxLength={4} placeholder="e.g. 4000" />
              </FormField>

              {/* INTAKE sub-wave A, CON-006. */}
              <FormField label="Country">
                <input id="country" {...register('country')} placeholder="e.g. Australia" />
              </FormField>
            </Card>

            {/* LIVING-01/02/03/04 — living arrangement type plus its conditional per-type
                fields, revealed via the INTAKE-07 engine (isVisible below). */}
            <Card title="Living Arrangements" className="space-y-4">
              <FormField label="Living Arrangement">
                <select id="livingArrangement" {...register('livingArrangement')}>
                  <option value="">Not specified</option>
                  {LIVING_ARRANGEMENTS.map((a) => (
                    <option key={a} value={a}>{LIVING_ARRANGEMENT_LABELS[a]}</option>
                  ))}
                </select>
              </FormField>

              {isVisible('mainSupportPersonName') && (
                <>
                  <FormField label="Main Support Person" required error={errors.mainSupportPersonName?.message}>
                    {/* Free text, deliberately NOT linked to CONTACT-01's Person/ContactRole model
                        even though it now exists (see Participant.cs's updated doc comment) — no
                        FK, no auto-migration into a Person row. A future pass can replace this
                        with a Person picker/NextOfKin role instead. */}
                    <input id="mainSupportPersonName" {...register('mainSupportPersonName')} placeholder="e.g. Jane Citizen" />
                  </FormField>
                  <FormField label="Relationship to Participant">
                    <input id="mainSupportPersonRelationship" {...register('mainSupportPersonRelationship')} placeholder="e.g. Mother" />
                  </FormField>
                  <FormField label="Others Living in the Accommodation">
                    <textarea id="othersLivingInAccommodation" {...register('othersLivingInAccommodation')} rows={2} placeholder="Who else lives there..." />
                  </FormField>
                  <FormField label="Residential Information">
                    <textarea id="residentialInfo" {...register('residentialInfo')} rows={2} placeholder="Home layout, accessibility..." />
                  </FormField>
                </>
              )}

              {isVisible('livesWithOthers') && (
                <FormField label="Lives With Others" layout="checkbox">
                  <input id="livesWithOthers" type="checkbox" {...register('livesWithOthers')} className="w-4 h-4 rounded border-[var(--color-border)]" />
                </FormField>
              )}

              {isVisible('whoLivesWith') && (
                <FormField label="Who They Live With" required error={errors.whoLivesWith?.message}>
                  <input id="whoLivesWith" {...register('whoLivesWith')} placeholder="e.g. Housemates" />
                </FormField>
              )}

              {isVisible('silProviderName') && (
                <>
                  <FormField label="SIL Provider Name" required error={errors.silProviderName?.message}>
                    <input id="silProviderName" {...register('silProviderName')} placeholder="e.g. Sunrise SIL Services" />
                  </FormField>
                  <FormField label="SIL Provider Contact (Phone)">
                    <input id="silProviderContactPhone" {...register('silProviderContactPhone')} placeholder="e.g. 0400 000 000" />
                  </FormField>
                  <FormField label="Accommodation Type">
                    <input id="accommodationType" {...register('accommodationType')} placeholder="e.g. Group home" />
                  </FormField>
                  <FormField label="On-Site Support Hours">
                    <input id="onSiteSupportHours" {...register('onSiteSupportHours')} placeholder="e.g. 24/7 or 9-5 weekdays" />
                  </FormField>
                </>
              )}

              {isVisible('livingArrangementNotes') && (
                <FormField label="Living Arrangement Notes">
                  <textarea id="livingArrangementNotes" {...register('livingArrangementNotes')} rows={2} placeholder="Any additional notes..." />
                </FormField>
              )}
            </Card>
          </div>
        )}

        {stepIndex === 1 && (
          <div className="grid md:grid-cols-2 gap-6">
            <Card title="NDIS & Funding" className="space-y-4">
              <FormField label="Funding Source" required error={errors.fundingSource?.message}>
                <select id="fundingSource" {...fundingSourceRegistration} onChange={handleFundingSourceChange}>
                  {FUNDING_SOURCES.map((s) => (
                    <option key={s} value={s}>{FUNDING_SOURCE_LABELS[s]}</option>
                  ))}
                </select>
              </FormField>

              {/* FUND-02, via the INTAKE-07 engine: NDIS shows the plan fields (current
                  behaviour); Other hides them and shows the specify field below instead —
                  "subsequent form content changing per source" per the backlog text. */}
              {isVisible('ndisNumber') && (
                <FormField label="NDIS Number">
                  <input id="ndisNumber" {...register('ndisNumber')} placeholder="e.g. 431234567" />
                </FormField>
              )}

              {isVisible('planStartDate') && (
                <FormField label="Plan Start Date">
                  <input id="planStartDate" type="date" {...register('planStartDate')} />
                </FormField>
              )}

              {isVisible('planEndDate') && (
                <FormField label="Plan End Date">
                  <input id="planEndDate" type="date" {...register('planEndDate')} />
                </FormField>
              )}

              {isVisible('planType') && (
                <FormField label="Plan Type" required error={errors.planType?.message}>
                  <Controller
                    control={control}
                    name="planType"
                    render={({ field }) => (
                      <Dropdown
                        id="planType"
                        variant="form"
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        items={[
                          { value: 'SelfManaged', label: 'Self Managed' },
                          { value: 'PlanManaged', label: 'Plan Managed' },
                          { value: 'AgencyManaged', label: 'Agency Managed' },
                        ]}
                      />
                    )}
                  />
                </FormField>
              )}

              <FormField label="Region">
                <input id="region" {...register('region')} placeholder="e.g. QLD" />
              </FormField>

              {isVisible('fundingOrganisation') && (
                <FormField label="Funding Organisation" required error={errors.fundingOrganisation?.message}>
                  <input id="fundingOrganisation" {...register('fundingOrganisation')} placeholder="e.g. Plan Partners" />
                </FormField>
              )}

              <FormField label="Repeat Client" layout="checkbox">
                <input id="isRepeatClient" type="checkbox" {...register('isRepeatClient')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>

              {/* INTAKE sub-wave A, NDIS-006 — labelled in full with the acronym per the
                  research spec. */}
              <FormField label="Disability Support for Older Australians (DSOA)" layout="checkbox">
                <input id="isDsoa" type="checkbox" {...register('isDsoa')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>
            </Card>

            <Card title="Service Streams" className="space-y-4">
              <fieldset className="m-0 p-0 border-0">
                <legend className="sr-only">Service Streams</legend>
                <Controller
                  control={control}
                  name="serviceStreams"
                  render={({ field }) => (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                      {SERVICE_STREAMS.map((stream) => {
                        const selected = field.value ?? []
                        const checked = selected.includes(stream)
                        return (
                          <label key={stream} className="flex items-center gap-3 py-1 min-h-[44px]">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                field.onChange(
                                  e.target.checked
                                    ? [...selected, stream]
                                    : selected.filter((v) => v !== stream)
                                )
                              }}
                              className="w-4 h-4 rounded border-[var(--color-border)]"
                            />
                            <span className="text-sm text-[var(--color-foreground)]">{SERVICE_STREAM_LABELS[stream]}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                />
              </fieldset>
            </Card>
          </div>
        )}

        {/* INTAKE sub-wave A — "Key Identifiers" step (research spec §4.4/§5), placed after
            "NDIS & Funding" and before "Contacts" — see STEP_KEY_IDENTIFIERS_FIELDS' doc. Every
            field optional; expiries are date inputs, weight/height are numeric with
            unit-labelled fields. */}
        {stepIndex === 2 && (
          <div className="grid md:grid-cols-2 gap-6">
            <Card title="Identification Cards" className="space-y-4">
              <FormField label="Pension Card Number">
                <input id="pensionCardNumber" {...register('pensionCardNumber')} placeholder="e.g. PCN1029384" />
              </FormField>
              <FormField label="Pension Card Expiry">
                <input id="pensionCardExpiry" type="date" {...register('pensionCardExpiry')} />
              </FormField>

              <FormField label="Medicare Number">
                <input id="medicareNumber" {...register('medicareNumber')} placeholder="e.g. 2951 12345 1" />
              </FormField>
              <FormField label="Medicare Expiry">
                <input id="medicareExpiry" type="date" {...register('medicareExpiry')} />
              </FormField>

              <FormField label="Companion Card Number">
                <input id="companionCardNumber" {...register('companionCardNumber')} placeholder="e.g. CC-58213" />
              </FormField>
              <FormField label="Companion Card Expiry">
                <input id="companionCardExpiry" type="date" {...register('companionCardExpiry')} />
              </FormField>
            </Card>

            <Card title="Private Health & Taxi Card" className="space-y-4">
              <FormField label="Private Health Fund">
                <input id="privateHealthFund" {...register('privateHealthFund')} placeholder="e.g. Bupa" />
              </FormField>
              <FormField label="Private Health Membership Number">
                <input id="privateHealthMembershipNumber" {...register('privateHealthMembershipNumber')} placeholder="e.g. BUP-773421" />
              </FormField>

              <FormField label="Taxi Card Number">
                <input id="taxiCardNumber" {...register('taxiCardNumber')} placeholder="e.g. TC-90211" />
              </FormField>
            </Card>

            <Card title="Physical Description" className="space-y-4">
              <FormField label="Hair Colour">
                <input id="hairColour" {...register('hairColour')} placeholder="e.g. Brown" />
              </FormField>
              <FormField label="Eye Colour">
                <input id="eyeColour" {...register('eyeColour')} placeholder="e.g. Blue" />
              </FormField>
              <FormField label="Weight (kg)" error={errors.weightKg?.message}>
                <input id="weightKg" type="number" min="0" max="999.99" step="0.1" {...register('weightKg')} placeholder="e.g. 78.5" />
              </FormField>
              <FormField label="Height (cm)" error={errors.heightCm?.message}>
                <input id="heightCm" type="number" min="0" max="999.99" step="0.1" {...register('heightCm')} placeholder="e.g. 179" />
              </FormField>
            </Card>
          </div>
        )}

        {/* CONTACT-02 — the Contacts step, placed after NDIS & Funding since available role
            types depend on the funding/plan-type answers captured there (plus, for Plan Nominee,
            the date of birth captured on the Identity step) — see STEP_CONTACTS_FIELDS' doc. */}
        {stepIndex === 3 && (
          <div className="grid md:grid-cols-1 gap-6">
            {isEdit ? (
              <Card title="Contacts" className="space-y-3">
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  Contacts are managed from the{' '}
                  <Link to={`/participants/${id}?tab=contacts`} className="text-[var(--color-primary)] hover:underline">
                    Contacts tab
                  </Link>{' '}
                  on this participant's detail page.
                </p>
              </Card>
            ) : (
              <Card title="Contacts" className="space-y-3">
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  Add next of kin, guardians, support coordinators, plan managers, and other key
                  contacts. Optional here — richer per-role details (e.g. a guardian's tribunal
                  order, a nominee's scope) can be filled in from the Contacts tab after saving.
                </p>
                {contactRoleFields.length > 0 && (
                  <div className="space-y-3">
                    {contactRoleFields.map((field, index) => {
                      const row = watchedValues.contactRoles?.[index]
                      const rowRoleType = (row?.roleType as ContactRoleType | undefined) ?? 'NextOfKin'
                      const available = availableContactRoleTypes(CONTACT_ROLE_TYPES, watchedValues.planType as PlanType | undefined, watchedValues.dateOfBirth)
                      const gateError = contactRoleGateError(rowRoleType, watchedValues.planType as PlanType | undefined, watchedValues.dateOfBirth)
                      return (
                        <div key={field.id} className="p-3 rounded-lg border border-[var(--color-border)] space-y-3">
                          <div className="flex items-start gap-2">
                            <div className="flex-1 space-y-3">
                              <FormField label="Person" className="mb-0">
                                <ToggleGroup
                                  options={[
                                    { key: 'existing', label: 'Existing person' },
                                    { key: 'new', label: 'New person' },
                                  ]}
                                  value={row?.personMode ?? 'existing'}
                                  onChange={mode => setValue(`contactRoles.${index}.personMode` as const, mode as 'existing' | 'new', { shouldDirty: true })}
                                  // Same pre-existing FormField+ToggleGroup labelling gap as
                                  // YesNoToggleField (see ToggleGroup.tsx's ariaLabel doc) — a
                                  // bare ToggleGroup doesn't read aria-labelledby either, so it
                                  // needs its own accessible name passed through directly too.
                                  ariaLabel="Person"
                                />
                              </FormField>

                              {(row?.personMode ?? 'existing') === 'existing' ? (
                                <FormField
                                  label="Select person"
                                  required
                                  error={errors.contactRoles?.[index]?.personId?.message}
                                  className="mb-0"
                                >
                                  <Controller
                                    control={control}
                                    name={`contactRoles.${index}.personId` as const}
                                    render={({ field: personField }) => (
                                      <SearchableSelect
                                        value={personField.value ?? ''}
                                        onChange={personField.onChange}
                                        onBlur={personField.onBlur}
                                        items={people.map(p => ({ value: p.id, label: p.fullName, description: p.organisation ?? undefined }))}
                                        placeholder="Search people…"
                                        emptyMessage="No people yet — add a new person instead"
                                      />
                                    )}
                                  />
                                </FormField>
                              ) : (
                                <div className="grid grid-cols-2 gap-3">
                                  <FormField
                                    label="First name"
                                    required
                                    error={errors.contactRoles?.[index]?.newPersonFirstName?.message}
                                    className="mb-0"
                                  >
                                    <input {...register(`contactRoles.${index}.newPersonFirstName` as const)} />
                                  </FormField>
                                  <FormField label="Last name" className="mb-0">
                                    <input {...register(`contactRoles.${index}.newPersonLastName` as const)} />
                                  </FormField>
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => removeContactRole(index)}
                              aria-label={`Remove contact ${index + 1}`}
                              title="Remove contact"
                              className="mt-6 p-1.5 min-w-[44px] min-h-[44px] rounded-lg text-[var(--color-muted-foreground)] hover:bg-[var(--color-destructive)]/10 hover:text-[var(--color-destructive)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <FormField label="Role type" className="mb-0" hint={gateError ?? undefined}>
                              <Dropdown
                                variant="form"
                                value={rowRoleType}
                                onChange={v => setValue(`contactRoles.${index}.roleType` as const, v as ContactRoleType, { shouldDirty: true })}
                                items={CONTACT_ROLE_TYPES.map(rt => ({
                                  value: rt, label: CONTACT_ROLE_TYPE_LABELS[rt],
                                  disabled: !available.includes(rt) && rt !== rowRoleType,
                                }))}
                              />
                            </FormField>
                            <FormField label="Relationship to participant" className="mb-0">
                              <input {...register(`contactRoles.${index}.relationshipToParticipant` as const)} placeholder="e.g. Mother" />
                            </FormField>
                          </div>
                          {gateError && (
                            <p role="alert" className="text-xs text-[var(--color-destructive)]">{gateError}</p>
                          )}
                          <FormField label="Primary" layout="checkbox" className="mb-0">
                            <input type="checkbox" {...register(`contactRoles.${index}.isPrimary` as const)} className="w-4 h-4 rounded border-[var(--color-border)]" />
                          </FormField>
                        </div>
                      )
                    })}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => appendContactRole({ personMode: 'existing', personId: '', newPersonFirstName: '', newPersonLastName: '', roleType: availableContactRoleTypes(CONTACT_ROLE_TYPES, watchedValues.planType as PlanType | undefined, watchedValues.dateOfBirth)[0] ?? 'NextOfKin', relationshipToParticipant: '', isPrimary: false })}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-3 text-sm font-medium text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-lg"
                >
                  <Plus className="w-4 h-4" /> Add contact
                </button>
              </Card>
            )}
          </div>
        )}

        {/* INTAKE sub-wave B — "Cultural & Consent" step. Placed immediately after Contacts (see
            WIZARD_STEPS' doc). The old "Risks & Consents" step carried no consent content at all
            (just Behaviour Risk Summary/General Notes/INTAKE-09 risk entries) — renamed to
            "Risks & Hazards" below rather than moved from, since there was nothing to move. */}
        {stepIndex === 4 && (
          <div className="grid md:grid-cols-2 gap-6">
            <Card title="Cultural Background" className="space-y-4">
              <YesNoToggleField control={control} name="isCald" label="Culturally and Linguistically Diverse (CALD)" />
              <YesNoToggleField control={control} name="isLgbtqi" label="LGBTIQA+" />
              <YesNoToggleField control={control} name="isFamilyCommunity" label="Family / Community" />
              <YesNoToggleField control={control} name="isAboriginalOrTorresStraitIslander" label="Aboriginal and/or Torres Strait Islander" />
            </Card>

            <Card title="Information Received" className="space-y-4">
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Has the participant (or their representative) received and understood the following?
              </p>
              <YesNoToggleField control={control} name="receivedRightsAndResponsibilitiesInfo" label="Rights and Responsibilities" />
              <YesNoToggleField control={control} name="receivedPrivacyAndConfidentialityInfo" label="Privacy and Confidentiality" />
              <YesNoToggleField control={control} name="receivedFeedbackInfo" label="Feedback Information and Form" />
              <YesNoToggleField control={control} name="receivedBeingSafeInfo" label="Being Safe Information" />
              <YesNoToggleField control={control} name="receivedAdvocacyInfo" label="Advocacy Information" />
            </Card>

            <Card title="Personal Interests & Choice and Control" className="space-y-4 md:col-span-2">
              <FormField label="Personal Interests">
                <textarea id="personalInterests" {...register('personalInterests')} rows={3} placeholder="Hobbies, interests, things this participant enjoys..." />
              </FormField>
              <FormField label="Choice & Control Notes">
                <textarea id="choiceControlNotes" {...register('choiceControlNotes')} rows={3} placeholder="Support areas, goals, and preferences for choice and control..." />
              </FormField>
            </Card>

            <Card title="Consent & Terms" className="space-y-4 md:col-span-2">
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Record each consent decision below. Signed-by name and date appear once a consent is granted.
              </p>
              <div className="space-y-3">
                {CONSENT_TYPES.map((type, index) => {
                  const granted = watchedValues.consents?.[index]?.granted
                  return (
                    <div key={type} className="p-3 rounded-lg border border-[var(--color-border)] space-y-3">
                      {/* Reuses the same YesNoToggleField as the cultural/rights flags above —
                          gives this row a real accessible name via ToggleGroup's ariaLabel (see
                          YesNoToggleField's own comment: FormField's cloneElement can't reach
                          through the Controller wrapper, so ariaLabel is what actually carries
                          the name here) rather than a bare unlabelled ToggleGroup next to a plain
                          <span>. */}
                      <YesNoToggleField control={control} name={`consents.${index}.granted` as FieldPath<ParticipantFormData>} label={CONSENT_TYPE_LABELS[type as ConsentType]} />
                      {/* Local conditional render, not the INTAKE-07 conditionalFields engine: that
                          engine's ConditionalFieldDef contract targets named whole-form fields, not
                          per-row paths inside a fixed 7-row array — a narrower, per-row condition
                          that's simpler to express inline here than as a whole-form declarative def
                          (and this array is never user-add/remove, unlike riskEntries/contactRoles,
                          so there's no dynamic-row-count concern either way). */}
                      {granted === 'true' && (
                        <div className="grid grid-cols-2 gap-3">
                          <FormField label="Signed by" className="mb-0">
                            <input {...register(`consents.${index}.signedByName` as const)} placeholder="Full name" />
                          </FormField>
                          <FormField label="Date signed" className="mb-0">
                            <input type="date" {...register(`consents.${index}.signedDate` as const)} />
                          </FormField>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>
        )}

        {stepIndex === 5 && (
          <div className="grid md:grid-cols-2 gap-6">
            <Card title="Support Needs" className="space-y-4">
              <FormField label="High Support" layout="checkbox">
                <input id="isHighSupport" type="checkbox" {...register('isHighSupport')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>

              <FormField label="Intensive Support (NDIS billing)" layout="checkbox">
                <input id="isIntensiveSupport" type="checkbox" {...register('isIntensiveSupport')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>

              <FormField label="Support Ratio" required error={errors.supportRatio?.message}>
                <Controller
                  control={control}
                  name="supportRatio"
                  render={({ field }) => (
                    <Dropdown
                      id="supportRatio"
                      variant="form"
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      items={[
                        { value: 'SharedSupport', label: 'Shared Support' },
                        { value: 'OneToOne', label: '1:1' },
                        { value: 'OneToTwo', label: '1:2' },
                        { value: 'TwoToOne', label: '2:1' },
                        { value: 'Other', label: 'Other' },
                      ]}
                    />
                  )}
                />
              </FormField>
            </Card>

            <Card title="Mobility Aids & Support" className="space-y-4">
              <fieldset className="m-0 p-0 border-0">
                <legend className={labelClass}>Mobility Aids</legend>
                <div>
                  <FormField label="Wheelchair" layout="checkbox">
                    <input id="mobilityAidWheelchair" type="checkbox" {...register('mobilityAidWheelchair')} className="w-4 h-4 rounded border-[var(--color-border)]" />
                  </FormField>
                  <FormField label="Walker" layout="checkbox">
                    <input id="mobilityAidWalker" type="checkbox" {...register('mobilityAidWalker')} className="w-4 h-4 rounded border-[var(--color-border)]" />
                  </FormField>
                </div>
              </fieldset>

              <fieldset className="m-0 p-0 border-0">
                <legend className={labelClass}>Mobility Support</legend>
                <Controller
                  control={control}
                  name="mobilitySupportOptions"
                  render={({ field }) => (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                      {MOBILITY_SUPPORT_OPTIONS.map((option) => {
                        const selected = field.value ?? []
                        const checked = selected.includes(option)
                        return (
                          <label key={option} className="flex items-center gap-3 py-1 min-h-[44px]">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                field.onChange(
                                  e.target.checked
                                    ? [...selected, option]
                                    : selected.filter((v) => v !== option)
                                )
                              }}
                              className="w-4 h-4 rounded border-[var(--color-border)]"
                            />
                            <span className="text-sm text-[var(--color-foreground)]">{option}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                />
              </fieldset>
            </Card>

            <Card title="Overnight Support" className="space-y-4">
              <FormField label="Overnight Support">
                <select id="overnightSupport" {...register('overnightSupport')}>
                  {OVERNIGHT_SUPPORT_TYPES.map((type) => (
                    <option key={type} value={type}>{OVERNIGHT_SUPPORT_LABELS[type]}</option>
                  ))}
                </select>
              </FormField>

              {overnightSupportValue !== 'None' && (
                <FormField label="Overnight Ratio">
                  <select id="overnightRatio" {...register('overnightRatio')}>
                    {SUPPORT_RATIOS.map((ratio) => (
                      <option key={ratio} value={ratio}>{OVERNIGHT_RATIO_LABELS[ratio]}</option>
                    ))}
                  </select>
                </FormField>
              )}
            </Card>

            <Card title="Equipment" className="space-y-4">
              <fieldset className="m-0 p-0 border-0 space-y-4">
                {/* Card already renders a visible "Equipment" heading above; this legend exists
                    only to give the fieldset an accessible group name for screen readers. */}
                <legend className="sr-only">Equipment</legend>
                <FormField label="Hi-Lo Bed" layout="checkbox">
                  <input id="requiresHiLoBed" type="checkbox" {...register('requiresHiLoBed')} className="w-4 h-4 rounded border-[var(--color-border)]" />
                </FormField>

                <FormField label="Hoist" layout="checkbox">
                  <input id="requiresHoist" type="checkbox" {...register('requiresHoist')} className="w-4 h-4 rounded border-[var(--color-border)]" />
                </FormField>

                <FormField label="Shower Chair" layout="checkbox">
                  <input id="requiresShowerChair" type="checkbox" {...register('requiresShowerChair')} className="w-4 h-4 rounded border-[var(--color-border)]" />
                </FormField>

                <FormField label="Commode" layout="checkbox">
                  <input id="requiresCommode" type="checkbox" {...register('requiresCommode')} className="w-4 h-4 rounded border-[var(--color-border)]" />
                </FormField>

                <FormField label="Standing Machine" layout="checkbox">
                  <input id="requiresStandingMachine" type="checkbox" {...register('requiresStandingMachine')} className="w-4 h-4 rounded border-[var(--color-border)]" />
                </FormField>
              </fieldset>
            </Card>

            <Card title="Support Notes" className="space-y-4">
              <FormField label="Mobility Notes">
                <textarea id="mobilityNotes" {...register('mobilityNotes')} rows={2} placeholder="Any mobility considerations..." />
              </FormField>

              <FormField
                label="Equipment Requirements"
                error={errors.equipmentRequirements?.message}
                hint={!hasAnyEquipment ? 'Select at least one equipment option above to enable notes.' : undefined}
              >
                <textarea
                  id="equipmentRequirements"
                  {...register('equipmentRequirements')}
                  rows={2}
                  placeholder="Required equipment..."
                  readOnly={!hasAnyEquipment}
                  aria-disabled={!hasAnyEquipment}
                  title={!hasAnyEquipment ? 'Select at least one equipment option above to enable notes.' : undefined}
                  className={!hasAnyEquipment ? 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)] cursor-not-allowed' : undefined}
                />
              </FormField>

              <FormField label="Transport Requirements">
                <textarea id="transportRequirements" {...register('transportRequirements')} rows={2} placeholder="Transport needs..." />
              </FormField>
            </Card>
          </div>
        )}

        {stepIndex === 6 && (
          <div className="grid md:grid-cols-2 gap-6">
            <Card title="Diagnoses" className="space-y-4">
              <FormField label="Primary Diagnosis">
                <select id="primaryDiagnosis" {...register('primaryDiagnosis')}>
                  <option value="">Select a diagnosis...</option>
                  {DIAGNOSIS_OPTIONS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                  <option value={DIAGNOSIS_OTHER_SENTINEL}>{DIAGNOSIS_OTHER_SENTINEL}</option>
                </select>
              </FormField>

              {isVisible('primaryDiagnosisOther') && (
                <FormField label="Specify Primary Diagnosis" required error={errors.primaryDiagnosisOther?.message}>
                  <input id="primaryDiagnosisOther" {...register('primaryDiagnosisOther')} placeholder="e.g. Rett Syndrome" />
                </FormField>
              )}

              <fieldset className="m-0 p-0 border-0">
                <legend className={labelClass}>Other Diagnoses</legend>
                <Controller
                  control={control}
                  name="otherDiagnoses"
                  render={({ field }) => {
                    const selected = field.value ?? []
                    const curated: readonly string[] = DIAGNOSIS_OPTIONS
                    const customEntries = selected.filter((d) => !curated.includes(d))
                    return (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                          {DIAGNOSIS_OPTIONS.map((option) => {
                            const checked = selected.includes(option)
                            return (
                              <label key={option} className="flex items-center gap-3 py-1 min-h-[44px]">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    field.onChange(
                                      e.target.checked
                                        ? [...selected, option]
                                        : selected.filter((v) => v !== option)
                                    )
                                  }}
                                  className="w-4 h-4 rounded border-[var(--color-border)]"
                                />
                                <span className="text-sm text-[var(--color-foreground)]">{option}</span>
                              </label>
                            )
                          })}
                        </div>

                        {customEntries.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {customEntries.map((entry) => (
                              <span
                                key={entry}
                                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
                              >
                                {entry}
                                <button
                                  type="button"
                                  aria-label={`Remove ${entry}`}
                                  onClick={() => field.onChange(selected.filter((v) => v !== entry))}
                                  className="min-w-[20px] min-h-[20px] leading-none font-bold hover:text-[var(--color-foreground)]"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <input
                            id="otherDiagnosesCustomInput"
                            aria-label="Other — specify a diagnosis to add"
                            value={customDiagnosisInput}
                            onChange={(e) => setCustomDiagnosisInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter') return
                              e.preventDefault()
                              const value = customDiagnosisInput.trim()
                              if (value && !selected.includes(value)) field.onChange([...selected, value])
                              setCustomDiagnosisInput('')
                            }}
                            placeholder={DIAGNOSIS_OTHER_SENTINEL}
                            className="flex-1"
                          />
                          <button
                            type="button"
                            className="px-3 min-h-[44px] rounded-lg border border-[var(--color-border)] text-sm font-medium hover:bg-[var(--color-accent)] transition-colors"
                            onClick={() => {
                              const value = customDiagnosisInput.trim()
                              if (value && !selected.includes(value)) field.onChange([...selected, value])
                              setCustomDiagnosisInput('')
                            }}
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    )
                  }}
                />
              </fieldset>
            </Card>

            <Card title="HIDPA Support Categories" className="space-y-4">
              <p className="text-sm text-[var(--color-muted-foreground)]">
                High Intensity Daily Personal Activities support categories. An Epilepsy diagnosis
                pre-selects Epilepsy and Seizure Management below by default — untick it if the
                formal high-intensity support isn't needed.
              </p>
              <fieldset className="m-0 p-0 border-0">
                <legend className="sr-only">HIDPA Support Categories</legend>
                <Controller
                  control={control}
                  name="hidpaSupportCategories"
                  render={({ field }) => (
                    <div className="grid grid-cols-1 gap-x-4">
                      {HIDPA_SUPPORT_CATEGORIES.map((category) => {
                        const selected = field.value ?? []
                        const checked = selected.includes(category)
                        return (
                          <label
                            key={category}
                            className="flex items-center gap-3 py-1 min-h-[44px]"
                            title={HIDPA_CATEGORY_TITLES[category]}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                field.onChange(
                                  e.target.checked
                                    ? [...selected, category]
                                    : selected.filter((v) => v !== category)
                                )
                              }}
                              className="w-4 h-4 rounded border-[var(--color-border)]"
                            />
                            <span className="text-sm text-[var(--color-foreground)]">{HIDPA_CATEGORY_LABELS[category]}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                />
              </fieldset>
            </Card>

            <Card title="Medical" className="space-y-4 md:col-span-2">
              <FormField label="Medical Summary">
                <textarea id="medicalSummary" {...register('medicalSummary')} rows={4} placeholder="Medical information..." />
              </FormField>
            </Card>
          </div>
        )}

        {stepIndex === 7 && (
          <div className="grid md:grid-cols-2 gap-6">
            <Card title="Risks & Hazards" className="space-y-4">
              {isEdit && existing?.hasRestrictivePracticeFlag && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-1.5">
                  <span className="material-symbols-outlined text-base leading-none text-amber-500">warning</span>
                  <p className="text-sm text-amber-900">
                    Restrictive practice flag — derived from an active entry in the participant's Restrictive Practices register (see that tab). It can no longer be set here directly.
                  </p>
                </div>
              )}

              <FormField label="Behaviour Risk Summary">
                <textarea id="behaviourRiskSummary" {...register('behaviourRiskSummary')} rows={3} placeholder="Behaviour risk notes..." />
              </FormField>

              <FormField label="General Notes">
                <textarea id="notes" {...register('notes')} rows={3} placeholder="Any additional notes..." />
              </FormField>
            </Card>

            {/* INTAKE-09 — repeatable risk-entry rows, categorised by who is at risk. Create-mode
                only: the wizard submits one participant payload, so rows entered here are created
                transactionally with the participant (CreateParticipantDto.riskEntries). Once a
                participant exists, risk entries are instead managed via the nested CRUD on the
                detail page's Risks section (RiskEntriesSection) — mirroring how Routines' own tab
                works for its own entity — so this block doesn't render in edit mode at all. */}
            {isEdit ? (
              <Card title="Risk Entries" className="space-y-3">
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  Risk entries are managed from the{' '}
                  <Link to={`/participants/${id}`} className="text-[var(--color-primary)] hover:underline">
                    Risks section
                  </Link>{' '}
                  on this participant's detail page.
                </p>
              </Card>
            ) : (
              <Card title="Risk Entries" className="space-y-3">
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  Capture potential risks in supporting this participant, categorised by who is at
                  risk. Optional — add a row for each risk identified at intake.
                </p>
                {riskEntryFields.length > 0 && (
                  <div className="space-y-3">
                    {riskEntryFields.map((field, index) => (
                      <div key={field.id} className="p-3 rounded-lg border border-[var(--color-border)] space-y-3">
                        <div className="flex items-start gap-2">
                          <FormField label="At Risk" className="flex-1 mb-0">
                            <select id={`riskEntries.${index}.atRiskParty`} {...register(`riskEntries.${index}.atRiskParty` as const)}>
                              {AT_RISK_PARTIES.map((party) => (
                                <option key={party} value={party}>{AT_RISK_PARTY_LABELS[party]}</option>
                              ))}
                            </select>
                          </FormField>
                          <button
                            type="button"
                            onClick={() => removeRiskEntry(index)}
                            aria-label={`Remove risk entry ${index + 1}`}
                            title="Remove risk entry"
                            className="mt-6 p-1.5 min-w-[44px] min-h-[44px] rounded-lg text-[var(--color-muted-foreground)] hover:bg-[var(--color-destructive)]/10 hover:text-[var(--color-destructive)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <FormField label="Description" required error={errors.riskEntries?.[index]?.description?.message} className="mb-0">
                          <textarea
                            id={`riskEntries.${index}.description`}
                            {...register(`riskEntries.${index}.description` as const)}
                            rows={2}
                            placeholder="Describe the risk..."
                          />
                        </FormField>
                        <FormField label="Mitigation Notes" className="mb-0">
                          <textarea
                            id={`riskEntries.${index}.mitigationNotes`}
                            {...register(`riskEntries.${index}.mitigationNotes` as const)}
                            rows={2}
                            placeholder="How this risk is mitigated (optional)..."
                          />
                        </FormField>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => appendRiskEntry({ atRiskParty: 'Participant', description: '', mitigationNotes: '' })}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-3 text-sm font-medium text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-lg"
                >
                  <Plus className="w-4 h-4" /> Add risk entry
                </button>
              </Card>
            )}
          </div>
        )}

        {stepIndex === REVIEW_STEP_INDEX && (
          <div className="grid md:grid-cols-2 gap-6">
            {reviewGroups.map((group) => (
              <Card
                key={group.step}
                title={WIZARD_STEPS[group.step].label}
                action={
                  <button
                    type="button"
                    onClick={() => goToStep(group.step)}
                    aria-label={`Edit ${WIZARD_STEPS[group.step].label}`}
                    className="min-h-[44px] px-2 -mr-2 text-sm font-medium text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-lg"
                  >
                    Edit
                  </button>
                }
                className="space-y-2"
              >
                <dl className="space-y-2 text-sm">
                  {group.rows.map((row) => (
                    <div key={row.label} className="flex justify-between gap-4">
                      <dt className="text-[var(--color-muted-foreground)]">{row.label}</dt>
                      <dd className="font-medium text-right min-w-0 break-words">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            ))}
          </div>
        )}

        {/* Wizard navigation */}
        <div className="md:col-span-2 flex flex-wrap justify-between items-center gap-3 mt-6">
          <div className="flex items-center gap-3">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={handleBack}
                className="px-6 py-2.5 min-h-[44px] rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                Back
              </button>
            )}
            {/* INTAKE-08 fix round 1 (Finding 1a, controller ruling): un-finalising is not a
                product capability — this button exists on create and on draft-resume only, never
                while editing an already-finalised participant (available on EVERY step of those
                two flows, not just Review). Mirrors the server-side rejection in
                ParticipantsController.Update (see its Finding 1b comment). */}
            {canSaveDraft && (
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={savingDraft || mutation.isPending}
                className="px-6 py-2.5 min-h-[44px] rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                {savingDraft ? 'Saving draft...' : 'Save as draft'}
              </button>
            )}
          </div>
          <div className="flex justify-end gap-3">
            {stepIndex < REVIEW_STEP_INDEX && (
              <button
                type="button"
                onClick={handleNext}
                className="px-6 py-2.5 min-h-[44px] rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-[var(--color-primary)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                Next
              </button>
            )}
            {stepIndex === REVIEW_STEP_INDEX && (
              <>
                <Link to="/participants" className="px-6 py-2.5 min-h-[44px] flex items-center rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]">
                  Cancel
                </Link>
                <button type="submit" disabled={mutation.isPending}
                  className="px-6 py-2.5 min-h-[44px] rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all shadow-md shadow-[var(--color-primary)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]">
                  {mutation.isPending ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Participant')}
                </button>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
