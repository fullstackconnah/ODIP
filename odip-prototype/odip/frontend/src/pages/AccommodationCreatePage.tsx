import { useNavigate, useParams } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateAccommodation, useUpdateAccommodation, useAccommodationDetail } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { PageHeader } from '@/components/PageHeader'
import { BackButton, BackActionButton } from '@/components/BackButton'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { extractErrorMessage } from '@/pages/intake/intakeFormat'
import { formGrid, span } from '@/lib/formGrid'
import { useFillOnce } from '@/hooks/useFillOnce'
import { Callout } from '@/components/Callout'
import { PageState } from '@/components/PageState'
import { isNotFoundError } from '@/lib/httpStatus'
import { retryingAfterError } from '@/lib/queryPhase'

const accommodationSchema = z.object({
  propertyName: z.string().min(1, 'Property name is required'),
  providerOwner: z.string().optional(),
  location: z.string().optional(),
  region: z.string().optional(),
  address: z.string().optional(),
  suburb: z.string().optional(),
  state: z.string().optional(),
  postcode: z.string().optional(),
  contactPerson: z.string().optional(),
  email: z.union([z.string().email('Enter a valid email'), z.literal('')]).optional(),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  website: z.string().optional(),
  isFullyModified: z.boolean().optional(),
  isSemiModified: z.boolean().optional(),
  isWheelchairAccessible: z.boolean().optional(),
  accessibilityNotes: z.string().optional(),
  bedroomCount: z.coerce.number().optional(),
  bedCount: z.coerce.number().optional(),
  maxCapacity: z.coerce.number().optional(),
  beddingConfiguration: z.string().optional(),
  hoistBathroomNotes: z.string().optional(),
  generalNotes: z.string().optional(),
})

type AccommodationFormData = z.infer<typeof accommodationSchema>

