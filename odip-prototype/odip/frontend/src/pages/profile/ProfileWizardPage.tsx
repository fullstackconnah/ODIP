/**
 * PF-10.4 (SPEC-05 `docs/specs/odip-updates-2026-09/SPEC-05-intake-profile-split.md`) — the new
 * Profile wizard. Second half of the intake/profile split — edits an EXISTING participant (created
 * by the Intake wizard, PF-10.3), pre-filled via `useParticipant(id)`, saving via per-step
 * `PATCH /api/v1/participants/{id}` calls (core-02) rather than a single final submit.
 *
 * Field set: every `entryPhase: 'profile'` entry in `src/lib/documentMapping.ts`
 * (`fieldsForEntry('profile')`), re-grouped into 7 steps under `src/lib/participantSchema.ts`'s
 * `PROFILE_STEP_*_FIELDS` constants — see `ProfileWizardPage.test.tsx`'s "drift guard" describe
 * block for the guard that this wizard renders every one of those fields, renders every Shared
 * field (captured at Intake) as an editable, prefilled control, and renders no Intake-only field.
 *
 * Shared fields are EDITABLE here (`sharedFieldsEditable`, see `sharedFieldControls.tsx`): intake
 * answers are sometimes wrong. They are validated by `PROFILE_EDITABLE_STEP_SCHEMAS_BY_KEY` (the Intake
 * refines) and saved by the same per-step PATCH, whose step -> group map
 * (`PROFILE_WIZARD_STEP_TO_PATCH_GROUPS`) also carries the `address` and `risksHazardsSummary` groups
 * those fields live in. Contacts are edited in place by the embedded Contacts tab editor.
 *
 * Two independently-gated conditional regions (SPEC-05's generic `{key,label,fields,isVisible}`
 * shape, `PROFILE_CONDITIONAL_SECTIONS` in participantSchema.ts):
 *  - `communityAccess` — a whole wizard STEP, visible only when the participant's serviceStreams
 *    include `CommunityAccessDailyLiving`.
 *  - `holidaySta` — a SUB-BLOCK within the Cultural Depth/Consents step (4 consent types), visible
 *    only when serviceStreams include `STA`. Never deletes previously-recorded consent rows when
 *    the gate later closes (see participantPatchGroups.ts's filterConsentsForSave).
 *
 * Per-step save: each step's "Next" both zod-validates AND PATCHes that step's CORE-02 group(s)
 * (via the wizard shell's async `validate` hook — CORE-01 explicitly anticipates this) before
 * advancing, so a Profile can be completed across multiple sessions without losing earlier steps'
 * work. The final Review step's "Complete Profile" does one full `PUT` (isDraft=false) — see this
 * branch's report for why a `profileCompletedAt` timestamp (PF-10.5) is NOT set here: no backend
 * support for it exists yet on `main` (PF-10.5 hasn't landed) — flipping `IsDraft` via the existing
 * full-PUT path is the one part of PF-10.4's acceptance criteria achievable today.
 */
import { useNavigate, useParams } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, useFieldArray, useWatch } from 'react-hook-form'
import { useEffect, useMemo, useState } from 'react'
import { useParticipant, usePatchParticipant, useUpdateParticipant, useStaff, useUpsertCommunityAccessRiskItem } from '@/api/hooks'
import {
  useWizard, WizardStepRail, WizardNavFooter, WizardReviewStep, WizardStepHeading, WizardShell,
  REVIEW_STEP_KEY,
  type WizardStepDef, type WizardValidate, type ReviewGroup, type ReviewRow,
} from '@/components/wizard'
import { BackButton } from '@/components/BackButton'
import {
  type ParticipantFormData, PROFILE_EDITABLE_STEP_SCHEMAS_BY_KEY, PROFILE_STEP_SHARED_FIELDS, PROFILE_CONDITIONAL_SECTIONS,
  PROFILE_STEP_KEY_IDENTIFIERS_FIELDS, PROFILE_STEP_CULTURAL_DEPTH_FIELDS, PROFILE_STEP_MEDICAL_FIELDS,
  PROFILE_STEP_MOBILITY_FIELDS, PROFILE_STEP_BEHAVIOUR_FIELDS, PROFILE_STEP_DAILY_LIVING_FIELDS,
  PROFILE_STEP_COMMUNITY_ACCESS_FIELDS,
} from '@/lib/participantSchema'
import { buildProfileStepPatch, buildParticipantWirePayload, PROFILE_WIZARD_STEP_TO_PATCH_GROUPS } from '@/lib/participantPatchGroups'
import { parseServiceStreams, parseHidpaCategories, DIAGNOSIS_OPTIONS, DIAGNOSIS_OTHER_SENTINEL } from '@/api/types/participants'
import { CONSENT_TYPES, HEALTH_CONDITION_TYPES, ADL_TYPES, CHECKLIST_ITEM_TYPES, COMMUNITY_ACCESS_RISK_ITEM_TYPES } from '@/api/types/enums'
import { useDeriveFieldValues, type FieldDerivationDef } from '@/lib/conditionalFields'
import type { UpdateParticipantDto } from '@/api/types/participants'
import { boolToTriState, focusField, extractErrorMessage } from '../intake/intakeFormat'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { KeyIdentifiersStep } from './steps/KeyIdentifiersStep'
import { CulturalDepthConsentsStep } from './steps/CulturalDepthConsentsStep'
import { MedicalDetailStep } from './steps/MedicalDetailStep'
import { MobilityFunctionalStep } from './steps/MobilityFunctionalStep'
import { BehaviourCognitionStep } from './steps/BehaviourCognitionStep'
import { DailyLivingStep } from './steps/DailyLivingStep'
import { CommunityAccessStep } from './steps/CommunityAccessStep'
import { Card } from '@/components/Card'

