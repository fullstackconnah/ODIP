import { useNavigate, useParams, Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateVehicle, useUpdateVehicle, useVehicleDetail } from '@/api/hooks'
import { useEffect } from 'react'
import { FormField } from '@/components/FormField'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { PageHeader } from '@/components/PageHeader'
import { TAP_FLOOR } from '@/components/tapArea'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { extractErrorMessage } from '@/pages/intake/intakeFormat'
import { formGrid, span } from '@/lib/formGrid'

const VEHICLE_TYPE_ITEMS: DropdownItem[] = [
  { value: 'Car', label: 'Car' },
  { value: 'Van', label: 'Van' },
  { value: 'Bus', label: 'Bus' },
  { value: 'MiniBus', label: 'Mini Bus' },
  { value: 'AccessibleVan', label: 'Accessible Van' },
  { value: 'Other', label: 'Other' },
]

const vehicleSchema = z.object({
  vehicleName: z.string().min(1, 'Vehicle name is required'),
  registration: z.string().optional(),
  vehicleType: z.string().min(1, 'Vehicle type is required'),
  totalSeats: z.coerce.number().min(0),
  wheelchairPositions: z.coerce.number().min(0),
  rampHoistDetails: z.string().optional(),
  driverRequirements: z.string().optional(),
  isInternal: z.boolean().optional(),
  serviceDueDate: z.string().optional(),
  registrationDueDate: z.string().optional(),
  notes: z.string().optional(),
})

type VehicleFormData = z.infer<typeof vehicleSchema>

export default function VehicleCreatePage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = !!id
  const createVehicle = useCreateVehicle()
  const updateVehicle = useUpdateVehicle()
  const { data: existing, isLoading: isLoadingExisting } = useVehicleDetail(isEdit ? id : undefined)
  const mutation = isEdit ? updateVehicle : createVehicle

  const { register, control, handleSubmit, reset, formState: { errors, isDirty } } = useForm<VehicleFormData>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: {
      vehicleType: 'Van',
      totalSeats: 0,
      wheelchairPositions: 0,
      isInternal: true,
    },
  })

  useEffect(() => {
    if (existing) {
      reset({
        vehicleName: existing.vehicleName ?? '',
        registration: existing.registration ?? '',
        vehicleType: existing.vehicleType ?? 'Van',
        totalSeats: existing.totalSeats ?? 0,
        wheelchairPositions: existing.wheelchairPositions ?? 0,
        rampHoistDetails: existing.rampHoistDetails ?? '',
        driverRequirements: existing.driverRequirements ?? '',
        isInternal: existing.isInternal ?? true,
        serviceDueDate: existing.serviceDueDate ?? '',
        registrationDueDate: existing.registrationDueDate ?? '',
        notes: existing.notes ?? '',
      })
    }
  }, [existing, reset])

  const onSubmit = async (data: VehicleFormData) => {
    const payload: any = { ...data }
    for (const key of Object.keys(payload)) {
      if (payload[key] === '' || payload[key] === undefined) payload[key] = null
    }
    try {
      if (isEdit) {
        const res = await updateVehicle.mutateAsync({ id, data: { ...payload, isActive: existing?.isActive ?? true } })
        if (res.success) {
          flushSync(() => reset(data))
          navigate('/vehicles')
        }
      } else {
        const res = await createVehicle.mutateAsync(payload)
        if (res.success) {
          flushSync(() => reset(data))
          navigate('/vehicles')
        }
      }
    } catch {
      // error handled by mutation state
    }
  }

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  if (isEdit && isLoadingExisting) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading...</div>

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in max-w-[1600px]">
      {unsavedChangesDialog}
      <div className="text-sm text-[var(--color-muted-foreground)]">
        <Link to="/vehicles" className={`${TAP_FLOOR} hover:text-[var(--color-foreground)] transition-colors`}>&larr; Back to Vehicles</Link>
      </div>
      <PageHeader title={isEdit ? 'Edit Vehicle' : 'New Vehicle'} />

      {mutation.isError && (
        <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          {extractErrorMessage(mutation.error, `Failed to ${isEdit ? 'update' : 'create'} vehicle. Please check your input and try again.`)}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-[var(--section-gap)]">
        {/* Vehicle Information */}
        <Card title="Vehicle Information">
          <div className={formGrid}>
            <FormField label="Vehicle Name" required error={errors.vehicleName?.message} className={span.medium}>
              <input {...register('vehicleName')} placeholder="e.g. Blue Van 1" autoFocus />
            </FormField>

            <FormField label="Registration" className={span.short}>
              <input {...register('registration')} placeholder="e.g. ABC-123" />
            </FormField>

            <FormField label="Vehicle Type" required className={span.medium}>
              <Controller
                control={control}
                name="vehicleType"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    items={VEHICLE_TYPE_ITEMS}
                  />
                )}
              />
            </FormField>

            <FormField label="Internal Vehicle" layout="checkbox" className={span.short}>
              <input type="checkbox" {...register('isInternal')} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>
          </div>
        </Card>

        {/* Capacity & Accessibility */}
        <Card title="Capacity & Accessibility">
          <div className={formGrid}>
            <FormField label="Total Seats" required error={errors.totalSeats?.message} className={span.short}>
              <input type="number" min="0" {...register('totalSeats')} />
            </FormField>
            <FormField label="Wheelchair Positions" className={span.short}>
              <input type="number" min="0" {...register('wheelchairPositions')} />
            </FormField>

            <FormField label="Ramp / Hoist Details" className={span.long}>
              <textarea {...register('rampHoistDetails')} rows={2} placeholder="Ramp or hoist specifications..." />
            </FormField>

            <FormField label="Driver Requirements" className={span.long}>
              <textarea {...register('driverRequirements')} rows={2} placeholder="e.g. LR licence required" />
            </FormField>
          </div>
        </Card>

        {/* Dates & Notes */}
        <Card title="Service & Notes">
          <div className={formGrid}>
            <FormField label="Service Due Date" className={span.short}>
              <input type="date" {...register('serviceDueDate')} />
            </FormField>
            <FormField label="Registration Due Date" className={span.short}>
              <input type="date" {...register('registrationDueDate')} />
            </FormField>

            <FormField label="Notes" className={span.long}>
              <textarea {...register('notes')} rows={3} placeholder="Any additional notes..." />
            </FormField>
          </div>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" to="/vehicles">Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Vehicle')}
          </Button>
        </div>
      </form>
    </div>
  )
}
