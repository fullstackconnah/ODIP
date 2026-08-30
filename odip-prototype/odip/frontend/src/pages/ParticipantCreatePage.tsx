import { useNavigate, useParams, Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, useWatch, Controller, type Resolver, type FieldErrors } from 'react-hook-form'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { z } from 'zod'
import { useCreateParticipant, useUpdateParticipant, useParticipant, useStaff } from '@/api/hooks'
import { ArrowLeft, Check } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'
import { FormField, labelClass } from '@/components/FormField'
import { Card } from '@/components/Card'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { OVERNIGHT_SUPPORT_TYPES, SUPPORT_RATIOS, SERVICE_STREAMS, GENDERS, FUNDING_SOURCES, LIVING_ARRANGEMENTS, AU_STATES } from '@/api/types/enums'
import type { SupportRatio, OvernightSupportType, ServiceStream, Gender, FundingSource, LivingArrangement } from '@/api/types/enums'
import { MOBILITY_SUPPORT_OPTIONS, OVERNIGHT_SUPPORT_LABELS, OVERNIGHT_RATIO_LABELS, SERVICE_STREAM_LABELS, GENDER_LABELS, FUNDING_SOURCE_LABELS, LIVING_ARRANGEMENT_LABELS, parseServiceStreams, formatServiceStreams } from '@/api/types/participants'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import {
  useConditionalFields, useUnregisterHiddenFields, useFocusFallbackOnHide, stripHiddenFieldKeys,
  type ConditionalFieldDef, type ConditionPredicate,
} from '@/lib/conditionalFields'

const baseParticipantSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  preferredName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  genderSelfDescription: z.string().optional(),
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
  medicalSummary: z.string().optional(),
  behaviourRiskSummary: z.string().optional(),
  notes: z.string().optional(),
  preferredStaffId: z.string().optional().nullable(),
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

const participantSchema = baseParticipantSchema
  .superRefine(equipmentRefine)
  .superRefine(genderRefine)
  .superRefine(fundingSourceRefine)
  .superRefine(livingArrangementRefine)
  .superRefine(addressPostcodeRefine)

// @hookform/resolvers 3.x's zodResolver reads ZodError.errors (a getter zod v4 removed in
// favour of .issues), so it throws past react-hook-form instead of populating
// formState.errors on validation failure. Resolve directly against zod's safeParse/.issues
// API instead of routing through that resolver.
const participantResolver: Resolver<ParticipantFormData> = (values) => {
  const result = participantSchema.safeParse(values)
  if (result.success) return { values: result.data, errors: {} }
  const errors: FieldErrors<ParticipantFormData> = {}
  for (const issue of result.error.issues) {
    const field = String(issue.path[0]) as keyof ParticipantFormData
    if (!errors[field]) errors[field] = { type: issue.code, message: issue.message }
  }
  return { values: {}, errors }
}

function pickShape<T extends readonly (keyof ParticipantFormData)[]>(fields: T) {
  return Object.fromEntries(fields.map((f) => [f, true])) as { [K in T[number]]: true }
}

function focusField(fieldName: string) {
  const el = document.getElementById(fieldName)
  if (el instanceof HTMLElement) el.focus()
}

