/**
 * PF-10.3 (SPEC-05 `docs/specs/odip-updates-2026-09/SPEC-05-intake-profile-split.md`) — the new
 * Intake wizard. Replaces `ParticipantCreatePage.tsx` at the `/participants/new` route (that file
 * itself is untouched — PF-10.7 retires it later, once PF-10.4's Profile wizard also exists).
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
 * "Save as draft" still lands on the detail page), navigates to the Profile wizard
 * (`/participants/{id}/profile`, PF-10.4) — see the `onSubmit` handler below.
 */
import { useNavigate, Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, useFieldArray, useWatch } from 'react-hook-form'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useCreateParticipant, usePersons } from '@/api/hooks'
import {
  useWizard, WizardStepRail, WizardNavFooter, WizardReviewStep, REVIEW_STEP_KEY,
  type WizardStepDef, type WizardValidate, type WizardSecondaryAction, type ReviewGroup, type ReviewRow,
} from '@/components/wizard'
import {
  type ParticipantFormData, intakeParticipantResolver, INTAKE_STEP_SCHEMAS_BY_KEY,
  STEP_PARTICIPANT_DETAILS_FIELDS, STEP_NDIS_FUNDING_FIELDS, STEP_CONTACTS_FIELDS,
  STEP_CULTURAL_FIELDS, STEP_SUPPORT_FIELDS, STEP_MEDICAL_FIELDS, STEP_BEHAVIOUR_FIELDS, STEP_RISKS_FIELDS,
} from '@/lib/participantSchema'
import { formatServiceStreams } from '@/api/types/participants'
import { planTypeComplianceWarning } from '@/api/types/contacts'
import type { PlanType, ServiceStream } from '@/api/types/enums'
import { focusField, triStateToBool, extractErrorMessage } from './intakeFormat'
import { ParticipantDetailsStep } from './steps/ParticipantDetailsStep'
import { NdisFundingStep } from './steps/NdisFundingStep'
import { ContactsStep } from './steps/ContactsStep'
import { CulturalConsiderationsStep } from './steps/CulturalConsiderationsStep'
import { SupportNeedsStep } from './steps/SupportNeedsStep'
import { MedicalSummaryStep } from './steps/MedicalSummaryStep'
import { BehaviourSummaryStep } from './steps/BehaviourSummaryStep'
import { RisksHazardsStep } from './steps/RisksHazardsStep'

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
  const navigate = useNavigate()
  const createParticipant = useCreateParticipant()
  const { data: people = [] } = usePersons()

  const { register, handleSubmit, control, getValues, setValue, watch, setError, clearErrors, formState: { errors } } = useForm<ParticipantFormData>({
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
  const requestFocus = (fieldName: string) => setFocusRequest({ field: fieldName })
  useEffect(() => {
    if (focusRequest) focusField(focusRequest.field)
  }, [focusRequest])
  useEffect(() => {
    focusField('firstName')
  }, [])

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
    return payload
  }

  const onSubmit = async (data: ParticipantFormData) => {
    // SPEC-05 (PF-10.5): IsDraft stays true across the entire Intake-done/Profile-pending span —
    // only the Profile wizard (PF-10.4) ever flips it false. completeIntake=true stamps
    // IntakeCompletedAt server-side; it is a distinct flag from IsDraft, not its replacement.
    const payload = buildIntakePayload(data, true, true)
    try {
      const res = await createParticipant.mutateAsync(payload as never)
      if (res.success && res.data?.id) {
        // PF-10.4: the Profile wizard now exists — hand off there directly instead of the detail
        // page. PF-10.5 still owns the fuller three-way resume-banner logic described in SPEC-05
        // (e.g. resuming a not-yet-profile-completed participant from the detail page later).
        navigate(`/participants/${res.data.id}/profile`)
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
      const res = await createParticipant.mutateAsync(payload as never)
      if (res.success && res.data?.id) {
        flushSync(() => {})
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
      disabled: savingDraft || createParticipant.isPending,
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
        rows.push({ label: 'Contacts added', value: String((values.contactRoles ?? []).length) })
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
          { label: 'Risk Entries', value: String((values.riskEntries ?? []).length) },
        )
      }
      return { stepKey: step.key, rows }
    })
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/participants" className="p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl md:text-2xl font-bold">Intake</h1>
      </div>

      {createParticipant.isError && (
        <div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm">
          Failed to create participant. Please check your input and try again.
        </div>
      )}
      {draftError && (
        <div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm">
          {draftError}
        </div>
      )}

      <WizardStepRail
        steps={WIZARD_STEPS_FOR_RAIL}
        visitedSteps={wizard.visitedSteps}
        currentKey={isReviewStep ? REVIEW_STEP_KEY : currentStep.key}
        onSelect={wizard.goToStep}
      />

      <form onSubmit={handleSubmit(onSubmit, wizard.handleInvalidSubmit)} noValidate>
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
          <ContactsStep
            control={control} register={register} errors={errors} setValue={setValue} watch={watch}
            people={people} contactRoleFieldArray={contactRoleFieldArray}
            planTypeComplianceWarningValue={planTypeComplianceWarningValue}
          />
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
          <RisksHazardsStep control={control} register={register} errors={errors} riskEntryFieldArray={riskEntryFieldArray} />
        )}

        {isReviewStep && (
          <WizardReviewStep
            groups={reviewBuilder(watchedValues as ParticipantFormData, WIZARD_STEPS)}
            steps={WIZARD_STEPS}
            onEdit={wizard.goToStep}
          />
        )}

        <WizardNavFooter
          showBack={wizard.stepIndex > 0}
          onBack={wizard.handleBack}
          onNext={wizard.handleNext}
          isReviewStep={isReviewStep}
          secondaryActions={secondaryActions}
          cancelTo="/participants"
          submitLabel={createParticipant.isPending ? 'Creating...' : 'Complete Intake'}
          isSubmitting={createParticipant.isPending || wizard.isAdvancing}
        />
      </form>
    </div>
  )
}
