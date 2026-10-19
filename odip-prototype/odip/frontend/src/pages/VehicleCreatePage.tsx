import { useNavigate, useParams } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateVehicle, useUpdateVehicle, useVehicleDetail } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { PageHeader } from '@/components/PageHeader'
import { BackButton } from '@/components/BackButton'
import { usePermissions } from '@/lib/permissions'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { extractErrorMessage } from '@/pages/intake/intakeFormat'
import { formGrid, span } from '@/lib/formGrid'
import { useFillOnce } from '@/hooks/useFillOnce'
import { Callout } from '@/components/Callout'
import { PageState } from '@/components/PageState'
import { isNotFoundError } from '@/lib/httpStatus'

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
  // ReadOnly reads a vehicle's full record (notes, ramp, driver requirements) only here: the route admits it to /:id/edit, not /new.
  const { canWrite } = usePermissions()
  const viewOnly = isEdit && !canWrite
  const createVehicle = useCreateVehicle()
  const updateVehicle = useUpdateVehicle()
  const { data: existing, isError: isExistingError, error: existingError, refetch: refetchExisting } = useVehicleDetail(isEdit ? id : undefined)
  const mutation = isEdit ? updateVehicle : createVehicle

  const { register, control, handleSubmit, reset, formState: { errors, isDirty } } = useForm({
    resolver: zodResolver(vehicleSchema),
    defaultValues: {
      vehicleType: 'Van',
      totalSeats: 0,
      wheelchairPositions: 0,
      isInternal: true,
    },
  })

  useFillOnce(existing, record => {
    reset({
      vehicleName: record.vehicleName ?? '',
      registration: record.registration ?? '',
      vehicleType: record.vehicleType ?? 'Van',
      totalSeats: record.totalSeats ?? 0,
      wheelchairPositions: record.wheelchairPositions ?? 0,
      rampHoistDetails: record.rampHoistDetails ?? '',
      driverRequirements: record.driverRequirements ?? '',
      isInternal: record.isInternal ?? true,
      serviceDueDate: record.serviceDueDate ?? '',
      registrationDueDate: record.registrationDueDate ?? '',
      notes: record.notes ?? '',
    })
  }, !isDirty)

  const onSubmit = async (data: VehicleFormData) => {
    const payload: any = { ...data }
    for (const key of Object.keys(payload)) {
      if (payload[key] === '' || payload[key] === undefined) payload[key] = null
    }
    try {
      if (isEdit) {
        const res = await updateVehicle.mutateAsync({ id, data: payload })
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

  // A record that has not loaded is never a blank form: saving it would overwrite the real one.
  if (isEdit && !existing) {
    if (!isExistingError) return <PageState kind="loading" noun="vehicle" />
    return isNotFoundError(existingError)
      ? <PageState kind="not-found" noun="vehicle" backTo="/vehicles" backLabel="vehicles" />
      : <PageState kind="error" noun="vehicle" onRetry={() => refetchExisting()} />
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in max-w-[1600px]">
      {unsavedChangesDialog}
      <div className="flex items-start gap-2">
        <BackButton to="/vehicles" label="vehicles" variant="icon" history={false} />
        <div className="flex-1 min-w-0"><PageHeader title={viewOnly ? 'View vehicle' : isEdit ? 'Edit vehicle' : 'New vehicle'} /></div>
      </div>

      {mutation.isError && (
        <Callout tone="error">
          {extractErrorMessage(mutation.error, `Failed to ${isEdit ? 'update' : 'create'} vehicle. Please check your input and try again.`)}
        </Callout>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-[var(--section-gap)]">
        <fieldset disabled={viewOnly} className="flex flex-col gap-[var(--section-gap)] min-w-0">
        {/* Vehicle Information */}
        <Card title="Vehicle information">
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
        <Card title="Capacity & accessibility">
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
        <Card title="Service & notes">
          <div className={formGrid}>
            <FormField label="Service Due Date" className={span.date}>
              <input type="date" {...register('serviceDueDate')} />
            </FormField>
            <FormField label="Registration Due Date" className={span.date}>
              <input type="date" {...register('registrationDueDate')} />
            </FormField>

            <FormField label="Notes" className={span.long}>
              <textarea {...register('notes')} rows={3} placeholder="Any additional notes..." />
            </FormField>
          </div>
        </Card>

        </fieldset>

        {/* Submit */}
        {!viewOnly && <div className="flex justify-end gap-3">
          <Button variant="secondary" to="/vehicles">Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save' : 'Create vehicle')}
          </Button>
        </div>}
      </form>
    </div>
  )
}
