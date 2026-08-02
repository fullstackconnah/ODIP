import { useNavigate, useParams, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateVehicle, useUpdateVehicle, useVehicleDetail } from '@/api/hooks'
import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'

const vehicleSchema = z.object({
  vehicleName: z.string().min(1, 'Vehicle name is required'),
  registration: z.string().optional(),
  vehicleType: z.string().min(1, 'Vehicle type is required'),
  totalSeats: z.string().min(1, 'Total seats is required'),
  wheelchairPositions: z.string(),
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

  const { register, handleSubmit, reset, formState: { errors } } = useForm<VehicleFormData>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: {
      vehicleType: 'Van',
      totalSeats: '0',
      wheelchairPositions: '0',
      isInternal: true,
    },
  })

  useEffect(() => {
    if (existing) {
      reset({
        vehicleName: existing.vehicleName ?? '',
        registration: existing.registration ?? '',
        vehicleType: existing.vehicleType ?? 'Van',
        totalSeats: String(existing.totalSeats ?? 0),
        wheelchairPositions: String(existing.wheelchairPositions ?? 0),
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
    payload.totalSeats = Number(payload.totalSeats) || 0
    payload.wheelchairPositions = Number(payload.wheelchairPositions) || 0
    for (const key of Object.keys(payload)) {
      if (payload[key] === '' || payload[key] === undefined) payload[key] = null
    }
    try {
      if (isEdit) {
        const res = await updateVehicle.mutateAsync({ id, data: { ...payload, isActive: existing?.isActive ?? true } })
        if (res.success) navigate('/vehicles')
      } else {
        const res = await createVehicle.mutateAsync(payload)
        if (res.success) navigate('/vehicles')
      }
    } catch {
      // error handled by mutation state
    }
  }

  if (isEdit && isLoadingExisting) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading...</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Link to="/vehicles" className="p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl md:text-2xl font-bold">{isEdit ? 'Edit Vehicle' : 'New Vehicle'}</h1>
      </div>

      {mutation.isError && (
        <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          Failed to {isEdit ? 'update' : 'create'} vehicle. Please check your input and try again.
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="grid md:grid-cols-2 gap-6">
        {/* Vehicle Information */}
        <Card title="Vehicle Information" className="space-y-4">
          <FormField label="Vehicle Name" required error={errors.vehicleName?.message}>
            <input {...register('vehicleName')} placeholder="e.g. Blue Van 1" autoFocus />
          </FormField>

          <FormField label="Registration">
            <input {...register('registration')} placeholder="e.g. ABC-123" />
          </FormField>

          <FormField label="Vehicle Type" required>
            <select {...register('vehicleType')}>
              <option value="Car">Car</option>
              <option value="Van">Van</option>
              <option value="Bus">Bus</option>
              <option value="MiniBus">Mini Bus</option>
              <option value="AccessibleVan">Accessible Van</option>
              <option value="Other">Other</option>
            </select>
          </FormField>

          <FormField label="Internal Vehicle" layout="checkbox">
            <input type="checkbox" {...register('isInternal')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
        </Card>

        {/* Capacity & Accessibility */}
        <Card title="Capacity & Accessibility" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Total Seats" required error={errors.totalSeats?.message}>
              <input type="number" min="0" {...register('totalSeats')} />
            </FormField>
            <FormField label="Wheelchair Positions">
              <input type="number" min="0" {...register('wheelchairPositions')} />
            </FormField>
          </div>

          <FormField label="Ramp / Hoist Details">
            <textarea {...register('rampHoistDetails')} rows={2} placeholder="Ramp or hoist specifications..." />
          </FormField>

          <FormField label="Driver Requirements">
            <textarea {...register('driverRequirements')} rows={2} placeholder="e.g. LR licence required" />
          </FormField>
        </Card>

        {/* Dates & Notes */}
        <Card title="Service & Notes" className="space-y-4 md:col-span-2">
          <div className="grid sm:grid-cols-2 gap-3">
            <FormField label="Service Due Date">
              <input type="date" {...register('serviceDueDate')} />
            </FormField>
            <FormField label="Registration Due Date">
              <input type="date" {...register('registrationDueDate')} />
            </FormField>
          </div>

          <FormField label="Notes">
            <textarea {...register('notes')} rows={3} placeholder="Any additional notes..." />
          </FormField>
        </Card>

        {/* Submit */}
        <div className="md:col-span-2 flex justify-end gap-3">
          <Link to="/vehicles" className="px-6 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors">
            Cancel
          </Link>
          <button type="submit" disabled={mutation.isPending}
            className="px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all shadow-md shadow-blue-500/20">
            {mutation.isPending ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Vehicle')}
          </button>
        </div>
      </form>
    </div>
  )
}