// Living arrangements (LIVING-01..04) and address (INTAKE-06) live on the Identity step rather
// than a new wizard step or the Support Needs step: neither depends on funding/support-need
// answers, and where/how a participant lives is core identity/intake context — putting them here
// avoids inserting a step, which would renumber every later step and break every test that
// assumes the current step order (see the Wave-3 report for the fuller reasoning).
const STEP_IDENTITY_FIELDS = [
  'firstName', 'lastName', 'preferredName', 'dateOfBirth', 'gender', 'genderSelfDescription', 'preferredStaffId',
  'addressStreet', 'addressSuburb', 'addressState', 'addressPostcode',
  'livingArrangement', 'mainSupportPersonName', 'mainSupportPersonRelationship', 'othersLivingInAccommodation', 'residentialInfo',
  'livesWithOthers', 'whoLivesWith',
  'silProviderName', 'silProviderContactPhone', 'accommodationType', 'onSiteSupportHours',
  'livingArrangementNotes',
] as const
const STEP_NDIS_FIELDS = ['ndisNumber', 'planStartDate', 'planEndDate', 'planType', 'region', 'fundingSource', 'fundingOrganisation', 'isRepeatClient', 'serviceStreams'] as const
const STEP_SUPPORT_FIELDS = [
  'isHighSupport', 'isIntensiveSupport', 'supportRatio',
  'mobilityAidWheelchair', 'mobilityAidWalker', 'mobilitySupportOptions',
  'overnightSupport', 'overnightRatio',
  'requiresHiLoBed', 'requiresHoist', 'requiresShowerChair', 'requiresCommode', 'requiresStandingMachine',
  'mobilityNotes', 'equipmentRequirements', 'transportRequirements',
] as const
const STEP_MEDICAL_FIELDS = ['medicalSummary'] as const
const STEP_RISK_FIELDS = ['behaviourRiskSummary', 'notes'] as const
const STEP_REVIEW_FIELDS = [] as const

type WizardStep = {
  key: string
  label: string
  fields: readonly (keyof ParticipantFormData)[]
}

const WIZARD_STEPS: WizardStep[] = [
  { key: 'identity', label: 'Identity & Contacts', fields: STEP_IDENTITY_FIELDS },
  { key: 'ndis', label: 'NDIS & Funding', fields: STEP_NDIS_FIELDS },
  { key: 'support', label: 'Support Needs & Equipment', fields: STEP_SUPPORT_FIELDS },
  { key: 'medical', label: 'Medical', fields: STEP_MEDICAL_FIELDS },
  { key: 'risks', label: 'Risks & Consents', fields: STEP_RISK_FIELDS },
  { key: 'review', label: 'Review', fields: STEP_REVIEW_FIELDS },
]
const REVIEW_STEP_INDEX = WIZARD_STEPS.length - 1

