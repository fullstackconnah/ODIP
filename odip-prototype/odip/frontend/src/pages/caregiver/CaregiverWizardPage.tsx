/**
 * cg03 — the public, session-free caregiver profile form. Renders OUTSIDE the authenticated
 * app shell (see App.tsx's route placement): no admin layout chrome, no permission checks, no
 * read of the admin session's stored identity.
 * Authentication is the link token in the URL and nothing else — every request goes through
 * `caregiverApiClient` (src/api/caregiverClient.ts), which deliberately carries no Authorization
 * or X-View-As-* header and no credentials.
 *
 * Reuses the Profile wizard's step components for the editable fields (KeyIdentifiersStep /
 * BehaviourCognitionStep take a `hiddenFields` prop so the two allocation-contract fields
 * classified `CAREGIVER_INTERNAL_FIELDS` — preferredStaffId, behaviourRiskRating — are never
 * rendered). Shared/Intake-owned fields render read-only exactly as they do on the real Profile
 * wizard (the ReadOnlyField convention), sourced from the caregiver-visible projection
 * (`form.data.current`) rather than a live `useParticipant` query.
 *
 * Step 0 "About you" gates every later step: `validateStep` fails until a name is entered, so
 * `useWizard`'s `visitedSteps` never advances past it (mirrors the Profile wizard's own
 * per-step-save `validate` wiring — see ProfileWizardPage.tsx).
 */
import { useParams } from 'react-router-dom'
import { useForm, useFieldArray, useWatch } from 'react-hook-form'
import type { Control, FieldErrors, UseFieldArrayReturn, UseFormRegister } from 'react-hook-form'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { usePublicCaregiverForm, useSaveCaregiverDraft, useSubmitCaregiverForm } from '@/api/hooks/caregiver'
import {
  useWizard, WizardStepRail, WizardNavFooter, WizardReviewStep, WizardStepHeading, REVIEW_STEP_KEY,
  type WizardStepDef, type WizardValidate, type ReviewGroup,
} from '@/components/wizard'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import {
  PROFILE_STEP_SCHEMAS_BY_KEY,
  PROFILE_STEP_KEY_IDENTIFIERS_FIELDS, PROFILE_STEP_CULTURAL_DEPTH_FIELDS, PROFILE_STEP_MEDICAL_FIELDS,
  PROFILE_STEP_MOBILITY_FIELDS, PROFILE_STEP_BEHAVIOUR_FIELDS, PROFILE_STEP_DAILY_LIVING_FIELDS,
  type ParticipantFormData,
} from '@/lib/participantSchema'
import { buildProfileStepPatch } from '@/lib/participantPatchGroups'
import { CAREGIVER_INTERNAL_FIELDS } from '@/lib/caregiverFields'
import { label as fieldLabel, norm as normValue } from '@/lib/caregiverDiff'
import type { PatchParticipantDto } from '@/api/types/participant-patch'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { KeyIdentifiersStep } from '../profile/steps/KeyIdentifiersStep'
import { CulturalDepthConsentsStep } from '../profile/steps/CulturalDepthConsentsStep'
import { MedicalDetailStep } from '../profile/steps/MedicalDetailStep'
import { MobilityFunctionalStep } from '../profile/steps/MobilityFunctionalStep'
import { BehaviourCognitionStep } from '../profile/steps/BehaviourCognitionStep'
import { DailyLivingStep } from '../profile/steps/DailyLivingStep'
import { AboutYouStep } from './steps/AboutYouStep'
import { hydrateFormFromProjection } from './hydrate'

export type CaregiverFormData = ParticipantFormData & { caregiverName: string; caregiverRelationship?: string }

const ABOUT_YOU_FIELDS = ['caregiverName', 'caregiverRelationship'] as const
const aboutYouSchema = z.object({ caregiverName: z.string().trim().min(1, 'Please enter your name') })

const PROFILE_STEP_GROUP_KEYS = ['keyIdentifiers', 'culturalDepth', 'medical', 'mobility', 'behaviourCognition', 'dailyLiving'] as const

