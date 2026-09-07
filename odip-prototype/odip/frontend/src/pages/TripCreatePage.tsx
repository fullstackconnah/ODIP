import { useNavigate, Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateTrip, useStaff, useEventTemplates } from '@/api/hooks'
import { ArrowLeft } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { extractErrorMessage } from '@/pages/intake/intakeFormat'

const tripSchema = z.object({
  tripName: z.string().min(1, 'Trip name is required'),
  tripCode: z.string().optional(),
  eventTemplateId: z.string().optional(),
  destination: z.string().optional(),
  region: z.string().optional(),
  startDate: z.string().min(1, 'Start date is required'),
  durationDays: z.coerce.number().min(1, 'Duration must be at least 1'),
  bookingCutoffDate: z.string().optional(),
  status: z.string().optional(),
  leadCoordinatorId: z.string().optional(),
  minParticipants: z.coerce.number().optional(),
  maxParticipants: z.coerce.number().optional(),
  requiredWheelchairCapacity: z.coerce.number().optional(),
  requiredBeds: z.coerce.number().optional(),
  requiredBedrooms: z.coerce.number().optional(),
  minStaffRequired: z.coerce.number().optional(),
  notes: z.string().optional(),
})

type TripFormData = z.infer<typeof tripSchema>

export default function TripCreatePage() {
  const navigate = useNavigate()
  const createTrip = useCreateTrip()
  const { data: staffList = [] } = useStaff()
  const { data: templates = [] } = useEventTemplates()

  const { register, handleSubmit, setValue, control, reset, formState: { errors, isDirty } } = useForm<TripFormData>({
    resolver: zodResolver(tripSchema),
    defaultValues: { durationDays: 1, status: 'Draft' },
  })

  const onTemplateChange = (templateId: string) => {
    if (!templateId) return
    const tpl = templates.find((t: any) => String(t.id) === templateId)
    if (tpl) {
      if (tpl.defaultDestination) setValue('destination', tpl.defaultDestination)
      if (tpl.defaultRegion) setValue('region', tpl.defaultRegion)
      if (tpl.standardDurationDays) setValue('durationDays', tpl.standardDurationDays)
    }
  }

  const onSubmit = async (data: TripFormData) => {
    const payload: any = { ...data }
    // Convert empty strings to null for optional fields
    for (const key of Object.keys(payload)) {
      if (payload[key] === '' || payload[key] === undefined) payload[key] = null
    }
    // Ensure numbers that are 0/NaN become null
    for (const key of ['minParticipants', 'maxParticipants', 'requiredWheelchairCapacity', 'requiredBeds', 'requiredBedrooms', 'minStaffRequired']) {
      if (!payload[key]) payload[key] = null
    }
    try {
      const res = await createTrip.mutateAsync(payload)
      if (res.success && res.data?.id) {
        flushSync(() => reset(data))
        navigate(`/trips/${res.data.id}`)
      }
    } catch {
      // error handled by mutation state
    }
  }

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  return (
    <div className="space-y-6 animate-fade-in">
      {unsavedChangesDialog}
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/trips" className="p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl md:text-2xl font-bold">Create New Trip</h1>
      </div>

      {createTrip.isError && (
        <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          {extractErrorMessage(createTrip.error, 'Failed to create trip. Please check your input and try again.')}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="grid md:grid-cols-2 gap-6">
        {/* Trip Details */}
        <Card title="Trip Details" className="space-y-4">
          <FormField label="Trip Name" required error={errors.tripName?.message}>
            <input {...register('tripName')} placeholder="e.g. Beach Getaway 2026" autoFocus />
          </FormField>

          <FormField label="Trip Code">
            <input {...register('tripCode')} placeholder="e.g. BG-2026-01" />
          </FormField>

          <FormField label="Event Template">
            <Controller
              control={control}
              name="eventTemplateId"
              render={({ field }) => (
                <Dropdown
                  variant="form"
                  value={field.value ?? ''}
                  onChange={val => { field.onChange(val); onTemplateChange(val) }}
                  onBlur={field.onBlur}
                  label="None"
                  items={[
                    { value: '', label: 'None' },
                    ...templates.map((t: any) => ({ value: String(t.id), label: t.eventName })),
                  ]}
                />
              )}
            />
          </FormField>

          <FormField label="Destination">
            <input {...register('destination')} placeholder="e.g. Gold Coast" />
          </FormField>

          <FormField label="Region">
            <input {...register('region')} placeholder="e.g. QLD" />
          </FormField>
        </Card>

        {/* Dates */}
        <Card title="Dates" className="space-y-4">
          <FormField label="Start Date" required error={errors.startDate?.message}>
            <input type="date" {...register('startDate')} />
          </FormField>

          <FormField label="Duration (Days)" required error={errors.durationDays?.message}>
            <input type="number" min={1} {...register('durationDays')} />
          </FormField>

          <FormField label="Booking Cutoff Date">
            <input type="date" {...register('bookingCutoffDate')} />
          </FormField>

          <FormField label="Status">
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Dropdown
                  variant="form"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  items={[
                    { value: 'Draft', label: 'Draft' },
                    { value: 'Planning', label: 'Planning' },
                    { value: 'OpenForBookings', label: 'Open For Bookings' },
                  ]}
                />
              )}
            />
          </FormField>

          <FormField label="Lead Coordinator">
            <Controller
              control={control}
              name="leadCoordinatorId"
              render={({ field }) => (
                <Dropdown
                  variant="form"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  label="None"
                  items={[
                    { value: '', label: 'None' },
                    ...staffList.map((s: any) => ({ value: String(s.id), label: s.fullName })),
                  ]}
                />
              )}
            />
          </FormField>
        </Card>

        {/* Capacity & Requirements */}
        <Card title="Capacity & Requirements" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Min Participants" hint="Smallest group size this trip needs to go ahead.">
              <input type="number" min={0} {...register('minParticipants')} />
            </FormField>
            <FormField label="Max Participants" hint="Booking capacity before further bookings go to a waitlist.">
              <input type="number" min={0} {...register('maxParticipants')} />
            </FormField>
          </div>

          <FormField label="Wheelchair Capacity" hint="Wheelchair-accessible spots this trip's vehicles/accommodation must provide.">
            <input type="number" min={0} {...register('requiredWheelchairCapacity')} />
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Required Beds" hint="Total beds needed across all accommodation for this trip.">
              <input type="number" min={0} {...register('requiredBeds')} />
            </FormField>
            <FormField label="Required Bedrooms" hint="Total bedrooms needed, e.g. for privacy or support needs.">
              <input type="number" min={0} {...register('requiredBedrooms')} />
            </FormField>
          </div>

          <FormField label="Min Staff Required" hint="Minimum staff that must be assigned before the trip can proceed.">
            <input type="number" min={0} {...register('minStaffRequired')} />
          </FormField>
        </Card>

        {/* Notes */}
        <Card title="Notes" className="space-y-4">
          <FormField label="Notes">
            <textarea {...register('notes')} rows={6} placeholder="Any additional notes..." />
          </FormField>
        </Card>

        {/* Submit */}
        <div className="md:col-span-2 flex justify-end gap-3">
          <Link to="/trips" className="px-6 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors">
            Cancel
          </Link>
          <button type="submit" disabled={createTrip.isPending}
            className="px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all shadow-md shadow-[var(--color-primary)]/20">
            {createTrip.isPending ? 'Creating...' : 'Create Trip'}
          </button>
        </div>
      </form>
    </div>
  )
}