const CA_SECTION = PROFILE_CONDITIONAL_SECTIONS.find((s) => s.key === 'communityAccess')!
const STA_SECTION = PROFILE_CONDITIONAL_SECTIONS.find((s) => s.key === 'holidaySta')!

// DIAG-02 (re-homed from the retired single-step wizard by PF-10.7): the epilepsy ->
// epilepsy-management HIDPA default, and the epilepsy -> health-conditions-grid "has" default.
// Both primaryDiagnosis/otherDiagnoses (DIAG-01) and hidpaSupportCategories/healthConditions
// (INTAKE sub-wave C1) are Profile-owned fields, both rendered together on this wizard's Medical
// Detail step, so both derivations are wired here — see conditionalFields.ts's VALUE DERIVATION
// doc for the full transition-only/user-override/edit-mode-safe semantics this relies on.
// INTAKE sub-wave C1: index of the Epilepsy row within the fixed healthConditions array — the
// array is always in HEALTH_CONDITION_TYPES order (see the reset() healthConditions mapping
// above), so this is a stable constant, not a runtime search per keystroke.
const EPILEPSY_CONDITION_INDEX = HEALTH_CONDITION_TYPES.indexOf('Epilepsy')

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
  // Epilepsy grid/diagnosis reconciliation: an Epilepsy diagnosis pre-selects the health-condition
  // grid's Epilepsy row's `has` to true, as a DEFAULT not a lock — only fires when that row is
  // still unanswered ('') — never overrides an explicit "No" the user already recorded.
  {
    when: (v) => v.primaryDiagnosis === 'Epilepsy' || !!v.otherDiagnoses?.includes('Epilepsy'),
    apply: (v, setValue) => {
      const rows = v.healthConditions as ParticipantFormData['healthConditions']
      const current = rows?.[EPILEPSY_CONDITION_INDEX]?.has
      if (current === '' || current === undefined) {
        setValue(`healthConditions.${EPILEPSY_CONDITION_INDEX}.has`, 'true', { shouldDirty: true })
      }
    },
  },
]