export default function CaregiverWizardPage() {
  const { token } = useParams<{ token: string }>()
  const form = usePublicCaregiverForm(token)
  const saveDraft = useSaveCaregiverDraft(token)
  const submit = useSubmitCaregiverForm(token)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { control, register, getValues, setError, clearErrors, reset, formState: { errors, isDirty } } = useForm<CaregiverFormData>({
    defaultValues: {
      caregiverName: '', caregiverRelationship: '',
      consents: [], healthConditions: [], adlAssessments: [], checklistItems: [], communityAccessRiskItems: [],
    } as unknown as CaregiverFormData,
  })

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  const consentsFieldArray = useFieldArray({ control, name: 'consents' })
  const healthConditionFieldArray = useFieldArray({ control, name: 'healthConditions' })
  const adlFieldArray = useFieldArray({ control, name: 'adlAssessments' })
  const watchedValues = useWatch({ control })

  // The Profile wizard's step components are typed against `ParticipantFormData`.
  // `CaregiverFormData` adds a required `caregiverName` field, which — despite being a strict
  // superset at the value level — makes react-hook-form's invariant `Control`/`UseFormRegister`
  // generics structurally incompatible with the narrower type. Every step below only ever reads/
  // writes `ParticipantFormData`'s own fields, so this narrowing cast is safe.
  const pControl = control as unknown as Control<ParticipantFormData>
  const pRegister = register as unknown as UseFormRegister<ParticipantFormData>
  const pErrors = errors as unknown as FieldErrors<ParticipantFormData>
  const pConsentsFieldArray = consentsFieldArray as unknown as UseFieldArrayReturn<ParticipantFormData, 'consents'>
  const pHealthConditionFieldArray = healthConditionFieldArray as unknown as UseFieldArrayReturn<ParticipantFormData, 'healthConditions'>
  const pAdlFieldArray = adlFieldArray as unknown as UseFieldArrayReturn<ParticipantFormData, 'adlAssessments'>

  // Hydrate once from the projection + any saved draft. The draft (a PatchParticipantDto) wins
  // over the projection for the fields/groups it carries — see hydrate.ts.
  useEffect(() => {
    if (!form.data) return
    reset(hydrateFormFromProjection(form.data) as unknown as CaregiverFormData, { keepDefaultValues: false })
  }, [form.data, reset])

  const steps: WizardStepDef<CaregiverFormData>[] = useMemo(() => [
    { key: 'aboutYou', label: 'About you', fields: ABOUT_YOU_FIELDS },
    { key: 'keyIdentifiers', label: 'Key Identifiers', fields: PROFILE_STEP_KEY_IDENTIFIERS_FIELDS },
    { key: 'culturalDepth', label: 'Cultural & Consents', fields: PROFILE_STEP_CULTURAL_DEPTH_FIELDS },
    { key: 'medical', label: 'Medical', fields: PROFILE_STEP_MEDICAL_FIELDS },
    { key: 'mobility', label: 'Mobility & Functional', fields: PROFILE_STEP_MOBILITY_FIELDS },
    { key: 'behaviourCognition', label: 'Behaviour & Communication', fields: PROFILE_STEP_BEHAVIOUR_FIELDS },
    { key: 'dailyLiving', label: 'Daily Living', fields: PROFILE_STEP_DAILY_LIVING_FIELDS },
  ], [])
  const stepsForRail = useMemo(() => [...steps, { key: REVIEW_STEP_KEY, label: 'Review', fields: [] }], [steps])

  const buildDraftBody = () => {
    const values = getValues()
    // One PatchParticipantDto for the whole form: merge every editable step's group patch. The
    // backend's accept-time sanitiser drops internal groups/scalars regardless — the frontend
    // additionally never renders them (hiddenFields), so nothing internal is ever user-editable.
    const payload = PROFILE_STEP_GROUP_KEYS
      .map((k) => buildProfileStepPatch(k, values, false) ?? {})
      .reduce((acc, part) => ({ ...acc, ...part }), {} as Record<string, unknown>) as PatchParticipantDto
    return {
      caregiverName: values.caregiverName.trim(),
      caregiverRelationship: values.caregiverRelationship?.trim() || null,
      payload,
    }
  }

  const validateStep: WizardValidate<CaregiverFormData> = async (step, values) => {
    const schema = step.key === 'aboutYou' ? aboutYouSchema : PROFILE_STEP_SCHEMAS_BY_KEY[step.key]
    if (schema) {
      const result = schema.safeParse(values)
      if (!result.success) {
        return result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message, code: issue.code }))
      }
    }
    setSaveError(null)
    try {
      await saveDraft.mutateAsync(buildDraftBody())
      return null
    } catch {
      setSaveError("We couldn't save your progress. Please check your connection and try again.")
      return [{ path: step.fields[0] as string, message: 'Save failed — see the message above.', code: 'server' }]
    }
  }

  const wizard = useWizard<CaregiverFormData>({
    steps,
    initialVisited: 'linear',
    validate: validateStep,
    getValues,
    setError: (path, err) => setError(path as keyof CaregiverFormData, err),
    clearErrors: (paths) => clearErrors(paths as (keyof CaregiverFormData)[]),
  })

  const onSubmit = async () => {
    setSaveError(null)
    try {
      await submit.mutateAsync(buildDraftBody())
    } catch {
      setSaveError("We couldn't submit the form. Please try again.")
    }
  }

  if (form.isLoading) return <PublicShell><p>Loading…</p></PublicShell>
  if (form.isError || !form.data) return <InvalidLinkPage />
  if (form.data.status === 'Submitted') return <SubmittedPage caregiverName={form.data.caregiverName} />

  const hidden = CAREGIVER_INTERNAL_FIELDS
  const readOnlyParticipant = form.data.current as unknown as ParticipantDetailDto

  return (
    <PublicShell>
      {unsavedChangesDialog}
      {form.data.rejectionNote && (
        <div role="status" className="mb-4 p-3 rounded-lg bg-[var(--color-warning-container,var(--color-accent))] text-sm">
          <strong>Your previous submission was sent back with a note:</strong> {form.data.rejectionNote}
        </div>
      )}
      {saveError && <p role="alert" className="mb-4 text-sm text-[var(--color-destructive)]">{saveError}</p>}

      <WizardStepRail
        steps={stepsForRail}
        visitedSteps={wizard.visitedSteps}
        currentKey={wizard.isReviewStep ? REVIEW_STEP_KEY : wizard.currentStep.key}
        onSelect={wizard.goToStep}
      />

      <form onSubmit={(e) => { e.preventDefault(); void onSubmit() }} noValidate>
        <WizardStepHeading
          stepKey={wizard.isReviewStep ? REVIEW_STEP_KEY : wizard.currentStep.key}
          label={wizard.isReviewStep ? 'Review' : wizard.currentStep.label}
        />
        {!wizard.isReviewStep && wizard.currentStep.key === 'aboutYou' && (
          <AboutYouStep register={register} errors={errors} />
        )}
        {!wizard.isReviewStep && wizard.currentStep.key === 'keyIdentifiers' && (
          <KeyIdentifiersStep control={pControl} register={pRegister} errors={pErrors} participant={readOnlyParticipant} activeStaff={[]} hiddenFields={hidden} />
        )}
        {!wizard.isReviewStep && wizard.currentStep.key === 'culturalDepth' && (
          <CulturalDepthConsentsStep control={pControl} register={pRegister} participant={readOnlyParticipant} consentsFieldArray={pConsentsFieldArray} staVisible={false} />
        )}
        {!wizard.isReviewStep && wizard.currentStep.key === 'medical' && (
          <MedicalDetailStep control={pControl} register={pRegister} errors={pErrors} participant={readOnlyParticipant} healthConditionFieldArray={pHealthConditionFieldArray} watchedValues={watchedValues as Partial<ParticipantFormData>} />
        )}
        {!wizard.isReviewStep && wizard.currentStep.key === 'mobility' && (
          <MobilityFunctionalStep control={pControl} register={pRegister} participant={readOnlyParticipant} />
        )}
        {!wizard.isReviewStep && wizard.currentStep.key === 'behaviourCognition' && (
          <BehaviourCognitionStep control={pControl} register={pRegister} participant={readOnlyParticipant} hiddenFields={hidden} />
        )}
        {!wizard.isReviewStep && wizard.currentStep.key === 'dailyLiving' && (
          <DailyLivingStep control={pControl} register={pRegister} adlFieldArray={pAdlFieldArray} watchedValues={watchedValues as Partial<ParticipantFormData>} caVisible={false} />
        )}

        {wizard.isReviewStep && (
          <WizardReviewStep groups={reviewBuilder(getValues(), steps)} steps={steps} onEdit={wizard.goToStep} />
        )}

        <WizardNavFooter
          showBack={wizard.stepIndex > 0}
          onBack={wizard.handleBack}
          onNext={wizard.handleNext}
          isReviewStep={wizard.isReviewStep}
          secondaryActions={[{ key: 'saveLater', label: 'Save and continue later', onClick: async () => { await saveDraft.mutateAsync(buildDraftBody()) } }]}
          cancelTo={`/caregiver/${token}`}
          submitLabel={submit.isPending ? 'Submitting…' : 'Submit for review'}
          isSubmitting={submit.isPending || wizard.isAdvancing}
        />
      </form>
    </PublicShell>
  )
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)]">
      <div className="max-w-3xl mx-auto p-4 sm:p-8">
        <h1 className="text-2xl font-bold mb-1">Participant profile</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-6">Please check the information below and update anything that is missing or out of date.</p>
        {children}
      </div>
    </main>
  )
}

