import { useNavigate, Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateTrip, useStaff, useEventTemplates } from '@/api/hooks'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { PageHeader } from '@/components/PageHeader'
import { TAP_FLOOR } from '@/components/tapArea'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { extractErrorMessage } from '@/pages/intake/intakeFormat'
import { formGrid, span } from '@/lib/formGrid'

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
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in max-w-[1600px]">
      {unsavedChangesDialog}
      <div className="text-sm text-[var(--color-muted-foreground)]">
        <Link to="/trips" className={`${TAP_FLOOR} hover:text-[var(--color-foreground)] transition-colors`}>&larr; Back to Trips</Link>
      </div>
      <PageHeader title="Create New Trip" />

      {createTrip.isError && (
        <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          {extractErrorMessage(createTrip.error, 'Failed to create trip. Please check your input and try again.')}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-[var(--section-gap)]">
        {/* Trip + Dates */}
        <Card title="Trip">
          <div className={formGrid}>
            <FormField label="Trip Name" required error={errors.tripName?.message} className={span.medium}>
              <input {...register('tripName')} placeholder="e.g. Beach Getaway 2026" autoFocus />
            </FormField>

            <FormField label="Trip Code" className={span.short}>
              <input {...register('tripCode')} placeholder="e.g. BG-2026-01" />
            </FormField>

            <FormField label="Region" className={span.short}>
              <input {...register('region')} placeholder="e.g. QLD" />
            </FormField>

            <FormField label="Event Template" className={span.medium}>
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

            <FormField label="Destination" className={span.medium}>
              <input {...register('destination')} placeholder="e.g. Gold Coast" />
            </FormField>

            <FormField label="Start Date" required error={errors.startDate?.message} className={span.date}>
              <input type="date" {...register('startDate')} />
            </FormField>

            <FormField label="Duration (Days)" required error={errors.durationDays?.message} className={span.short}>
              <input type="number" min={1} {...register('durationDays')} />
            </FormField>

            <FormField label="Booking Cutoff Date" className={span.date}>
              <input type="date" {...register('bookingCutoffDate')} />
            </FormField>

            <FormField label="Status" className={span.short}>
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

            <FormField label="Lead Coordinator" className={span.medium}>
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
          </div>
        </Card>

        {/* Capacity & Requirements */}
        <Card title="Capacity & Requirements">
          <div className={formGrid}>
            <FormField label="Min Participants" hint="Smallest group size this trip needs to go ahead." className={span.short}>
              <input type="number" min={0} {...register('minParticipants')} />
            </FormField>
            <FormField label="Max Participants" hint="Booking capacity before further bookings go to a waitlist." className={span.short}>
              <input type="number" min={0} {...register('maxParticipants')} />
            </FormField>
            <FormField label="Wheelchair Capacity" hint="Wheelchair-accessible spots this trip's vehicles/accommodation must provide." className={span.short}>
              <input type="number" min={0} {...register('requiredWheelchairCapacity')} />
            </FormField>
            <FormField label="Required Beds" hint="Total beds needed across all accommodation for this trip." className={span.short}>
              <input type="number" min={0} {...register('requiredBeds')} />
            </FormField>
            <FormField label="Required Bedrooms" hint="Total bedrooms needed, e.g. for privacy or support needs." className={span.short}>
              <input type="number" min={0} {...register('requiredBedrooms')} />
            </FormField>
            <FormField label="Min Staff Required" hint="The trip needs at least this many staff, even if its bookings need fewer." className={span.short}>
              <input type="number" min={0} {...register('minStaffRequired')} />
            </FormField>
          </div>
        </Card>

        {/* Notes — the field label is the section's only "Notes" heading (a Card title on top of it
            said the same word twice). */}
        <Card>
          <FormField label="Notes">
            <textarea {...register('notes')} rows={3} placeholder="Any additional notes..." />
          </FormField>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" to="/trips">Cancel</Button>
          <Button type="submit" disabled={createTrip.isPending}>
            {createTrip.isPending ? 'Creating...' : 'Create Trip'}
          </Button>
        </div>
      </form>
    </div>
  )
}
