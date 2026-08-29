import { useNavigate, useParams, Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, useWatch, Controller, type Resolver, type FieldErrors } from 'react-hook-form'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { useCreateParticipant, useUpdateParticipant, useParticipant, useStaff } from '@/api/hooks'
import { ArrowLeft, Check } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'
import { FormField, labelClass } from '@/components/FormField'
import { Card } from '@/components/Card'
import { OVERNIGHT_SUPPORT_TYPES, SUPPORT_RATIOS } from '@/api/types/enums'
import type { SupportRatio, OvernightSupportType } from '@/api/types/enums'
import { MOBILITY_SUPPORT_OPTIONS, OVERNIGHT_SUPPORT_LABELS, OVERNIGHT_RATIO_LABELS } from '@/api/types/participants'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'

const baseParticipantSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  preferredName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  ndisNumber: z.string().optional(),
  planType: z.string().min(1),
  region: z.string().optional(),
  fundingOrganisation: z.string().optional(),
  isRepeatClient: z.boolean().optional(),
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
function equipmentRefine(data: EquipmentFields, ctx: z.RefinementCtx) {
  const hasAnyEquipment = !!(
    data.requiresHiLoBed
    || data.requiresHoist
    || data.requiresShowerChair
    || data.requiresCommode
    || data.requiresStandingMachine
  )
  if (data.equipmentRequirements && data.equipmentRequirements.trim() !== '' && !hasAnyEquipment) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['equipmentRequirements'],
      message: 'Select an equipment item, or clear these notes.',
    })
  }
}

const participantSchema = baseParticipantSchema.superRefine(equipmentRefine)

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

const STEP_IDENTITY_FIELDS = ['firstName', 'lastName', 'preferredName', 'dateOfBirth', 'preferredStaffId'] as const
const STEP_NDIS_FIELDS = ['ndisNumber', 'planType', 'region', 'fundingOrganisation', 'isRepeatClient'] as const
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
  baseParticipantSchema.pick(pickShape(STEP_IDENTITY_FIELDS)),
  baseParticipantSchema.pick(pickShape(STEP_NDIS_FIELDS)),
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

  const { register, handleSubmit, reset, control, setValue, getValues, setError, clearErrors, formState: { errors, isDirty } } = useForm<ParticipantFormData>({
    resolver: participantResolver,
    defaultValues: {
      planType: 'SelfManaged',
      supportRatio: 'SharedSupport',
      isRepeatClient: false,
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
  const hasHiLoBed = useWatch({ control, name: 'requiresHiLoBed' })
  const hasHoist = useWatch({ control, name: 'requiresHoist' })
  const hasShowerChair = useWatch({ control, name: 'requiresShowerChair' })
  const hasCommode = useWatch({ control, name: 'requiresCommode' })
  const hasStandingMachine = useWatch({ control, name: 'requiresStandingMachine' })
  const hasAnyEquipment = !!(hasHiLoBed || hasHoist || hasShowerChair || hasCommode || hasStandingMachine)

  // Watches the whole form (no `name`) so the Review step can render live values without
  // relying on getValues(), which wouldn't reflect uncontrolled register()'d input changes.
  const watchedValues = useWatch({ control })

  useEffect(() => {
    if (overnightSupportValue === 'None') {
      setValue('overnightRatio', 'OneToOne')
    }
  }, [overnightSupportValue, setValue])

  useEffect(() => {
    if (existing) {
      reset({
        firstName: existing.firstName ?? '',
        lastName: existing.lastName ?? '',
        preferredName: existing.preferredName ?? '',
        dateOfBirth: existing.dateOfBirth ? existing.dateOfBirth.split('T')[0] : '',
        ndisNumber: existing.ndisNumber ?? '',
        planType: existing.planType ?? 'SelfManaged',
        region: existing.region ?? '',
        fundingOrganisation: existing.fundingOrganisation ?? '',
        isRepeatClient: existing.isRepeatClient ?? false,
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
    const payload: any = { ...data }
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
        { label: 'Preferred Staff Member', value: preferredStaffName },
      ],
    },
    {
      step: 1,
      rows: [
        { label: 'NDIS Number', value: watchedValues.ndisNumber || '—' },
        { label: 'Plan Type', value: PLAN_TYPE_LABELS[watchedValues.planType ?? ''] ?? '—' },
        { label: 'Region', value: watchedValues.region || '—' },
        { label: 'Funding Organisation', value: watchedValues.fundingOrganisation || '—' },
        { label: 'Repeat Client', value: watchedValues.isRepeatClient ? 'Yes' : 'No' },
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
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
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
                  <span className="hidden sm:inline">{step.label}</span>
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
          </div>
        )}

        {stepIndex === 1 && (
          <div className="grid md:grid-cols-2 gap-6">
            <Card title="NDIS & Funding" className="space-y-4">
              <FormField label="NDIS Number">
                <input id="ndisNumber" {...register('ndisNumber')} placeholder="e.g. 431234567" />
              </FormField>

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

              <FormField label="Region">
                <input id="region" {...register('region')} placeholder="e.g. QLD" />
              </FormField>

              <FormField label="Funding Organisation">
                <input id="fundingOrganisation" {...register('fundingOrganisation')} placeholder="e.g. Plan Partners" />
              </FormField>

              <FormField label="Repeat Client" layout="checkbox">
                <input id="isRepeatClient" type="checkbox" {...register('isRepeatClient')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>
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
                          <label key={option} className="flex items-center gap-3 py-1">
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
                    className="text-sm font-medium text-[var(--color-primary)] hover:underline"
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
                      <dd className="font-medium text-right">{row.value}</dd>
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
                className="px-6 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors"
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
                className="px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-[var(--color-primary)]/20"
              >
                Next
              </button>
            )}
            {stepIndex === REVIEW_STEP_INDEX && (
              <>
                <Link to="/participants" className="px-6 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors">
                  Cancel
                </Link>
                <button type="submit" disabled={mutation.isPending}
                  className="px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all shadow-md shadow-[var(--color-primary)]/20">
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