function InvalidLinkPage() {
  return (
    <PublicShell>
      <div role="status" className="p-4 rounded-lg border border-[var(--color-border)]">
        <p className="font-medium">This link is no longer valid.</p>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">If you were expecting to complete a form, please contact the person who sent it to you.</p>
      </div>
    </PublicShell>
  )
}

function SubmittedPage({ caregiverName }: { caregiverName: string | null }) {
  return (
    <PublicShell>
      <div role="status" className="p-4 rounded-lg bg-[var(--color-accent)]">
        <p className="font-medium">Thank you{caregiverName ? `, ${caregiverName}` : ''} — your form has been submitted.</p>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">It is now awaiting review. You&apos;ll be contacted if anything needs to be checked.</p>
      </div>
    </PublicShell>
  )
}

function reviewBuilder(values: CaregiverFormData, steps: WizardStepDef<CaregiverFormData>[]): ReviewGroup[] {
  return steps.map((step) => ({
    stepKey: step.key,
    rows: step.key === 'aboutYou'
      ? [{ label: 'Your name', value: values.caregiverName || '—' }, { label: 'Relationship', value: values.caregiverRelationship || '—' }]
      : step.fields.map((f) => ({ label: fieldLabel(String(f)), value: normValue((values as Record<string, unknown>)[f as string]) || '—' })),
  }))
}
