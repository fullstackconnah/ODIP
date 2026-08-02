import { useNavigate, useParams, Link } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateParticipant, useUpdateParticipant, useParticipant, useStaff } from '@/api/hooks'
import { ArrowLeft } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'
import { useEffect } from 'react'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'

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
  wheelchairRequired: z.boolean().optional(),
  isHighSupport: z.boolean().optional(),
  isIntensiveSupport: z.boolean().optional(),
  requiresOvernightSupport: z.boolean().optional(),
  hasRestrictivePracticeFlag: z.boolean().optional(),
  supportRatio: z.string().min(1),
  mobilityNotes: z.string().optional(),
  equipmentRequirements: z.string().optional(),
  transportRequirements: z.string().optional(),
  medicalSummary: z.string().optional(),
  behaviourRiskSummary: z.string().optional(),
  notes: z.string().optional(),
  preferredStaffId: z.string().optional().nullable(),
})

type ParticipantFormData = z.infer<typeof participantSchema>

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

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<ParticipantFormData>({
    resolver: zodResolver(participantSchema),
    defaultValues: {
      planType: 'SelfManaged',
      supportRatio: 'SharedSupport',
      isRepeatClient: false,
      wheelchairRequired: false,
      isHighSupport: false,
      isIntensiveSupport: false,
      requiresOvernightSupport: false,
      hasRestrictivePracticeFlag: false,
      preferredStaffId: null,
    },
  })

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
        wheelchairRequired: existing.wheelchairRequired ?? false,
        isHighSupport: existing.isHighSupport ?? false,
        isIntensiveSupport: existing.isIntensiveSupport ?? false,
        requiresOvernightSupport: existing.requiresOvernightSupport ?? false,
        hasRestrictivePracticeFlag: existing.hasRestrictivePracticeFlag ?? false,
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
        if (res.success) navigate(`/participants/${id}`)
      } else {
        const res = await createParticipant.mutateAsync(payload)
        if (res.success && res.data?.id) navigate(`/participants/${res.data.id}`)
      }
    } catch {
      // error handled by mutation state
    }
  }

  if (isEdit && isLoadingExisting) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading...</div>

  return (
    <div className="space-y-6 animate-fade-in">
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
          <FormField label="Plan Type" required>
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
          <FormField label="Wheelchair Required" layout="checkbox">
            <input type="checkbox" {...register('wheelchairRequired')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          <FormField label="High Support" layout="checkbox">
            <input type="checkbox" {...register('isHighSupport')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          <FormField label="Intensive Support (NDIS billing)" layout="checkbox">
            <input type="checkbox" {...register('isIntensiveSupport')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          <FormField label="Requires Overnight Support" layout="checkbox">
            <input type="checkbox" {...register('requiresOvernightSupport')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          <FormField label="Restrictive Practice Flag" layout="checkbox">
            <input type="checkbox" {...register('hasRestrictivePracticeFlag')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          <FormField label="Support Ratio" required>
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

        {/* Notes & Requirements */}
        <Card title="Notes & Requirements" className="space-y-4">
          <FormField label="Mobility Notes">
            <textarea {...register('mobilityNotes')} rows={2} placeholder="Any mobility considerations..." />
          </FormField>

          <FormField label="Equipment Requirements">
            <textarea {...register('equipmentRequirements')} rows={2} placeholder="Required equipment..." />
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
            className="px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all shadow-md shadow-blue-500/20">
            {mutation.isPending ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Participant')}
          </button>
        </div>
      </form>
    </div>
  )
}
