/**
 * PF-10.3 (SPEC-05 `docs/specs/odip-updates-2026-09/SPEC-05-intake-profile-split.md`) — the new
 * Intake wizard. Replaces the old single 11-step wizard at the `/participants/new` route (that
 * wizard's own `/participants/:id/edit` route was retired and deleted by PF-10.7, once PF-10.4's
 * Profile wizard also existed).
 *
 * Field set: every `entryPhase: 'intake'` entry in `src/lib/documentMapping.ts`
 * (`fieldsForEntry('intake')`), re-grouped into 8 steps under `src/lib/participantSchema.ts`'s
 * `STEP_*_FIELDS` constants — see `IntakeWizardPage.test.tsx`'s "drift guard" describe block for
 * the guard that this wizard renders every one of those fields and no Profile-only field.
 *
 * Progression model (SPEC-05 §PF-10.5, fixed): a normal `POST /api/participants` creates the
 * Participant immediately with `IsDraft = true` and `completeIntake: true` (stamping the new
 * `IntakeCompletedAt` server-side) on final submit; "Save as draft" omits `completeIntake` so a
 * mid-intake abandon doesn't falsely mark intake complete. On success ("Complete Intake" only —
 * "Save as draft" still lands on the detail page), the server has also put the participant on the
 * onboarding worklist, so the wizard navigates to the Onboarding table
 * (`/participants?tab=onboarding`) with a one-off "Intake complete" confirmation — see the
 * `onSubmit` handler below and intakeComplete.ts.
 *
 * PF-10.5 EDIT MODE — resuming an existing draft whose IntakeCompletedAt is still null (the
 * detail page's "Resume intake" banner, routed to `/participants/{id}/intake`): this same
 * component, keyed off an optional `:id` route param. Loads the existing row via `useParticipant`,
 * hydrates every Intake-owned field via `reset()` (mirrors ProfileWizardPage.tsx's own hydration
 * effect), and both "Save as draft"/"Complete Intake" go through `PUT /api/participants/{id}/intake`
 * (`useSaveParticipantIntake`) instead of `POST`. That endpoint is SCOPED: the server writes only the
 * intake fields and never reads whether the participant is a draft or active, so resuming an intake
 * cannot wipe what the Profile wizard recorded (it used to go through the full-record PUT and did).
 * `completeIntake: true` stamps IntakeCompletedAt, idempotently on `completionRequestId`.
 * Contacts and risk entries added while resuming ARE sent: the server creates the ones the participant
 * does not already have and skips the rest. The ones already recorded are listed read-only (fetched via
 * their own nested-CRUD endpoints) and are managed from the participant's detail page.
 */
import { useNavigate, useParams } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, useFieldArray, useWatch } from 'react-hook-form'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useCreateParticipant, useSaveParticipantIntake, useParticipant, usePersons,
  useParticipantContactRoles, useParticipantRiskEntries,
} from '@/api/hooks'
import {
  useWizard, WizardStepRail, WizardNavFooter, WizardReviewStep, WizardStepHeading, WizardShell,
  REVIEW_STEP_KEY,
  type WizardStepDef, type WizardValidate, type WizardSecondaryAction, type ReviewGroup, type ReviewRow,
} from '@/components/wizard'
import { BackButton } from '@/components/BackButton'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { PageState } from '@/components/PageState'
import { isNotFoundError } from '@/lib/httpStatus'
import {
  type ParticipantFormData, intakeParticipantResolver, INTAKE_STEP_SCHEMAS_BY_KEY,
  STEP_PARTICIPANT_DETAILS_FIELDS, STEP_NDIS_FUNDING_FIELDS, STEP_CONTACTS_FIELDS,
  STEP_CULTURAL_FIELDS, STEP_SUPPORT_FIELDS, STEP_MEDICAL_FIELDS, STEP_BEHAVIOUR_FIELDS, STEP_RISKS_FIELDS,
} from '@/lib/participantSchema'
import { formatServiceStreams, parseServiceStreams } from '@/api/types/participants'
import { newCompletionRequestId } from '@/lib/completionRequestId'
import { ONBOARDING_TABLE_PATH, intakeCompleteState } from './intakeComplete'
import { planTypeComplianceWarning } from '@/api/types/contacts'
import type { PlanType, ServiceStream } from '@/api/types/enums'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { focusField, triStateToBool, boolToTriState, extractErrorMessage } from './intakeFormat'
import { ParticipantDetailsStep } from './steps/ParticipantDetailsStep'
import { NdisFundingStep } from './steps/NdisFundingStep'
import { ContactsStep } from './steps/ContactsStep'
import { CulturalConsiderationsStep } from './steps/CulturalConsiderationsStep'
import { SupportNeedsStep } from './steps/SupportNeedsStep'
import { MedicalSummaryStep } from './steps/MedicalSummaryStep'
import { BehaviourSummaryStep } from './steps/BehaviourSummaryStep'
import { RisksHazardsStep } from './steps/RisksHazardsStep'
import { plural } from '@/lib/format'

