import { useNavigate, useParams, Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, useWatch, Controller, type Resolver, type FieldErrors } from 'react-hook-form'
import { z } from 'zod'
import { useCreateParticipant, useUpdateParticipant, useParticipant, useStaff } from '@/api/hooks'
import { ArrowLeft } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'
import { useEffect } from 'react'
import { FormField, labelClass } from '@/components/FormField'
import { Card } from '@/components/Card'
import { OVERNIGHT_SUPPORT_TYPES, SUPPORT_RATIOS } from '@/api/types/enums'
import { MOBILITY_SUPPORT_OPTIONS, OVERNIGHT_SUPPORT_LABELS, OVERNIGHT_RATIO_LABELS } from '@/api/types/participants'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'

const participantSchema = z.object({
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
}).superRefine((data, ctx) => {
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
})

type ParticipantFormData = z.infer<typeof participantSchema>

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

  const { register, handleSubmit, reset, control, setValue, formState: { errors, isDirty } } = useForm<ParticipantFormData>({
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

  const overnightSupportValue = useWatch({ control, name: 'overnightSupport' })
  const hasHiLoBed = useWatch({ control, name: 'requiresHiLoBed' })
  const hasHoist = useWatch({ control, name: 'requiresHoist' })
  const hasShowerChair = useWatch({ control, name: 'requiresShowerChair' })
  const hasCommode = useWatch({ control, name: 'requiresCommode' })
  const hasStandingMachine = useWatch({ control, name: 'requiresStandingMachine' })
  const hasAnyEquipment = !!(hasHiLoBed || hasHoist || hasShowerChair || hasCommode || hasStandingMachine)

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

      <form onSubmit={handleSubmit(onSubmit)} className="grid md:grid-cols-2 gap-6">
        {/* Personal Information */}
        <Card title="Personal Information" className="space-y-4">
          <FormField label="First Name" required error={errors.firstName?.message}>
            <input {...register('firstName')} placeholder="e.g. John" autoFocus />
          </FormField>

          <FormField label="Last Name" required error={errors.lastName?.message}>
            <input {...register('lastName')} placeholder="e.g. Smith" />
          </FormField>

          <FormField label="Preferred Name">
            <input {...register('preferredName')} placeholder="e.g. Johnny" />
          </FormField>

          <FormField label="Date of Birth">
            <input type="date" {...register('dateOfBirth')} />
          </FormField>

          <FormField label="NDIS Number">
            <input {...register('ndisNumber')} placeholder="e.g. 431234567" />
          </FormField>
        </Card>

        {/* Plan & Region */}
        <Card title="Plan & Region" className="space-y-4">
          <FormField label="Plan Type" required error={errors.planType?.message}>
            <Controller
              control={control}
              name="planType"
              render={({ field }) => (
                <Dropdown
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
            <input {...register('region')} placeholder="e.g. QLD" />
          </FormField>

          <FormField label="Funding Organisation">
            <input {...register('fundingOrganisation')} placeholder="e.g. Plan Partners" />
          </FormField>

          <FormField label="Repeat Client" layout="checkbox">
            <input type="checkbox" {...register('isRepeatClient')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
        </Card>

        {/* Support Needs */}
        <Card title="Support Needs" className="space-y-4">
          <FormField label="High Support" layout="checkbox">
            <input type="checkbox" {...register('isHighSupport')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          <FormField label="Intensive Support (NDIS billing)" layout="checkbox">
            <input type="checkbox" {...register('isIntensiveSupport')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          {isEdit && existing?.hasRestrictivePracticeFlag && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-1.5">
              <span className="material-symbols-outlined text-base leading-none text-amber-500">warning</span>
              <p className="text-sm text-amber-900">
                Restrictive practice flag — derived from an active entry in the participant's Restrictive Practices register (see that tab). It can no longer be set here directly.
              </p>
            </div>
          )}

          <FormField label="Support Ratio" required error={errors.supportRatio?.message}>
            <Controller
              control={control}
              name="supportRatio"
              render={({ field }) => (
                <Dropdown
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

        {/* Mobility Aids & Support */}
        <Card title="Mobility Aids & Support" className="space-y-4">
          <fieldset className="m-0 p-0 border-0">
            <legend className={labelClass}>Mobility Aids</legend>
            <div>
              <FormField label="Wheelchair" layout="checkbox">
                <input type="checkbox" {...register('mobilityAidWheelchair')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>
              <FormField label="Walker" layout="checkbox">
                <input type="checkbox" {...register('mobilityAidWalker')} className="w-4 h-4 rounded border-[var(--color-border)]" />
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

        {/* Overnight Support */}
        <Card title="Overnight Support" className="space-y-4">
          <FormField label="Overnight Support">
            <select {...register('overnightSupport')}>
              {OVERNIGHT_SUPPORT_TYPES.map((type) => (
                <option key={type} value={type}>{OVERNIGHT_SUPPORT_LABELS[type]}</option>
              ))}
            </select>
          </FormField>

          {overnightSupportValue !== 'None' && (
            <FormField label="Overnight Ratio">
              <select {...register('overnightRatio')}>
                {SUPPORT_RATIOS.map((ratio) => (
                  <option key={ratio} value={ratio}>{OVERNIGHT_RATIO_LABELS[ratio]}</option>
                ))}
              </select>
            </FormField>
          )}
        </Card>

        {/* Equipment */}
        <Card title="Equipment" className="space-y-4">
          <fieldset className="m-0 p-0 border-0 space-y-4">
            {/* Card already renders a visible "Equipment" heading above; this legend exists
                only to give the fieldset an accessible group name for screen readers. */}
            <legend className="sr-only">Equipment</legend>
            <FormField label="Hi-Lo Bed" layout="checkbox">
              <input type="checkbox" {...register('requiresHiLoBed')} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>

            <FormField label="Hoist" layout="checkbox">
              <input type="checkbox" {...register('requiresHoist')} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>

            <FormField label="Shower Chair" layout="checkbox">
              <input type="checkbox" {...register('requiresShowerChair')} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>

            <FormField label="Commode" layout="checkbox">
              <input type="checkbox" {...register('requiresCommode')} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>

            <FormField label="Standing Machine" layout="checkbox">
              <input type="checkbox" {...register('requiresStandingMachine')} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>
          </fieldset>
        </Card>

        {/* Notes & Requirements */}
        <Card title="Notes & Requirements" className="space-y-4">
          <FormField label="Mobility Notes">
            <textarea {...register('mobilityNotes')} rows={2} placeholder="Any mobility considerations..." />
          </FormField>

          <FormField
            label="Equipment Requirements"
            error={errors.equipmentRequirements?.message}
            hint={!hasAnyEquipment ? 'Select at least one equipment option above to enable notes.' : undefined}
          >
            <textarea
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
            <textarea {...register('transportRequirements')} rows={2} placeholder="Transport needs..." />
          </FormField>

          <FormField label="Medical Summary">
            <textarea {...register('medicalSummary')} rows={2} placeholder="Medical information..." />
          </FormField>

          <FormField label="Behaviour Risk Summary">
            <textarea {...register('behaviourRiskSummary')} rows={2} placeholder="Behaviour risk notes..." />
          </FormField>

          <FormField label="General Notes">
            <textarea {...register('notes')} rows={2} placeholder="Any additional notes..." />
          </FormField>
        </Card>

        {/* Staff Preferences */}
        <Card title="Staff Preferences" className="space-y-4">
          <FormField label="Preferred Staff Member">
            <Controller
              control={control}
              name="preferredStaffId"
              render={({ field }) => (
                <Dropdown
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

        {/* Submit */}
        <div className="md:col-span-2 flex justify-end gap-3">
          <Link to="/participants" className="px-6 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors">
            Cancel
          </Link>
          <button type="submit" disabled={mutation.isPending}
            className="px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all shadow-md shadow-[var(--color-primary)]/20">
            {mutation.isPending ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Participant')}
          </button>
        </div>
      </form>
    </div>
  )
}
