import { useNavigate, useParams, Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateStaff, useUpdateStaff, useStaffDetail } from '@/api/hooks'
import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'

const staffSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  role: z.string().min(1, 'Role is required'),
  email: z.string().optional(),
  mobile: z.string().optional(),
  region: z.string().optional(),
  isDriverEligible: z.boolean().optional(),
  isFirstAidQualified: z.boolean().optional(),
  isMedicationCompetent: z.boolean().optional(),
  isManualHandlingCompetent: z.boolean().optional(),
  isOvernightEligible: z.boolean().optional(),
  firstAidExpiryDate: z.string().optional(),
  driverLicenceExpiryDate: z.string().optional(),
  manualHandlingExpiryDate: z.string().optional(),
  medicationCompetencyExpiryDate: z.string().optional(),
  workerScreeningNumber: z.string().optional(),
  workerScreeningExpiryDate: z.string().optional(),
  notes: z.string().optional(),
})

type StaffFormData = z.infer<typeof staffSchema>

export default function StaffCreatePage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = !!id
  const createStaff = useCreateStaff()
  const updateStaff = useUpdateStaff()
  const { data: existing, isLoading: isLoadingExisting } = useStaffDetail(isEdit ? id : undefined)
  const mutation = isEdit ? updateStaff : createStaff

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<StaffFormData>({
    resolver: zodResolver(staffSchema),
    defaultValues: {
      role: 'SupportWorker',
      isDriverEligible: false,
      isFirstAidQualified: false,
      isMedicationCompetent: false,
      isManualHandlingCompetent: false,
      isOvernightEligible: false,
    },
  })

  useEffect(() => {
    if (existing) {
      reset({
        firstName: existing.firstName ?? '',
        lastName: existing.lastName ?? '',
        role: existing.role ?? 'SupportWorker',
        email: existing.email ?? '',
        mobile: existing.mobile ?? '',
        region: existing.region ?? '',
        isDriverEligible: existing.isDriverEligible ?? false,
        isFirstAidQualified: existing.isFirstAidQualified ?? false,
        isMedicationCompetent: existing.isMedicationCompetent ?? false,
        isManualHandlingCompetent: existing.isManualHandlingCompetent ?? false,
        isOvernightEligible: existing.isOvernightEligible ?? false,
        firstAidExpiryDate: existing.firstAidExpiryDate ?? '',
        driverLicenceExpiryDate: existing.driverLicenceExpiryDate ?? '',
        manualHandlingExpiryDate: existing.manualHandlingExpiryDate ?? '',
        medicationCompetencyExpiryDate: existing.medicationCompetencyExpiryDate ?? '',
        workerScreeningNumber: existing.workerScreeningNumber ?? '',
        workerScreeningExpiryDate: existing.workerScreeningExpiryDate ?? '',
        notes: existing.notes ?? '',
      })
    }
  }, [existing, reset])

  const onSubmit = async (data: StaffFormData) => {
    const payload: any = { ...data }
    for (const key of Object.keys(payload)) {
      if (payload[key] === '' || payload[key] === undefined) payload[key] = null
    }
    try {
      if (isEdit) {
        const res = await updateStaff.mutateAsync({ id, data: { ...payload, isActive: existing?.isActive ?? true } })
        if (res.success) {
          flushSync(() => reset(data))
          navigate('/staff')
        }
      } else {
        const res = await createStaff.mutateAsync(payload)
        if (res.success) {
          flushSync(() => reset(data))
          navigate('/staff')
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
        <Link to="/staff" className="p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl md:text-2xl font-bold">{isEdit ? 'Edit Staff Member' : 'New Staff Member'}</h1>
      </div>

      {mutation.isError && (
        <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          Failed to {isEdit ? 'update' : 'create'} staff member. Please check your input and try again.
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="grid md:grid-cols-2 gap-6">
        {/* Personal Information */}
        <Card title="Personal Information" className="space-y-4">
          <FormField label="First Name" required error={errors.firstName?.message}>
            <input {...register('firstName')} placeholder="e.g. Sarah" autoFocus />
          </FormField>

          <FormField label="Last Name" required error={errors.lastName?.message}>
            <input {...register('lastName')} placeholder="e.g. Mitchell" />
          </FormField>

          <FormField label="Role" required>
            <select {...register('role')}>
              <option value="SupportWorker">Support Worker</option>
              <option value="SeniorSupportWorker">Senior Support Worker</option>
              <option value="Coordinator">Coordinator</option>
              <option value="TeamLeader">Team Leader</option>
              <option value="Other">Other</option>
            </select>
          </FormField>

          <FormField label="Region">
            <input {...register('region')} placeholder="e.g. South East QLD" />
          </FormField>
        </Card>

        {/* Contact */}
        <Card title="Contact" className="space-y-4">
          <FormField label="Email">
            <input type="email" {...register('email')} placeholder="e.g. sarah@odip.com.au" />
          </FormField>

          <FormField label="Mobile">
            <input {...register('mobile')} placeholder="e.g. 0412 345 678" />
          </FormField>

          <FormField label="Notes">
            <textarea {...register('notes')} rows={4} placeholder="Any additional notes..." />
          </FormField>
        </Card>

        {/* Qualifications */}
        <Card title="Qualifications & Eligibility" className="space-y-4 md:col-span-2">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <FormField label="First Aid Qualified" layout="checkbox">
                <input type="checkbox" {...register('isFirstAidQualified')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>
              <div className="ml-7">
                <FormField label="Expiry date">
                  <input type="date" {...register('firstAidExpiryDate')} />
                </FormField>
              </div>
            </div>

            <div className="space-y-1">
              <FormField label="Driver Eligible" layout="checkbox">
                <input type="checkbox" {...register('isDriverEligible')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>
              <div className="ml-7">
                <FormField label="Licence expiry date">
                  <input type="date" {...register('driverLicenceExpiryDate')} />
                </FormField>
              </div>
            </div>

            <div className="space-y-1">
              <FormField label="Manual Handling Competent" layout="checkbox">
                <input type="checkbox" {...register('isManualHandlingCompetent')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>
              <div className="ml-7">
                <FormField label="Expiry date">
                  <input type="date" {...register('manualHandlingExpiryDate')} />
                </FormField>
              </div>
            </div>

            <div className="space-y-1">
              <FormField label="Medication Competent" layout="checkbox">
                <input type="checkbox" {...register('isMedicationCompetent')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>
              <div className="ml-7">
                <FormField label="Expiry date">
                  <input type="date" {...register('medicationCompetencyExpiryDate')} />
                </FormField>
              </div>
            </div>

            <FormField label="Overnight Eligible" layout="checkbox">
              <input type="checkbox" {...register('isOvernightEligible')} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>

            <div className="space-y-1">
              <FormField label="Worker screening number">
                <input {...register('workerScreeningNumber')} placeholder="e.g. WWC1234567" />
              </FormField>
              <FormField label="Worker screening expiry">
                <input type="date" {...register('workerScreeningExpiryDate')} />
              </FormField>
            </div>
          </div>
        </Card>

        {/* Submit */}
        <div className="md:col-span-2 flex justify-end gap-3">
          <Link to="/staff" className="px-6 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors">
            Cancel
          </Link>
          <button type="submit" disabled={mutation.isPending}
            className="px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all shadow-md shadow-[var(--color-primary)]/20">
            {mutation.isPending ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Staff Member')}
          </button>
        </div>
      </form>
    </div>
  )
}