export default function ProfileWizardPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: participant, isLoading } = useParticipant(id)
  const patchParticipant = usePatchParticipant()
  const updateParticipant = useUpdateParticipant()
  const upsertRiskItem = useUpsertCommunityAccessRiskItem()
  const { data: staffList = [] } = useStaff()
  const activeStaff = staffList.filter((s) => s.isActive)

  const { register, handleSubmit, control, getValues, setValue, setError, clearErrors, reset, formState: { errors, isDirty } } = useForm<ParticipantFormData>({
    defaultValues: { consents: [], healthConditions: [], adlAssessments: [], checklistItems: [], communityAccessRiskItems: [] },
  })

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  const healthConditionFieldArray = useFieldArray({ control, name: 'healthConditions' })
  const adlFieldArray = useFieldArray({ control, name: 'adlAssessments' })
  const checklistFieldArray = useFieldArray({ control, name: 'checklistItems' })
  const consentsFieldArray = useFieldArray({ control, name: 'consents' })
  const riskItemsFieldArray = useFieldArray({ control, name: 'communityAccessRiskItems' })

  const [focusRequest, setFocusRequest] = useState<{ field: string } | null>(null)
  useEffect(() => {
    if (focusRequest) focusField(focusRequest.field)
  }, [focusRequest])

  // Guards useDeriveFieldValues' resetKey (below): `participant` itself changes identity from
  // undefined to a real object as soon as the query resolves, but `watchedValues` (useWatch)
  // still reflects the OLD/default form state for that same render — reset() only applies the
  // real data in the reset-effect below, whose resulting form-value change lands one render
  // later. Gating resetKey on `hydrated` (flipped true in that same reset-effect, right after
  // calling reset()) means resetKey and the reset() values it re-baselines against always change
  // together in the same render, so the derivation engine never mistakes "data just landed" for
  // a genuine user-driven false->true transition. The setState-in-effect this requires matches
  // the same accepted "sync local state from just-arrived external data" pattern already used by
  // SettingsPage.tsx/TenantFormPanel.tsx/UserFormPanel.tsx/BookingsTab.tsx in this codebase.
  const [hydrated, setHydrated] = useState(false)

  // Full round-trip — every field either wizard touches, both Shared/Intake-owned (read-only here,
  // but must still be echoed back on every PATCH group that carries one — see THE TRAP note in
  // participantPatchGroups.ts) and Profile-owned. Mirrors the retired single-step wizard's edit-mode
  // reset() conversions exactly (tri-state round-trip, fixed-grid materialize-all-N-rows, DIAG-01's
  // two-field diagnosis split) so a value saved by either wizard displays identically in this one.
  useEffect(() => {
    if (!participant) return
    // `as unknown as ...`: react-hook-form's DeepPartial helper doesn't recurse into array-of-object
    // fields (contactRoles/riskEntries), keeping their nested item shape non-optional — a spurious
    // mismatch against this literal's own (correctly non-optional-per-field) shape, not a real one.
    // Same cast the retired single-step wizard's own edit-mode reset() uses for the identical reason.
    reset({
      firstName: participant.firstName ?? '', lastName: participant.lastName ?? '',
      preferredName: participant.preferredName ?? '', middleName: participant.middleName ?? '',
      dateOfBirth: participant.dateOfBirth ? participant.dateOfBirth.split('T')[0] : '',
      gender: participant.gender ?? '', genderSelfDescription: participant.genderSelfDescription ?? '',
      placeOfBirth: participant.placeOfBirth ?? '', country: participant.country ?? '',
      phone: participant.phone ?? '', email: participant.email ?? '',
      addressStreet: participant.addressStreet ?? '', addressSuburb: participant.addressSuburb ?? '',
      addressState: participant.addressState ?? '', addressPostcode: participant.addressPostcode ?? '',
      preferredStaffId: participant.preferredStaffId ?? '',
      ndisNumber: participant.ndisNumber ?? '',
      planStartDate: participant.planStartDate ? participant.planStartDate.split('T')[0] : '',
      planEndDate: participant.planEndDate ? participant.planEndDate.split('T')[0] : '',
      planType: participant.planType ?? 'SelfManaged', fundingSource: participant.fundingSource ?? 'Ndis',
      fundingOrganisation: participant.fundingOrganisation ?? '', isDsoa: participant.isDsoa ?? false,
      isRepeatClient: participant.isRepeatClient ?? false,
      serviceStreams: parseServiceStreams(participant.serviceStreams),
      // ── Key Identifiers (Profile-owned) ──
      pensionCardNumber: participant.pensionCardNumber ?? '',
      pensionCardExpiry: participant.pensionCardExpiry ? participant.pensionCardExpiry.split('T')[0] : '',
      medicareNumber: participant.medicareNumber ?? '',
      medicareExpiry: participant.medicareExpiry ? participant.medicareExpiry.split('T')[0] : '',
      companionCardNumber: participant.companionCardNumber ?? '',
      companionCardExpiry: participant.companionCardExpiry ? participant.companionCardExpiry.split('T')[0] : '',
      privateHealthFund: participant.privateHealthFund ?? '', privateHealthMembershipNumber: participant.privateHealthMembershipNumber ?? '',
      taxiCardNumber: participant.taxiCardNumber ?? '', hairColour: participant.hairColour ?? '', eyeColour: participant.eyeColour ?? '',
      weightKg: participant.weightKg ?? undefined, heightCm: participant.heightCm ?? undefined,
      // ── Intake-only fields this wizard never displays. They must still be in the form values: "Complete
      // Profile" is a full PUT, and the server nulls any field a full PUT omits (living arrangement and its
      // dependents, region, general notes), and `notes` rides in the risksHazardsSummary PATCH group with
      // behaviourRiskSummary (THE TRAP in participantPatchGroups.ts). ──
      livingArrangement: participant.livingArrangement ?? '', mainSupportPersonName: participant.mainSupportPersonName ?? '',
      mainSupportPersonRelationship: participant.mainSupportPersonRelationship ?? '',
      othersLivingInAccommodation: participant.othersLivingInAccommodation ?? '', residentialInfo: participant.residentialInfo ?? '',
      livesWithOthers: participant.livesWithOthers ?? undefined, whoLivesWith: participant.whoLivesWith ?? '',
      silProviderName: participant.silProviderName ?? '', silProviderContactPhone: participant.silProviderContactPhone ?? '',
      accommodationType: participant.accommodationType ?? '', onSiteSupportHours: participant.onSiteSupportHours ?? '',
      livingArrangementNotes: participant.livingArrangementNotes ?? '', region: participant.region ?? '', notes: participant.notes ?? '',
      // ── Support Needs & Mobility (Shared companions echoed for the supportNeedsMobility group) ──
      isHighSupport: participant.isHighSupport ?? false, isIntensiveSupport: participant.isIntensiveSupport ?? false,
      mobilityAidWheelchair: participant.mobilityAidWheelchair ?? false, mobilityAidWalker: participant.mobilityAidWalker ?? false,
      mobilitySupportOptions: participant.mobilitySupportOptions ?? [],
      overnightSupport: participant.overnightSupport ?? 'None', overnightRatio: participant.overnightRatio ?? 'OneToOne',
      requiresHiLoBed: participant.requiresHiLoBed ?? false, requiresHoist: participant.requiresHoist ?? false,
      requiresShowerChair: participant.requiresShowerChair ?? false, requiresCommode: participant.requiresCommode ?? false,
      requiresStandingMachine: participant.requiresStandingMachine ?? false, supportRatio: participant.supportRatio ?? 'SharedSupport',
      mobilityNotes: participant.mobilityNotes ?? '', equipmentRequirements: participant.equipmentRequirements ?? '',
      transportRequirements: participant.transportRequirements ?? '',
      ambulantStatus: participant.ambulantStatus ?? '', fallsRiskRating: participant.fallsRiskRating ?? '',
      unevenGroundFlag: boolToTriState(participant.unevenGroundFlag), levelOfPersonalCare: participant.levelOfPersonalCare ?? '',
      orthotics: participant.orthotics ?? '', continenceSupportDetail: participant.continenceSupportDetail ?? '',
      bowelCareDetail: participant.bowelCareDetail ?? '', menstruationSupport: participant.menstruationSupport ?? '',
      skinIntegrity: participant.skinIntegrity ?? '',
      // ── Medical (medicalSummary/hidpaNotes Shared-echoed) ──
      primaryDiagnosis: participant.primaryDiagnosis
        ? (DIAGNOSIS_OPTIONS as readonly string[]).includes(participant.primaryDiagnosis) ? participant.primaryDiagnosis : DIAGNOSIS_OTHER_SENTINEL
        : '',
      primaryDiagnosisOther: participant.primaryDiagnosis && !(DIAGNOSIS_OPTIONS as readonly string[]).includes(participant.primaryDiagnosis)
        ? participant.primaryDiagnosis : '',
      otherDiagnoses: participant.otherDiagnoses ?? [],
      hidpaSupportCategories: parseHidpaCategories(participant.hidpaSupportCategories),
      hidpaNotes: participant.hidpaNotes ?? '', medicalSummary: participant.medicalSummary ?? '',
      allergiesDetail: participant.allergiesDetail ?? '', isAnaphylaxisRisk: boolToTriState(participant.isAnaphylaxisRisk),
      allergyManagementNotes: participant.allergyManagementNotes ?? '',
      healthConditions: HEALTH_CONDITION_TYPES.map((type) => {
        const c = participant.healthConditions?.find((row) => row.conditionType === type)
        return { conditionType: type, has: boolToTriState(c?.has ?? null), severity: c?.severity ?? '', planProvided: boolToTriState(c?.planProvided ?? null), trainingRequired: boolToTriState(c?.trainingRequired ?? null), notes: c?.notes ?? '' }
      }),
      // ── Cultural Depth / Consents ──
      isCald: boolToTriState(participant.isCald), isLgbtqi: boolToTriState(participant.isLgbtqi),
      isFamilyCommunity: boolToTriState(participant.isFamilyCommunity),
      isAboriginalOrTorresStraitIslander: boolToTriState(participant.isAboriginalOrTorresStraitIslander),
      receivedRightsAndResponsibilitiesInfo: boolToTriState(participant.receivedRightsAndResponsibilitiesInfo),
      receivedPrivacyAndConfidentialityInfo: boolToTriState(participant.receivedPrivacyAndConfidentialityInfo),
      receivedFeedbackInfo: boolToTriState(participant.receivedFeedbackInfo),
      receivedBeingSafeInfo: boolToTriState(participant.receivedBeingSafeInfo),
      receivedAdvocacyInfo: boolToTriState(participant.receivedAdvocacyInfo),
      personalInterests: participant.personalInterests ?? '', choiceControlNotes: participant.choiceControlNotes ?? '',
      consents: CONSENT_TYPES.map((type) => {
        const c = participant.consents?.find((row) => row.consentType === type)
        return { consentType: type, granted: boolToTriState(c?.granted ?? null), signedByName: c?.signedByName ?? '', signedDate: c?.signedDate ? c.signedDate.split('T')[0] : '' }
      }),
      // ── Behaviour & Cognition (behavioursOfConcern*/expressiveSkills/behaviourRiskSummary Shared) ──
      memory: participant.memory ?? '', memoryAids: boolToTriState(participant.memoryAids),
      impairedUnderstanding: boolToTriState(participant.impairedUnderstanding),
      impairedJudgementReasoning: boolToTriState(participant.impairedJudgementReasoning),
      behavioursOfConcernCurrent: boolToTriState(participant.behavioursOfConcernCurrent),
      behavioursOfConcernFiveYearHistory: boolToTriState(participant.behavioursOfConcernFiveYearHistory),
      behaviourRiskRating: participant.behaviourRiskRating ?? '', ridsLogged: boolToTriState(participant.ridsLogged),
      bspPlanProvided: boolToTriState(participant.bspPlanProvided), bocChartProvided: boolToTriState(participant.bocChartProvided),
      expressiveSkills: participant.expressiveSkills ?? '', receptiveSkills: participant.receptiveSkills ?? '',
      readingAbility: participant.readingAbility ?? '', communicationAids: participant.communicationAids ?? '',
      behaviourRiskSummary: participant.behaviourRiskSummary ?? '',
      // ── Daily Living ──
      adlAssessments: ADL_TYPES.map((type) => {
        const a = participant.adlAssessments?.find((row) => row.adlType === type)
        return { adlType: type, level: a?.level ?? '', notes: a?.notes ?? '', howToHelpNotes: a?.howToHelpNotes ?? '' }
      }),
      mealAssistanceDetail: participant.mealAssistanceDetail ?? '', chokingRiskMealDetail: participant.chokingRiskMealDetail ?? '',
      modifiedDietDetail: participant.modifiedDietDetail ?? '', pegRegimeMealDetail: participant.pegRegimeMealDetail ?? '',
      specialUtensilsDetail: participant.specialUtensilsDetail ?? '', specialDietaryNeedsDetail: participant.specialDietaryNeedsDetail ?? '',
      favouriteBreakfast: participant.favouriteBreakfast ?? '', favouriteLunch: participant.favouriteLunch ?? '',
      favouriteDinner: participant.favouriteDinner ?? '', medicationTricks: participant.medicationTricks ?? '',
      foodsAlwaysEaten: participant.foodsAlwaysEaten ?? '',
      goals: participant.goals ?? '', supportAreas: participant.supportAreas ?? '', strengthsFears: participant.strengthsFears ?? '',
      thingsToKnow: participant.thingsToKnow ?? '', whoIsImportant: participant.whoIsImportant ?? '', likesDislikes: participant.likesDislikes ?? '',
      // ── Community Access (CA-gated) ──
      signsHappyAndSettled: participant.signsHappyAndSettled ?? '', whatHelpsMeCalmDown: participant.whatHelpsMeCalmDown ?? '',
      bocTriggers: participant.bocTriggers ?? '', bocEarlyWarningSigns: participant.bocEarlyWarningSigns ?? '',
      bocDeEscalationStrategies: participant.bocDeEscalationStrategies ?? '', bocWhatNotToDo: participant.bocWhatNotToDo ?? '',
      checklistItems: CHECKLIST_ITEM_TYPES.map((type) => {
        const c = participant.checklistItems?.find((row) => row.itemType === type)
        return { itemType: type, value: c?.value ?? '', notes: c?.notes ?? '' }
      }),
      communityAccessRiskItems: COMMUNITY_ACCESS_RISK_ITEM_TYPES.map((type) => {
        const r = participant.communityAccessRiskItems?.find((row) => row.itemType === type)
        return { itemType: type, rating: r?.rating ?? '', strategyNotes: r?.strategyNotes ?? '' }
      }),
      overallCommunityAccessRiskRating: participant.overallCommunityAccessRiskRating ?? '',
      supportsLookLikeMorning: participant.supportsLookLikeMorning ?? '', supportsLookLikeDay: participant.supportsLookLikeDay ?? '',
      supportsLookLikeAfternoonEvening: participant.supportsLookLikeAfternoonEvening ?? '', supportsLookLikeOvernight: participant.supportsLookLikeOvernight ?? '',
      // Not editable/displayed by this wizard, but a live array so useFieldArray hooks stay valid.
      riskEntries: [], contactRoles: [],
    } as unknown as Parameters<typeof reset>[0])
    // See the `hydrated` flag doc below — flips true in the SAME effect flush as this reset(),
    // so useDeriveFieldValues' resetKey and the reset() values it re-baselines against always
    // change together, never one render apart.
    setHydrated(true)
  }, [participant, reset])

  const serviceStreamsList = useMemo(() => parseServiceStreams(participant?.serviceStreams), [participant?.serviceStreams])
  const caVisible = CA_SECTION.isVisible(serviceStreamsList)
  const staVisible = STA_SECTION.isVisible(serviceStreamsList)

  const WIZARD_STEPS: WizardStepDef<ParticipantFormData>[] = useMemo(() => {
    const steps: WizardStepDef<ParticipantFormData>[] = [
      // Each step's `fields` lists the Profile-owned fields first (a failed save points at fields[0]) and then
      // the shared fields the step edits, so "Next" clears their stale validation errors too.
      { key: 'keyIdentifiers', label: 'Key Identifiers', fields: [...PROFILE_STEP_KEY_IDENTIFIERS_FIELDS, ...PROFILE_STEP_SHARED_FIELDS.keyIdentifiers] },
      { key: 'culturalDepth', label: 'Cultural Depth & Consents', fields: [...PROFILE_STEP_CULTURAL_DEPTH_FIELDS, ...PROFILE_STEP_SHARED_FIELDS.culturalDepth] },
      { key: 'medical', label: 'Medical Detail', fields: [...PROFILE_STEP_MEDICAL_FIELDS, ...PROFILE_STEP_SHARED_FIELDS.medical] },
      { key: 'mobility', label: 'Mobility & Functional', fields: [...PROFILE_STEP_MOBILITY_FIELDS, ...PROFILE_STEP_SHARED_FIELDS.mobility] },
      { key: 'behaviourCognition', label: 'Behaviour & Cognition', fields: [...PROFILE_STEP_BEHAVIOUR_FIELDS, ...PROFILE_STEP_SHARED_FIELDS.behaviourCognition] },
      { key: 'dailyLiving', label: 'Daily Living', fields: PROFILE_STEP_DAILY_LIVING_FIELDS },
    ]
    // Computed step list (CORE-01) — the Community Access step is present only when its
    // isVisible predicate matches the loaded participant's serviceStreams.
    if (caVisible) steps.push({ key: 'communityAccess', label: 'Community Access', fields: PROFILE_STEP_COMMUNITY_ACCESS_FIELDS })
    return steps
  }, [caVisible])
  const WIZARD_STEPS_FOR_RAIL = useMemo(() => [...WIZARD_STEPS, { key: REVIEW_STEP_KEY, label: 'Review', fields: [] }], [WIZARD_STEPS])

  const [saveError, setSaveError] = useState<string | null>(null)

  const saveStep = async (stepKey: string) => {
    if (!id) return
    const values = getValues()
    if (stepKey === 'communityAccess') {
      const dto = buildProfileStepPatch(stepKey, values, staVisible, PROFILE_WIZARD_STEP_TO_PATCH_GROUPS)
      if (dto) await patchParticipant.mutateAsync({ id, data: dto })
      // The 22-row risk matrix has its own nested-CRUD endpoint (PF-10.2), not a PatchParticipantDto
      // collection group — one upsert PUT per row, same "materialize all N rows" write path the
      // participant detail page uses.
      await Promise.all(
        (values.communityAccessRiskItems ?? []).map((row) =>
          upsertRiskItem.mutateAsync({
            participantId: id,
            itemType: row.itemType as never,
            data: { rating: (row.rating || null) as never, strategyNotes: row.rating ? (row.strategyNotes || null) : null },
          }),
        ),
      )
      return
    }
    const dto = buildProfileStepPatch(stepKey, values, staVisible, PROFILE_WIZARD_STEP_TO_PATCH_GROUPS)
    if (!dto) return
    await patchParticipant.mutateAsync({ id, data: dto })
  }

  const validateStep: WizardValidate<ParticipantFormData> = async (step, values) => {
    const schema = PROFILE_EDITABLE_STEP_SCHEMAS_BY_KEY[step.key]
    if (schema) {
      const result = schema.safeParse(values)
      if (!result.success) {
        return result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message, code: issue.code }))
      }
    }
    setSaveError(null)
    try {
      await saveStep(step.key)
      return null
    } catch (err) {
      setSaveError(extractErrorMessage(err, 'Failed to save this section. Please try again.'))
      return [{ path: step.fields[0] as string, message: 'Save failed — see the banner above.', code: 'server' }]
    }
  }

  const wizard = useWizard<ParticipantFormData>({
    steps: WIZARD_STEPS,
    initialVisited: 'linear',
    validate: validateStep,
    getValues,
    setError: (path, err) => setError(path as keyof ParticipantFormData, err),
    clearErrors: (paths) => clearErrors(paths as (keyof ParticipantFormData)[]),
    onValidationFailed: (firstPath) => setFocusRequest({ field: firstPath }),
  })
  const { currentStep, isReviewStep } = wizard
  const watchedValues = useWatch({ control })
  // resetKey: `hydrated ? participant : undefined` — undefined before useParticipant resolves
  // AND before its reset() has actually applied, then a stable object reference from the exact
  // render where the loaded values land (see the `hydrated` flag doc above). Re-baselines the
  // derivation's internal "previous state" for that load without firing `apply`, so an existing
  // participant's deliberately-unticked EpilepsyManagement selection is never silently re-ticked
  // on page load (see conditionalFields.ts).
  useDeriveFieldValues(watchedValues as Partial<ParticipantFormData>, FIELD_DERIVATIONS, setValue, hydrated ? participant : undefined)

  const [completing, setCompleting] = useState(false)
  const onComplete = async () => {
    if (!id || !participant) return
    setCompleting(true)
    setSaveError(null)
    try {
      const payload = buildParticipantWirePayload(getValues())
      delete payload.riskEntries
      delete payload.contactRoles
      const data: UpdateParticipantDto = { ...(payload as unknown as UpdateParticipantDto), isActive: participant.isActive, isDraft: false }
      const res = await updateParticipant.mutateAsync({ id, data })
      if (res.success) {
        // Clear the dirty flag synchronously first (the documented useUnsavedChangesWarning idiom, as the Intake
        // wizard does): the per-step saves never reset the form, so without this a finished wizard that had any
        // edit in it asks "Leave without saving?" on its way out.
        flushSync(() => reset(getValues()))
        navigate(`/participants/${id}`)
      }
    } catch (err) {
      setSaveError(extractErrorMessage(err, 'Failed to complete the profile. Please try again.'))
    } finally {
      setCompleting(false)
    }
  }

  const reviewBuilder = (values: ParticipantFormData, steps: WizardStepDef<ParticipantFormData>[]): ReviewGroup[] =>
    steps.map((step): ReviewGroup => {
      const rows: ReviewRow[] = []
      if (step.key === 'keyIdentifiers') {
        rows.push({ label: 'Medicare Number', value: values.medicareNumber || '—' }, { label: 'Weight (kg)', value: String(values.weightKg ?? '—') })
      } else if (step.key === 'culturalDepth') {
        rows.push({ label: 'Personal Interests', value: values.personalInterests || '—' }, { label: 'Consents recorded', value: String((values.consents ?? []).filter((c) => c.granted).length) })
      } else if (step.key === 'medical') {
        rows.push({ label: 'Primary Diagnosis', value: (values.primaryDiagnosis === DIAGNOSIS_OTHER_SENTINEL ? values.primaryDiagnosisOther : values.primaryDiagnosis) || '—' })
      } else if (step.key === 'mobility') {
        rows.push({ label: 'Ambulant Status', value: values.ambulantStatus || '—' })
      } else if (step.key === 'behaviourCognition') {
        rows.push({ label: 'Memory', value: values.memory || '—' })
      } else if (step.key === 'dailyLiving') {
        rows.push({ label: 'Goals', value: values.goals || '—' })
      } else if (step.key === 'communityAccess') {
        rows.push({ label: 'Overall Risk Rating', value: values.overallCommunityAccessRiskRating || '—' })
      }
      return { stepKey: step.key, rows }
    })

  const fallbackBack = `/participants/${id}`

  if (isLoading || !participant) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading...</div>

  return (
    <div className="w-full min-w-0 max-w-full flex flex-col gap-[var(--section-gap)]">
      {unsavedChangesDialog}
      <div className="flex items-center gap-3">
        <BackButton to={fallbackBack} label="participant" variant="icon" data-testid="profile-header-back" />
        <h1 className="text-xl font-bold">Profile — {participant.firstName} {participant.lastName}</h1>
      </div>

      {saveError && (
        <div role="alert" className="p-3 rounded-[var(--radius-sm)] bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm">
          {saveError}
        </div>
      )}

      <WizardShell
        rail={
          <WizardStepRail
            steps={WIZARD_STEPS_FOR_RAIL}
            visitedSteps={wizard.visitedSteps}
            currentKey={isReviewStep ? REVIEW_STEP_KEY : currentStep.key}
            onSelect={wizard.goToStep}
          />
        }
      >
        <form
          onSubmit={handleSubmit(onComplete, wizard.handleInvalidSubmit)}
          noValidate
          // The form now fills the full content-column width (no max-w cap) so the rail's
          // sidebar and the form's step panel share the row; the step's heading + body sit
          // inside a <Card> below to read as a distinct panel. Scroll-margin utilities were
          // on the original outer wrapper for the fixed bottom nav; they stay on this <form>
          // so they still apply to every form control inside it.
          className="[&_input]:scroll-mt-20 [&_input]:scroll-mb-44 [&_textarea]:scroll-mt-20 [&_textarea]:scroll-mb-44 [&_select]:scroll-mt-20 [&_select]:scroll-mb-44 [&_button]:scroll-mt-20 [&_button]:scroll-mb-44 flex flex-col gap-[var(--section-gap)]"
        >
          <Card className="space-y-4">
            <WizardStepHeading
              stepKey={isReviewStep ? REVIEW_STEP_KEY : currentStep.key}
              label={isReviewStep ? 'Review' : currentStep.label}
            />
        {!isReviewStep && currentStep.key === 'keyIdentifiers' && (
          <KeyIdentifiersStep control={control} register={register} errors={errors} participant={participant} activeStaff={activeStaff} sharedFieldsEditable />
        )}
        {!isReviewStep && currentStep.key === 'culturalDepth' && (
          <CulturalDepthConsentsStep control={control} register={register} participant={participant} consentsFieldArray={consentsFieldArray} staVisible={staVisible} sharedFieldsEditable />
        )}
        {!isReviewStep && currentStep.key === 'medical' && (
          <MedicalDetailStep control={control} register={register} errors={errors} participant={participant} healthConditionFieldArray={healthConditionFieldArray} watchedValues={watchedValues as unknown as Partial<ParticipantFormData>} sharedFieldsEditable />
        )}
        {!isReviewStep && currentStep.key === 'mobility' && (
          <MobilityFunctionalStep control={control} register={register} participant={participant} errors={errors} sharedFieldsEditable />
        )}
        {!isReviewStep && currentStep.key === 'behaviourCognition' && (
          <BehaviourCognitionStep control={control} register={register} participant={participant} sharedFieldsEditable />
        )}
        {!isReviewStep && currentStep.key === 'dailyLiving' && (
          <DailyLivingStep control={control} register={register} adlFieldArray={adlFieldArray} watchedValues={watchedValues as unknown as Partial<ParticipantFormData>} caVisible={caVisible} />
        )}
        {!isReviewStep && currentStep.key === 'communityAccess' && caVisible && (
          <CommunityAccessStep control={control} register={register} checklistFieldArray={checklistFieldArray} riskItemsFieldArray={riskItemsFieldArray} watchedValues={watchedValues as unknown as Partial<ParticipantFormData>} />
        )}

        {isReviewStep && (
          <WizardReviewStep groups={reviewBuilder(watchedValues as unknown as ParticipantFormData, WIZARD_STEPS)} steps={WIZARD_STEPS} onEdit={wizard.goToStep} />
        )}
          </Card>

        <WizardNavFooter
          showBack={wizard.stepIndex > 0}
          onBack={wizard.handleBack}
          onNext={wizard.handleNext}
          isReviewStep={isReviewStep}
          secondaryActions={[]}
          cancelTo={`/participants/${id}`}
          submitLabel={completing ? 'Completing...' : 'Complete Profile'}
          isSubmitting={completing || wizard.isAdvancing}
        />
        </form>
      </WizardShell>
    </div>
  )
}