export default function AccommodationCreatePage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = !!id
  const createAccommodation = useCreateAccommodation()
  const updateAccommodation = useUpdateAccommodation()
  const pageQuery = useAccommodationDetail(isEdit ? id : undefined)
  const { data: existing, isError: isExistingError, error: existingError, refetch: refetchExisting } = pageQuery
  const mutation = isEdit ? updateAccommodation : createAccommodation

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm({
    resolver: zodResolver(accommodationSchema),
    defaultValues: {
      isFullyModified: false,
      isSemiModified: false,
      isWheelchairAccessible: false,
    },
  })

  useFillOnce(existing, record => {
    reset({
      propertyName: record.propertyName ?? '',
      providerOwner: record.providerOwner ?? '',
      location: record.location ?? '',
      region: record.region ?? '',
      address: record.address ?? '',
      suburb: record.suburb ?? '',
      state: record.state ?? '',
      postcode: record.postcode ?? '',
      contactPerson: record.contactPerson ?? '',
      email: record.email ?? '',
      phone: record.phone ?? '',
      mobile: record.mobile ?? '',
      website: record.website ?? '',
      isFullyModified: record.isFullyModified ?? false,
      isSemiModified: record.isSemiModified ?? false,
      isWheelchairAccessible: record.isWheelchairAccessible ?? false,
      accessibilityNotes: record.accessibilityNotes ?? '',
      bedroomCount: record.bedroomCount ?? undefined,
      bedCount: record.bedCount ?? undefined,
      maxCapacity: record.maxCapacity ?? undefined,
      beddingConfiguration: record.beddingConfiguration ?? '',
      hoistBathroomNotes: record.hoistBathroomNotes ?? '',
      generalNotes: record.generalNotes ?? '',
    })
  }, !isDirty)

  const onSubmit = async (data: AccommodationFormData) => {
    const payload: any = { ...data }
    // A website typed without a scheme (e.g. "example.com") would otherwise fail the detail
    // page's URL check and silently disappear — prepend https:// so it renders as a link.
    if (payload.website && !/^[a-z]+:\/\//i.test(payload.website)) {
      payload.website = `https://${payload.website}`
    }
    // Treat 0 as null for optional numeric fields (coerced from empty input)
    for (const numField of ['bedroomCount', 'bedCount', 'maxCapacity']) {
      if (payload[numField] === 0 || payload[numField] === undefined) payload[numField] = null
    }
    for (const key of Object.keys(payload)) {
      if (payload[key] === '' || payload[key] === undefined) payload[key] = null
    }
    try {
      if (isEdit) {
        const res = await updateAccommodation.mutateAsync({ id, data: payload })
        if (res.success) {
          flushSync(() => reset(data))
          navigate(`/accommodation/${id}`, { replace: true })
        }
      } else {
        const res = await createAccommodation.mutateAsync(payload)
        if (res.success && res.data?.id) {
          flushSync(() => reset(data))
          navigate(`/accommodation/${res.data.id}`, { replace: true })
        }
      }
    } catch {
      // error handled by mutation state
    }
  }

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  // A record that has not loaded is never a blank form: saving it would overwrite the real one.
  if (isEdit && !existing) {
    if (!isExistingError && !retryingAfterError(pageQuery)) return <PageState kind="loading" noun="accommodation" />
    return isNotFoundError(existingError)
      ? <PageState kind="not-found" noun="accommodation" backTo="/accommodation" backLabel="accommodation" />
      : <PageState kind="error" noun="accommodation" onRetry={() => refetchExisting()} />
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in max-w-[1600px]">
      {unsavedChangesDialog}
      <div className="flex items-start gap-2">
        <BackButton to={isEdit ? `/accommodation/${id}` : '/accommodation'} label="accommodation" variant="icon" />
        <div className="flex-1 min-w-0"><PageHeader title={isEdit ? 'Edit accommodation' : 'New accommodation'} /></div>
      </div>

      {mutation.isError && (
        <Callout tone="error">
          {extractErrorMessage(mutation.error, `Couldn't ${isEdit ? 'update' : 'create'} this accommodation. Check the details and try again.`)}
        </Callout>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-[var(--section-gap)]">
        {/* Property Information */}
        <Card title="Property information">
          <div className={formGrid}>
            <FormField label="Property Name" required error={errors.propertyName?.message} className={span.medium}>
              <input {...register('propertyName')} placeholder="e.g. Sunrise Beach House" autoFocus />
            </FormField>

            <FormField label="Provider / Owner" className={span.medium}>
              <input {...register('providerOwner')} placeholder="e.g. Coastal Properties" />
            </FormField>

            <FormField label="Location" className={span.medium}>
              <input {...register('location')} placeholder="e.g. Gold Coast" />
            </FormField>

            <FormField label="Region" className={span.short}>
              <input {...register('region')} placeholder="e.g. South East QLD" />
            </FormField>
          </div>
        </Card>

        {/* Address & Contact */}
        <Card title="Address & contact">
          <div className={formGrid}>
            <FormField label="Address" className={span.long}>
              <input {...register('address')} placeholder="e.g. 123 Ocean Drive" />
            </FormField>

            <FormField label="Suburb" className={span.short}>
              <input {...register('suburb')} placeholder="e.g. Surfers Paradise" />
            </FormField>
            <FormField label="State" className={span.short}>
              <input {...register('state')} placeholder="e.g. QLD" />
            </FormField>
            <FormField label="Postcode" className={span.short}>
              <input {...register('postcode')} placeholder="e.g. 4217" />
            </FormField>

            <FormField label="Contact Person" className={span.medium}>
              <input {...register('contactPerson')} placeholder="e.g. Jane Smith" />
            </FormField>

            <FormField label="Email" error={errors.email?.message} className={span.medium}>
              <input type="email" {...register('email')} placeholder="e.g. jane@example.com" />
            </FormField>
            <FormField label="Phone" className={span.medium}>
              <input {...register('phone')} placeholder="e.g. 07 1234 5678" />
            </FormField>

            <FormField label="Mobile" className={span.medium}>
              <input {...register('mobile')} placeholder="e.g. 0412 345 678" />
            </FormField>
            <FormField label="Website" className={span.medium}>
              <input {...register('website')} placeholder="e.g. https://..." />
            </FormField>
          </div>
        </Card>

        {/* Capacity & Accessibility */}
        <Card title="Capacity & accessibility">
          <div className={formGrid}>
            <FormField label="Bedrooms" className={span.short}>
              <input type="number" min="0" {...register('bedroomCount')} placeholder="0" />
            </FormField>
            <FormField label="Beds" className={span.short}>
              <input type="number" min="0" {...register('bedCount')} placeholder="0" />
            </FormField>
            <FormField label="Max Capacity" className={span.short}>
              <input type="number" min="0" {...register('maxCapacity')} placeholder="0" />
            </FormField>

            <FormField label="Bedding Configuration" className={span.medium}>
              <input {...register('beddingConfiguration')} placeholder="e.g. 2 queen, 4 single" />
            </FormField>

            <FormField label="Wheelchair Accessible" layout="checkbox" className={span.short}>
              <input type="checkbox" {...register('isWheelchairAccessible')} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>

            <FormField label="Fully Modified" layout="checkbox" className={span.short}>
              <input type="checkbox" {...register('isFullyModified')} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>

            <FormField label="Semi Modified" layout="checkbox" className={span.short}>
              <input type="checkbox" {...register('isSemiModified')} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>
          </div>
        </Card>

        {/* Notes */}
        <Card title="Notes">
          <div className={formGrid}>
            <FormField label="Accessibility Notes" className={span.long}>
              <textarea {...register('accessibilityNotes')} rows={2} placeholder="Accessibility details..." />
            </FormField>

            <FormField label="Hoist / Bathroom Notes" className={span.long}>
              <textarea {...register('hoistBathroomNotes')} rows={2} placeholder="Hoist or bathroom details..." />
            </FormField>

            <FormField label="General Notes" className={span.long}>
              <textarea {...register('generalNotes')} rows={3} placeholder="Any additional notes..." />
            </FormField>
          </div>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <BackActionButton to={isEdit ? `/accommodation/${id}` : '/accommodation'} />
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save' : 'Create accommodation')}
          </Button>
        </div>
      </form>
    </div>
  )
}