// Per-step schemas driving "Next" validation — derived from the same base schema/refine
// used by the final-submit resolver above, via zod's .pick(), so a step only ever validates
// the fields it owns. The Review step (index REVIEW_STEP_INDEX) has no schema — it has no
// inputs of its own, so there is nothing to validate before landing on it besides the
// preceding step.
const STEP_SCHEMAS: (z.ZodTypeAny | null)[] = [
  baseParticipantSchema.pick(pickShape(STEP_IDENTITY_FIELDS)).superRefine(genderRefine).superRefine(livingArrangementRefine).superRefine(addressPostcodeRefine),
  baseParticipantSchema.pick(pickShape(STEP_NDIS_FIELDS)).superRefine(fundingSourceRefine),
  baseParticipantSchema.pick(pickShape(STEP_SUPPORT_FIELDS)).superRefine(equipmentRefine),
  baseParticipantSchema.pick(pickShape(STEP_MEDICAL_FIELDS)),
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
      planType: 'SelfManaged',
      supportRatio: 'SharedSupport',
      isRepeatClient: false,
      serviceStreams: [],
      mobilityAidWheelchair: false,
      mobilityAidWalker: false,
      mobilitySupportOptions: [],
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
    },
  })

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
      let firstField: keyof ParticipantFormData | null = null
      for (const issue of result.error.issues) {
        const field = String(issue.path[0]) as keyof ParticipantFormData
        if (!firstField) firstField = field
        setError(field, { type: issue.code, message: issue.message })
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
  const { isVisible, hiddenFields } = useConditionalFields(watchedValues, CONDITIONAL_FIELDS)
  useUnregisterHiddenFields(unregister, hiddenFields)
  useFocusFallbackOnHide(CONDITIONAL_FIELDS, hiddenFields)

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
        dateOfBirth: existing.dateOfBirth ? existing.dateOfBirth.split('T')[0] : '',
        gender: existing.gender ?? '',
        genderSelfDescription: existing.genderSelfDescription ?? '',
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
        isRepeatClient: existing.isRepeatClient ?? false,
        serviceStreams: parseServiceStreams(existing.serviceStreams),
        mobilityAidWheelchair: existing.mobilityAidWheelchair ?? false,
        mobilityAidWalker: existing.mobilityAidWalker ?? false,
        mobilitySupportOptions: existing.mobilitySupportOptions ?? [],
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
      })
    }
  }, [existing, reset])

  const onSubmit = async (data: ParticipantFormData) => {
    // INTAKE-07: unregister-on-hide should already have dropped hidden fields' keys from `data`
    // (react-hook-form's default unregister options exclude them from validation AND from the
    // values object handleSubmit builds) — stripHiddenFieldKeys is the defence-in-depth pass
    // guaranteeing it regardless, per the engine's module doc.
    const payload: any = stripHiddenFieldKeys({ ...data }, hiddenFields)
    payload.serviceStreams = formatServiceStreams(data.serviceStreams as ServiceStream[] | undefined)
    for (const key of Object.keys(payload)) {
      if (payload[key] === '' || payload[key] === undefined) payload[key] = null
    }
    try {
      if (isEdit) {
        const res = await updateParticipant.mutateAsync({ id, data: { ...payload, isActive: existing?.isActive ?? true } })
        if (res.success) {
          // Clear isDirty synchronously (flushSync) before navigating so the
          // unsaved-changes blocker doesn't fire for this intentional navigation.
          flushSync(() => reset(data))
          navigate(`/participants/${id}`)
        }
      } else {
        const res = await createParticipant.mutateAsync(payload)
        if (res.success && res.data?.id) {
          flushSync(() => reset(data))
          navigate(`/participants/${res.data.id}`)
        }
      }
    } catch {
      // error handled by mutation state
    }
  }

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  if (isEdit && isLoadingExisting) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading...</div>

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
        { label: 'Date of Birth', value: watchedValues.dateOfBirth || '—' },
        {
          label: 'Gender',
          value: watchedValues.gender
            ? (GENDER_LABELS[watchedValues.gender as Gender] ?? watchedValues.gender)
              + (watchedValues.gender === 'Other' && watchedValues.genderSelfDescription ? ` (${watchedValues.genderSelfDescription})` : '')
            : '—',
        },
        { label: 'Preferred Staff Member', value: preferredStaffName },
        {
          label: 'Address',
          value: [watchedValues.addressStreet, watchedValues.addressSuburb, watchedValues.addressState, watchedValues.addressPostcode]
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
      step: 2,
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
      step: 3,
      rows: [
        { label: 'Medical Summary', value: watchedValues.medicalSummary || '—' },
      ],
    },
    {
      step: 4,
      rows: [
        { label: 'Behaviour Risk Summary', value: watchedValues.behaviourRiskSummary || '—' },
        { label: 'General Notes', value: watchedValues.notes || '—' },
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
      </div>

      {mutation.isError && (
        <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          Failed to {isEdit ? 'update' : 'create'} participant. Please check your input and try again.
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
            </Card>

            <Card title="Staff Preferences" className="space-y-4">
              <FormField label="Preferred Staff Member">
                <Controller
                  control={control}
                  name="preferredStaffId"
                  render={({ field }) => (
                    <Dropdown
                      id="preferredStaffId"
                      variant="form"
                      label="None"
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      searchable
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
                    {/* Free text for now — plausibly links to a future CONTACT-01 typed contact
                        rather than free text; CONTACT-01 isn't built yet (see Participant.cs). */}
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

        {stepIndex === 2 && (
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

        {stepIndex === 3 && (
          <div className="grid md:grid-cols-2 gap-6">
            <Card title="Medical" className="space-y-4">
              <FormField label="Medical Summary">
                <textarea id="medicalSummary" {...register('medicalSummary')} rows={4} placeholder="Medical information..." />
              </FormField>
            </Card>
          </div>
        )}

        {stepIndex === 4 && (
          <div className="grid md:grid-cols-2 gap-6">
            <Card title="Risks & Consents" className="space-y-4">
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
        <div className="md:col-span-2 flex justify-between items-center gap-3 mt-6">
          <div>
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={handleBack}
                className="px-6 py-2.5 min-h-[44px] rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                Back
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
