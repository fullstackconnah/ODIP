import { useNavigate, useParams, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateAccommodation, useUpdateAccommodation, useAccommodationDetail } from '@/api/hooks'
import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'

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
  email: z.string().optional(),
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
  const { data: existing, isLoading: isLoadingExisting } = useAccommodationDetail(isEdit ? id : undefined)
  const mutation = isEdit ? updateAccommodation : createAccommodation

  const { register, handleSubmit, reset, formState: { errors } } = useForm<AccommodationFormData>({
    resolver: zodResolver(accommodationSchema),
    defaultValues: {
      isFullyModified: false,
      isSemiModified: false,
      isWheelchairAccessible: false,
    },
  })

  useEffect(() => {
    if (existing) {
      reset({
        propertyName: existing.propertyName ?? '',
        providerOwner: existing.providerOwner ?? '',
        location: existing.location ?? '',
        region: existing.region ?? '',
        address: existing.address ?? '',
        suburb: existing.suburb ?? '',
        state: existing.state ?? '',
        postcode: existing.postcode ?? '',
        contactPerson: existing.contactPerson ?? '',
        email: existing.email ?? '',
        phone: existing.phone ?? '',
        mobile: existing.mobile ?? '',
        website: existing.website ?? '',
        isFullyModified: existing.isFullyModified ?? false,
        isSemiModified: existing.isSemiModified ?? false,
        isWheelchairAccessible: existing.isWheelchairAccessible ?? false,
        accessibilityNotes: existing.accessibilityNotes ?? '',
        bedroomCount: existing.bedroomCount ?? undefined,
        bedCount: existing.bedCount ?? undefined,
        maxCapacity: existing.maxCapacity ?? undefined,
        beddingConfiguration: existing.beddingConfiguration ?? '',
        hoistBathroomNotes: existing.hoistBathroomNotes ?? '',
        generalNotes: existing.generalNotes ?? '',
      })
    }
  }, [existing, reset])

  const onSubmit = async (data: AccommodationFormData) => {
    const payload: any = { ...data }
    // Treat 0 as null for optional numeric fields (coerced from empty input)
    for (const numField of ['bedroomCount', 'bedCount', 'maxCapacity']) {
      if (payload[numField] === 0 || payload[numField] === undefined) payload[numField] = null
    }
    for (const key of Object.keys(payload)) {
      if (payload[key] === '' || payload[key] === undefined) payload[key] = null
    }
    try {
      if (isEdit) {
        const res = await updateAccommodation.mutateAsync({ id, data: { ...payload, isActive: existing?.isActive ?? true } })
        if (res.success) navigate(`/accommodation/${id}`)
      } else {
        const res = await createAccommodation.mutateAsync(payload)
        if (res.success && res.data?.id) navigate(`/accommodation/${res.data.id}`)
      }
    } catch {
      // error handled by mutation state
    }
  }

  if (isEdit && isLoadingExisting) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading...</div>

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Link to={isEdit ? `/accommodation/${id}` : '/accommodation'} className="p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl md:text-2xl font-bold">{isEdit ? 'Edit Accommodation' : 'New Accommodation'}</h1>
      </div>

      {mutation.isError && (
        <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          Failed to {isEdit ? 'update' : 'create'} accommodation. Please check your input and try again.
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="grid md:grid-cols-2 gap-6">
        {/* Property Information */}
        <Card title="Property Information" className="space-y-4">
          <FormField label="Property Name" required error={errors.propertyName?.message}>
            <input {...register('propertyName')} placeholder="e.g. Sunrise Beach House" autoFocus />
          </FormField>

          <FormField label="Provider / Owner">
            <input {...register('providerOwner')} placeholder="e.g. Coastal Properties" />
          </FormField>

          <FormField label="Location">
            <input {...register('location')} placeholder="e.g. Gold Coast" />
          </FormField>

          <FormField label="Region">
            <input {...register('region')} placeholder="e.g. South East QLD" />
          </FormField>
        </Card>

        {/* Address & Contact */}
        <Card title="Address & Contact" className="space-y-4">
          <FormField label="Address">
            <input {...register('address')} placeholder="e.g. 123 Ocean Drive" />
          </FormField>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <FormField label="Suburb">
              <input {...register('suburb')} placeholder="e.g. Surfers Paradise" />
            </FormField>
            <FormField label="State">
              <input {...register('state')} placeholder="e.g. QLD" />
            </FormField>
            <FormField label="Postcode">
              <input {...register('postcode')} placeholder="e.g. 4217" />
            </FormField>
          </div>

          <FormField label="Contact Person">
            <input {...register('contactPerson')} placeholder="e.g. Jane Smith" />
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Email">
              <input type="email" {...register('email')} placeholder="e.g. jane@example.com" />
            </FormField>
            <FormField label="Phone">
              <input {...register('phone')} placeholder="e.g. 07 1234 5678" />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Mobile">
              <input {...register('mobile')} placeholder="e.g. 0412 345 678" />
            </FormField>
            <FormField label="Website">
              <input {...register('website')} placeholder="e.g. https://..." />
            </FormField>
          </div>
        </Card>

        {/* Capacity & Accessibility */}
        <Card title="Capacity & Accessibility" className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <FormField label="Bedrooms">
              <input type="number" min="0" {...register('bedroomCount')} placeholder="0" />
            </FormField>
            <FormField label="Beds">
              <input type="number" min="0" {...register('bedCount')} placeholder="0" />
            </FormField>
            <FormField label="Max Capacity">
              <input type="number" min="0" {...register('maxCapacity')} placeholder="0" />
            </FormField>
          </div>

          <FormField label="Bedding Configuration">
            <input {...register('beddingConfiguration')} placeholder="e.g. 2 queen, 4 single" />
          </FormField>

          <FormField label="Wheelchair Accessible" layout="checkbox">
            <input type="checkbox" {...register('isWheelchairAccessible')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          <FormField label="Fully Modified" layout="checkbox">
            <input type="checkbox" {...register('isFullyModified')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          <FormField label="Semi Modified" layout="checkbox">
            <input type="checkbox" {...register('isSemiModified')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
        </Card>

        {/* Notes */}
        <Card title="Notes" className="space-y-4">
          <FormField label="Accessibility Notes">
            <textarea {...register('accessibilityNotes')} rows={2} placeholder="Accessibility details..." />
          </FormField>

          <FormField label="Hoist / Bathroom Notes">
            <textarea {...register('hoistBathroomNotes')} rows={2} placeholder="Hoist or bathroom details..." />
          </FormField>

          <FormField label="General Notes">
            <textarea {...register('generalNotes')} rows={3} placeholder="Any additional notes..." />
          </FormField>
        </Card>

        {/* Submit */}
        <div className="md:col-span-2 flex justify-end gap-3">
          <Link to={isEdit ? `/accommodation/${id}` : '/accommodation'} className="px-6 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors">
            Cancel
          </Link>
          <button type="submit" disabled={mutation.isPending}
            className="px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all shadow-md shadow-blue-500/20">
            {mutation.isPending ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Accommodation')}
          </button>
        </div>
      </form>
    </div>
  )
}