const CULTURAL_TRI_STATE_FIELDS = [
  'isCald', 'isLgbtqi', 'isFamilyCommunity', 'isAboriginalOrTorresStraitIslander',
  'receivedRightsAndResponsibilitiesInfo', 'receivedPrivacyAndConfidentialityInfo',
  'receivedFeedbackInfo', 'receivedBeingSafeInfo', 'receivedAdvocacyInfo',
  'behavioursOfConcernCurrent', 'behavioursOfConcernFiveYearHistory',
] as const

/** Review-step display helper for a tri-state ('true' | 'false' | '' | undefined) field. */
function yesNoUnknown(value: string | undefined): string {
  return value === 'true' ? 'Yes' : value === 'false' ? 'No' : 'Not recorded'
}

export default function IntakeWizardPage() {
  const { id } = useParams<{ id: string }>()
  const isEditMode = !!id
  const navigate = useNavigate()
  const createParticipant = useCreateParticipant()
  const saveIntake = useSaveParticipantIntake()
  const saveMutation = isEditMode ? saveIntake : createParticipant
  const { data: participant, isLoading: participantLoading, isError: participantFailed, error: participantError, refetch: refetchParticipant } = useParticipant(id)
  // PF-10.5 edit mode: the wizard's own contact and risk field arrays hold only the NEW rows added in this session — existing rows
  // are surfaced read-only from their own nested-CRUD endpoints, same data source ParticipantContactRolesSection/RiskEntriesSection
  // already use on the detail page.
  const { data: existingContactRoles = [] } = useParticipantContactRoles(isEditMode ? id : undefined)
  const { data: existingRiskEntries = [] } = useParticipantRiskEntries(isEditMode ? id : undefined)
  const { data: people = [] } = usePersons()

  const { register, handleSubmit, control, getValues, setValue, watch, setError, clearErrors, reset, formState: { errors, isDirty } } = useForm<ParticipantFormData>({
    resolver: intakeParticipantResolver,
    defaultValues: {
      livingArrangement: '',
      livesWithOthers: false,
      fundingSource: 'Ndis',
      planType: 'SelfManaged',
      isRepeatClient: false,
      serviceStreams: [],
      mobilityAidWheelchair: false,
      mobilityAidWalker: false,
      isHighSupport: false,
      isIntensiveSupport: false,
      overnightSupport: 'None',
      overnightRatio: 'OneToOne',
      requiresHiLoBed: false,
      requiresHoist: false,
      requiresShowerChair: false,
      requiresCommode: false,
      requiresStandingMachine: false,
      supportRatio: 'SharedSupport',
      isCald: '', isLgbtqi: '', isFamilyCommunity: '', isAboriginalOrTorresStraitIslander: '',
      receivedRightsAndResponsibilitiesInfo: '', receivedPrivacyAndConfidentialityInfo: '',
      receivedFeedbackInfo: '', receivedBeingSafeInfo: '', receivedAdvocacyInfo: '',
      behavioursOfConcernCurrent: '', behavioursOfConcernFiveYearHistory: '',
      riskEntries: [],
      contactRoles: [],
    },
  })

  const riskEntryFieldArray = useFieldArray({ control, name: 'riskEntries' })
  const contactRoleFieldArray = useFieldArray({ control, name: 'contactRoles' })

  const [focusRequest, setFocusRequest] = useState<{ field: string } | null>(null)
  const completionRequestId = useRef<string | null>(null)
  const requestFocus = (fieldName: string) => setFocusRequest({ field: fieldName })
  useEffect(() => {
    if (focusRequest) focusField(focusRequest.field)
  }, [focusRequest])
  useEffect(() => {
    if (!isEditMode) focusField('firstName')
  }, [isEditMode])

  // PF-10.5 EDIT MODE — hydrate every Intake-owned field from the existing row so resuming a draft
  // shows what's already captured rather than a blank form. Round-trip conventions (tri-state,
  // date-slice, array defaults) mirror ProfileWizardPage.tsx's own hydration effect exactly.
  // Contacts/Risks are deliberately excluded — see this file's header doc.
  useEffect(() => {
    if (!isEditMode || !participant) return
    reset({
      firstName: participant.firstName ?? '', lastName: participant.lastName ?? '',
      preferredName: participant.preferredName ?? '',
      dateOfBirth: participant.dateOfBirth ? participant.dateOfBirth.split('T')[0] : '',
      phone: participant.phone ?? '', email: participant.email ?? '',
      addressStreet: participant.addressStreet ?? '', addressSuburb: participant.addressSuburb ?? '',
      addressState: participant.addressState ?? '', addressPostcode: participant.addressPostcode ?? '',
      livingArrangement: participant.livingArrangement ?? '',
      mainSupportPersonName: participant.mainSupportPersonName ?? '',
      mainSupportPersonRelationship: participant.mainSupportPersonRelationship ?? '',
      othersLivingInAccommodation: participant.othersLivingInAccommodation ?? '',
      residentialInfo: participant.residentialInfo ?? '',
      livesWithOthers: participant.livesWithOthers ?? false, whoLivesWith: participant.whoLivesWith ?? '',
      silProviderName: participant.silProviderName ?? '', silProviderContactPhone: participant.silProviderContactPhone ?? '',
      accommodationType: participant.accommodationType ?? '', onSiteSupportHours: participant.onSiteSupportHours ?? '',
      livingArrangementNotes: participant.livingArrangementNotes ?? '',
      ndisNumber: participant.ndisNumber ?? '',
      planStartDate: participant.planStartDate ? participant.planStartDate.split('T')[0] : '',
      planEndDate: participant.planEndDate ? participant.planEndDate.split('T')[0] : '',
      planType: participant.planType ?? 'SelfManaged', fundingSource: participant.fundingSource ?? 'Ndis',
      fundingOrganisation: participant.fundingOrganisation ?? '', region: participant.region ?? '',
      isRepeatClient: participant.isRepeatClient ?? false,
      serviceStreams: parseServiceStreams(participant.serviceStreams),
      isCald: boolToTriState(participant.isCald), isLgbtqi: boolToTriState(participant.isLgbtqi),
      isFamilyCommunity: boolToTriState(participant.isFamilyCommunity),
      isAboriginalOrTorresStraitIslander: boolToTriState(participant.isAboriginalOrTorresStraitIslander),
      receivedRightsAndResponsibilitiesInfo: boolToTriState(participant.receivedRightsAndResponsibilitiesInfo),
      receivedPrivacyAndConfidentialityInfo: boolToTriState(participant.receivedPrivacyAndConfidentialityInfo),
      receivedFeedbackInfo: boolToTriState(participant.receivedFeedbackInfo),
      receivedBeingSafeInfo: boolToTriState(participant.receivedBeingSafeInfo),
      receivedAdvocacyInfo: boolToTriState(participant.receivedAdvocacyInfo),
      mobilityAidWheelchair: participant.mobilityAidWheelchair ?? false, mobilityAidWalker: participant.mobilityAidWalker ?? false,
      isHighSupport: participant.isHighSupport ?? false, isIntensiveSupport: participant.isIntensiveSupport ?? false,
      overnightSupport: participant.overnightSupport ?? 'None', overnightRatio: participant.overnightRatio ?? 'OneToOne',
      requiresHiLoBed: participant.requiresHiLoBed ?? false, requiresHoist: participant.requiresHoist ?? false,
      requiresShowerChair: participant.requiresShowerChair ?? false, requiresCommode: participant.requiresCommode ?? false,
      requiresStandingMachine: participant.requiresStandingMachine ?? false, supportRatio: participant.supportRatio ?? 'SharedSupport',
      medicalSummary: participant.medicalSummary ?? '', hidpaNotes: participant.hidpaNotes ?? '',
      behavioursOfConcernCurrent: boolToTriState(participant.behavioursOfConcernCurrent),
      behavioursOfConcernFiveYearHistory: boolToTriState(participant.behavioursOfConcernFiveYearHistory),
      expressiveSkills: participant.expressiveSkills ?? '',
      behaviourRiskSummary: participant.behaviourRiskSummary ?? '', notes: participant.notes ?? '',
      riskEntries: [], contactRoles: [],
    } as unknown as Parameters<typeof reset>[0])
  }, [isEditMode, participant, reset])

  const WIZARD_STEPS: WizardStepDef<ParticipantFormData>[] = useMemo(() => [
    { key: 'participantDetails', label: 'Participant Details', fields: STEP_PARTICIPANT_DETAILS_FIELDS },
    { key: 'ndisFunding', label: 'NDIS & Funding', fields: STEP_NDIS_FUNDING_FIELDS },
    { key: 'contacts', label: 'Contacts', fields: STEP_CONTACTS_FIELDS },
    { key: 'culturalConsiderations', label: 'Cultural Considerations', fields: STEP_CULTURAL_FIELDS },
    { key: 'support', label: 'Support Needs', fields: STEP_SUPPORT_FIELDS },
    { key: 'medical', label: 'Medical Summary', fields: STEP_MEDICAL_FIELDS },
    { key: 'behaviour', label: 'Behaviour Summary', fields: STEP_BEHAVIOUR_FIELDS },
    { key: 'risks', label: 'Risks & Hazards', fields: STEP_RISKS_FIELDS },
  ], [])
  const WIZARD_STEPS_FOR_RAIL: WizardStepDef<ParticipantFormData>[] = useMemo(() => [
    ...WIZARD_STEPS,
    { key: REVIEW_STEP_KEY, label: 'Review', fields: [] },
  ], [WIZARD_STEPS])

  const validateStep: WizardValidate<ParticipantFormData> = (step, values) => {
    const schema = INTAKE_STEP_SCHEMAS_BY_KEY[step.key]
    if (!schema) return null
    const result = schema.safeParse(values)
    if (result.success) return null
    return result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
      code: issue.code,
    }))
  }

  const wizard = useWizard<ParticipantFormData>({
    steps: WIZARD_STEPS,
    initialVisited: 'linear',
    validate: validateStep,
    getValues,
    setError: (path, err) => setError(path as keyof ParticipantFormData, err),
    clearErrors: (paths) => clearErrors(paths as (keyof ParticipantFormData)[]),
    onValidationFailed: (firstPath) => requestFocus(firstPath),
  })
  const { currentStep, isReviewStep } = wizard

  const watchedValues = useWatch({ control })
  const overnightSupportValue = watchedValues.overnightSupport
  const livingArrangementValue = watchedValues.livingArrangement
  const fundingSourceValue = watchedValues.fundingSource

  // PF-2 (SPEC-02), reused: create mode has no participant to fetch a server-computed value
  // from, so this computes the identical plan-type/contact-role compliance rule live,
  // client-side, against the in-progress contactRoles field array.
  const planTypeComplianceWarningValue = planTypeComplianceWarning(watchedValues.planType as PlanType | undefined, watchedValues.contactRoles)

  function buildIntakePayload(data: ParticipantFormData, draft: boolean, completeIntake: boolean) {
    const payload: Record<string, unknown> = { ...data }
    payload.serviceStreams = formatServiceStreams(data.serviceStreams as ServiceStream[] | undefined)
    payload.contactRoles = (data.contactRoles ?? []).flatMap((row) => {
      const roleTypes = row.roleTypes && row.roleTypes.length > 0 ? row.roleTypes : ['NextOfKin']
      return roleTypes.map((roleType) => ({
        personId: row.personMode === 'existing' ? (row.personId || null) : null,
        newPersonFirstName: row.personMode === 'new' ? (row.newPersonFirstName || null) : null,
        newPersonLastName: row.personMode === 'new' ? (row.newPersonLastName || null) : null,
        newPersonPhone: null, newPersonMobile: null, newPersonEmail: null, newPersonOrganisation: null,
        roleType,
        relationshipToParticipant: row.relationshipToParticipant || null,
        isPrimary: !!row.isPrimary,
        status: 'Active',
        orderScopeDomains: [],
        priorityOrder: null, authorisedForMedicalInfo: null, appointingTribunal: null,
        orderStartDate: null, orderReviewDate: null, orderEndDate: null, nomineeScope: null, appointmentDate: null,
        reasonForAppointment: null, alternateRepresentativeName: null, fundingLineItemType: null, organisationName: null,
        registrationNumber: null, lastVisitDate: null, consentToShare: null, discipline: null, frequencyOfContact: null,
        websterPackFlag: null, roleTitle: null,
        registeredProviderFlag: roleType === 'ProviderContact' ? !!row.registeredProviderFlag : null,
        scopeNotes: null,
        authorisationDocumentReference: null, preferredLanguage: null, startDate: null, endDate: null, notes: null,
      }))
    })
    for (const field of CULTURAL_TRI_STATE_FIELDS) {
      payload[field] = triStateToBool(data[field])
    }
    for (const key of Object.keys(payload)) {
      if (payload[key] === '' || payload[key] === undefined) payload[key] = null
    }
    payload.isDraft = draft
    payload.completeIntake = completeIntake
    // Keep the key after a rejected request so retry does not create duplicate evidence.
    if (completeIntake) payload.completionRequestId = completionRequestId.current ??= newCompletionRequestId()
    return payload
  }

  const onSubmit = async (data: ParticipantFormData) => {
    // SPEC-05 (PF-10.5): IsDraft stays true across the entire Intake-done/Profile-pending span —
    // only the Profile wizard (PF-10.4) ever flips it false. completeIntake=true stamps
    // IntakeCompletedAt server-side; it is a distinct flag from IsDraft, not its replacement.
    const payload = buildIntakePayload(data, true, true)
    // The name the Onboarding table lists them under (the server's, preferred-name aware), falling back to what was typed.
    const typedName = [data.firstName, data.lastName].filter(Boolean).join(' ')
    try {
      if (isEditMode && id) {
        const res = await saveIntake.mutateAsync({ id, data: payload as never })
        if (res.success) {
          flushSync(() => reset(data))
          // Completing Intake puts the participant on the onboarding worklist: show them there.
          navigate(ONBOARDING_TABLE_PATH, { state: intakeCompleteState(id, res.data?.fullName || typedName) })
        }
        return
      }
      const res = await createParticipant.mutateAsync(payload as never)
      if (res.success && res.data?.id) {
        flushSync(() => reset(data))
        navigate(ONBOARDING_TABLE_PATH, { state: intakeCompleteState(res.data.id, res.data.fullName || typedName) })
      }
    } catch {
      // error handled by mutation state
    }
  }

  const [draftError, setDraftError] = useState<string | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const handleSaveDraft = async () => {
    setDraftError(null)
    setSavingDraft(true)
    const data = getValues()
    // completeIntake=false: a mid-intake "Save as draft" must not stamp IntakeCompletedAt.
    const payload = buildIntakePayload(data, true, false)
    try {
      if (isEditMode && id) {
        const res = await saveIntake.mutateAsync({ id, data: payload as never })
        if (res.success) {
          flushSync(() => reset(data))
          navigate(`/participants/${id}`)
        }
        return
      }
      const res = await createParticipant.mutateAsync(payload as never)
      if (res.success && res.data?.id) {
        flushSync(() => reset(data))
        navigate(`/participants/${res.data.id}`)
      }
    } catch (err) {
      setDraftError(extractErrorMessage(err, 'Failed to save draft. Please try again.'))
    } finally {
      setSavingDraft(false)
    }
  }

  const secondaryActions: WizardSecondaryAction[] = [
    {
      key: 'save-draft',
      label: savingDraft ? 'Saving draft...' : 'Save as draft',
      onClick: handleSaveDraft,
      disabled: savingDraft || saveMutation.isPending,
    },
  ]

  const reviewBuilder = (values: ParticipantFormData, steps: WizardStepDef<ParticipantFormData>[]): ReviewGroup[] => {
    return steps.map((step): ReviewGroup => {
      const rows: ReviewRow[] = []
      if (step.key === 'participantDetails') {
        rows.push(
          { label: 'Name', value: [values.firstName, values.lastName].filter(Boolean).join(' ') || '—' },
          { label: 'Preferred Name', value: values.preferredName || '—' },
          { label: 'Date of Birth', value: values.dateOfBirth || '—' },
          { label: 'Phone', value: values.phone || '—' },
          { label: 'Email', value: values.email || '—' },
          { label: 'Address', value: [values.addressStreet, values.addressSuburb, values.addressState, values.addressPostcode].filter(Boolean).join(', ') || '—' },
          { label: 'Living Arrangement', value: values.livingArrangement || '—' },
        )
      } else if (step.key === 'ndisFunding') {
        rows.push(
          { label: 'Funding Source', value: values.fundingSource || '—' },
          { label: 'NDIS Number', value: values.ndisNumber || '—' },
          { label: 'Plan Type', value: values.planType || '—' },
          { label: 'Region', value: values.region || '—' },
          { label: 'Service Streams', value: (values.serviceStreams ?? []).join(', ') || '—' },
          { label: 'Plan-type compliance', value: planTypeComplianceWarningValue ?? '' },
        )
      } else if (step.key === 'contacts') {
        // PF-10.5 edit mode: contactRoles is never hydrated into the form (create-mode-only field
        // array — see this file's header doc), so the count comes from the existing-rows fetch.
        rows.push({ label: 'Contacts added', value: String((isEditMode ? existingContactRoles.length : (values.contactRoles ?? []).length)) })
      } else if (step.key === 'culturalConsiderations') {
        rows.push(
          { label: 'CALD', value: yesNoUnknown(values.isCald) },
          { label: 'LGBTIQA+', value: yesNoUnknown(values.isLgbtqi) },
          { label: 'Family / Community', value: yesNoUnknown(values.isFamilyCommunity) },
          { label: 'Aboriginal and/or Torres Strait Islander', value: yesNoUnknown(values.isAboriginalOrTorresStraitIslander) },
        )
      } else if (step.key === 'support') {
        rows.push(
          { label: 'High Support', value: values.isHighSupport ? 'Yes' : 'No' },
          { label: 'Support Ratio', value: values.supportRatio || '—' },
          { label: 'Overnight Support', value: values.overnightSupport || '—' },
        )
      } else if (step.key === 'medical') {
        rows.push({ label: 'Medical Summary', value: values.medicalSummary || '—' })
      } else if (step.key === 'behaviour') {
        rows.push(
          { label: 'Behaviours of Concern (Current)', value: yesNoUnknown(values.behavioursOfConcernCurrent) },
          { label: 'Expressive Skills', value: values.expressiveSkills || '—' },
        )
      } else if (step.key === 'risks') {
        rows.push(
          { label: 'Behaviour Risk Summary', value: values.behaviourRiskSummary || '—' },
          { label: 'Risk Entries', value: String((isEditMode ? existingRiskEntries.length : (values.riskEntries ?? []).length)) },
        )
      }
      return { stepKey: step.key, rows }
    })
  }

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  // PF-10.5 edit mode: wait for the existing row before rendering the form, same guard
  // ProfileWizardPage.tsx uses — resetting a still-loading `undefined` participant would flash the
  // blank create-mode defaults, then jump once the fetch resolves.
  const fallbackBack = isEditMode ? `/participants/${id}` : '/participants'

  // Three different facts, three different states: still loading, the load failed, and there is no such participant. A failed or
  // missing record used to leave this page on "Loading..." for ever (L2-06 = L5-02), with no message, no retry and no way back.
  if (isEditMode && !participant) {
    if (participantLoading) return <PageState kind="loading" noun="participant" />
    return participantFailed && !isNotFoundError(participantError)
      ? <PageState kind="error" noun="participant" onRetry={() => refetchParticipant()} />
      : <PageState kind="not-found" noun="participant" backTo="/participants" backLabel="participants" />
  }

  return (
    <div className="w-full min-w-0 max-w-full flex flex-col gap-[var(--section-gap)]">
      {unsavedChangesDialog}
      <div className="flex items-center gap-3">
        <BackButton to={fallbackBack} label={isEditMode ? 'participant' : 'participants'} variant="icon" data-testid="intake-header-back" />
        <h1 className="text-xl font-bold">{isEditMode ? 'Resume Intake' : 'Intake'}</h1>
      </div>

      {saveMutation.isError && (
        // The server's own reason when it gave one ("Postcode must be exactly 4 digits.", "Plan Manager contacts are only available for
        // plan-managed participants."), a plain sentence when it did not. "Save as draft" below always did this; Complete Intake did not.
        <Callout tone="error">
          {extractErrorMessage(saveMutation.error, "Failed to save this participant's intake details. Please check your input and try again.")}
        </Callout>
      )}
      {draftError && (
        <Callout tone="error">
          {draftError}
        </Callout>
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
          onSubmit={handleSubmit(onSubmit, wizard.handleInvalidSubmit)}
          noValidate
          // The form now fills the full content-column width (no max-w cap) so the rail's
          // sidebar and the form's step panel share the row; the step's heading + body sit
          // inside a <Card> below to read as a distinct panel. The scroll-margin utilities
          // stay here — they were originally on the outer wrapper because of the fixed
          // bottom nav, and they continue to apply to every form control inside this form.
          className="[&_input]:scroll-mt-20 [&_input]:scroll-mb-44 [&_textarea]:scroll-mt-20 [&_textarea]:scroll-mb-44 [&_select]:scroll-mt-20 [&_select]:scroll-mb-44 [&_button]:scroll-mt-20 [&_button]:scroll-mb-44 flex flex-col gap-[var(--section-gap)]"
        >
          <Card className="space-y-4">
            <WizardStepHeading
              stepKey={isReviewStep ? REVIEW_STEP_KEY : currentStep.key}
              label={isReviewStep ? 'Review' : currentStep.label}
            />
        {!isReviewStep && currentStep.key === 'participantDetails' && (
          <ParticipantDetailsStep control={control} register={register} errors={errors} livingArrangementValue={livingArrangementValue} />
        )}

        {!isReviewStep && currentStep.key === 'ndisFunding' && (
          <NdisFundingStep
            control={control} register={register} errors={errors}
            fundingSourceValue={fundingSourceValue}
            planTypeComplianceWarningValue={planTypeComplianceWarningValue}
          />
        )}

        {!isReviewStep && currentStep.key === 'contacts' && (
          <>
            {/* PF-10.5 edit mode: contactRoles is a create-mode-only field array (see this file's
                header doc) — existing rows are already managed via the detail page's Contacts tab,
                surfaced here read-only so resuming doesn't look like they've vanished. */}
            {isEditMode && existingContactRoles.length > 0 && (
              <div className="mb-3 p-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-sm">
                <p className="font-medium mb-1">{plural(existingContactRoles.length, 'contact')} already recorded</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {existingContactRoles.map((role) => (
                    <li key={role.id}>{role.personFullName || 'Unnamed contact'} — {role.roleType}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[var(--color-muted-foreground)]">Manage existing contacts from the participant's detail page. Add any NEW contacts below.</p>
              </div>
            )}
            <ContactsStep
              control={control} register={register} errors={errors} setValue={setValue} watch={watch}
              people={people} contactRoleFieldArray={contactRoleFieldArray}
              planTypeComplianceWarningValue={planTypeComplianceWarningValue}
            />
          </>
        )}

        {!isReviewStep && currentStep.key === 'culturalConsiderations' && (
          <CulturalConsiderationsStep control={control} />
        )}

        {!isReviewStep && currentStep.key === 'support' && (
          <SupportNeedsStep control={control} register={register} errors={errors} overnightSupportValue={overnightSupportValue} />
        )}

        {!isReviewStep && currentStep.key === 'medical' && (
          <MedicalSummaryStep register={register} />
        )}

        {!isReviewStep && currentStep.key === 'behaviour' && (
          <BehaviourSummaryStep control={control} register={register} />
        )}

        {!isReviewStep && currentStep.key === 'risks' && (
          <>
            {/* PF-10.5 edit mode: riskEntries is a create-mode-only field array (see this file's
                header doc) — existing rows are already managed via the detail page's Risks
                section, surfaced here read-only so resuming doesn't look like they've vanished. */}
            {isEditMode && existingRiskEntries.length > 0 && (
              <div className="mb-3 p-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-sm">
                <p className="font-medium mb-1">{plural(existingRiskEntries.length, 'risk entry', 'risk entries')} already recorded</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {existingRiskEntries.map((entry) => (
                    <li key={entry.id}>{entry.description}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[var(--color-muted-foreground)]">Manage existing risk entries from the participant's detail page. Add any NEW risks below.</p>
              </div>
            )}
            <RisksHazardsStep control={control} register={register} errors={errors} riskEntryFieldArray={riskEntryFieldArray} />
          </>
        )}

        {isReviewStep && (
          <WizardReviewStep
            groups={reviewBuilder(watchedValues as ParticipantFormData, WIZARD_STEPS)}
            steps={WIZARD_STEPS}
            onEdit={wizard.goToStep}
          />
        )}
          </Card>

        <WizardNavFooter
          showBack={wizard.stepIndex > 0}
          onBack={wizard.handleBack}
          onNext={wizard.handleNext}
          isReviewStep={isReviewStep}
          secondaryActions={secondaryActions}
          cancelTo={isEditMode ? `/participants/${id}` : '/participants'}
          submitLabel={saveMutation.isPending ? (isEditMode ? 'Saving...' : 'Creating...') : 'Complete Intake'}
          isSubmitting={saveMutation.isPending || wizard.isAdvancing}
        />
        </form>
      </WizardShell>
    </div>
  )
}
