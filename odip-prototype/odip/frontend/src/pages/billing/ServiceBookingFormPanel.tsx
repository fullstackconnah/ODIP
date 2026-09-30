import { useState } from 'react'
import { useForm, Controller, useFieldArray, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Plus, Trash2 } from 'lucide-react'
import { useCreateServiceBooking, useParticipants, useFundingSources } from '@/api/hooks'
import { FormField, labelClass } from '@/components/FormField'
import { Dropdown } from '@/components/Dropdown'
import { formatDateAu } from '@/lib/utils'

const lineSchema = z.object({
  supportItemNumber: z.string().min(1, 'Required'),
  allocatedAmount: z.coerce.number().positive('Must be greater than zero'),
})

const schema = z
  .object({
    participantId: z.string().min(1, 'Select a participant'),
    fundingSourceId: z.string().min(1, 'Select a funding source'),
    prodaBookingReference: z.string().min(1, 'Required'),
    startDate: z.string().min(1, 'Required'),
    endDate: z.string().min(1, 'Required'),
    claimWindowDays: z.coerce.number().int().positive('Must be at least 1 day'),
    lines: z.array(lineSchema).min(1, 'Add at least one line'),
  })
  .superRefine((data, ctx) => {
    if (data.endDate < data.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date must be on or after the start date.' })
    }
  })

type FormValues = z.infer<typeof schema>

export type ServiceBookingFormPanelProps = {
  isOpen: boolean
  onClose: () => void
  defaultParticipantId?: string
}

const EMPTY_LINE = { supportItemNumber: '', allocatedAmount: 0 }

export default function ServiceBookingFormPanel({ isOpen, onClose, defaultParticipantId }: ServiceBookingFormPanelProps) {
  // INTAKE-08: claims/billing surfaces exclude drafts.
  const { data: participants = [] } = useParticipants({ isDraft: 'false' })
  const createMutation = useCreateServiceBooking()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      participantId: defaultParticipantId ?? '',
      fundingSourceId: '',
      prodaBookingReference: '',
      startDate: '',
      endDate: '',
      claimWindowDays: 60,
      lines: [EMPTY_LINE],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const participantId = useWatch({ control, name: 'participantId' })
  const endDate = useWatch({ control, name: 'endDate' })
  const claimWindowDays = useWatch({ control, name: 'claimWindowDays' })

  // Service bookings only exist for agency-managed funding (PRODA), so scope the
  // funding source dropdown to that route and to the selected participant.
  const { data: fundingSources = [] } = useFundingSources(participantId ? { participantId } : undefined)
  const agencyFundingSources = fundingSources.filter(fs => fs.routeType === 'AgencyManaged' && fs.isActive)

  const claimDeadlinePreview = endDate && claimWindowDays
    ? formatDateAu(new Date(new Date(endDate).getTime() + Number(claimWindowDays) * 86400000).toISOString())
    : null

  async function onSubmit(values: FormValues) {
    setError(null)
    const payload = {
      fundingSourceId: values.fundingSourceId,
      prodaBookingReference: values.prodaBookingReference,
      startDate: values.startDate,
      endDate: values.endDate,
      claimWindowDays: Number(values.claimWindowDays),
      lines: values.lines.map(l => ({
        supportItemNumber: l.supportItemNumber,
        allocatedAmount: Number(l.allocatedAmount),
      })),
    }
    try {
      await createMutation.mutateAsync(payload)
      onClose()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string; errors?: string[] } } }
      setError(
        axiosErr?.response?.data?.errors?.[0] ||
          axiosErr?.response?.data?.message ||
          'Something went wrong creating this service booking. Please try again.',
      )
    }
  }

  const isBusy = isSubmitting || createMutation.isPending

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-[var(--color-card)] border-l border-[var(--color-border)] z-50 flex flex-col shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <h2 className="font-semibold text-[var(--color-foreground)]">New Service Booking</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
            aria-label="Close panel"
          >
            <X className="w-5 h-5 text-[var(--color-muted-foreground)]" />
          </button>
        </div>

        <form id="service-booking-form" onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <FormField label="Participant" required error={errors.participantId?.message}>
            <Controller
              control={control}
              name="participantId"
              render={({ field }) => (
                <Dropdown
                  variant="form"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  searchable
                  label="Select a participant"
                  items={participants.map(p => ({ value: p.id, label: p.fullName }))}
                />
              )}
            />
          </FormField>

          <FormField
            label="Funding Source"
            required
            error={errors.fundingSourceId?.message}
            hint={!participantId ? 'Select a participant first.' : agencyFundingSources.length === 0 ? 'This participant has no agency-managed funding source. Add one on the Funding Sources tab first.' : undefined}
          >
            <Controller
              control={control}
              name="fundingSourceId"
              render={({ field }) => (
                <Dropdown
                  variant="form"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  disabled={!participantId || agencyFundingSources.length === 0}
                  label="Select a funding source"
                  items={agencyFundingSources.map(fs => ({
                    value: fs.id,
                    label: fs.budgetCategory || fs.ndisPlanNumber || 'Agency Managed',
                  }))}
                />
              )}
            />
          </FormField>

          <FormField label="PRODA Booking Reference" required error={errors.prodaBookingReference?.message}>
            <input {...register('prodaBookingReference')} placeholder="e.g. SB-2026-00417" />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start Date" required error={errors.startDate?.message}>
              <input type="date" {...register('startDate')} />
            </FormField>
            <FormField label="End Date" required error={errors.endDate?.message}>
              <input type="date" {...register('endDate')} />
            </FormField>
          </div>

          <FormField
            label="Claim Window (days)"
            required
            error={errors.claimWindowDays?.message}
            hint={claimDeadlinePreview ? `Claims must be lodged by ${claimDeadlinePreview}.` : 'Days after the end date in which claims must be lodged.'}
          >
            <input type="number" min="1" {...register('claimWindowDays')} />
          </FormField>

          <fieldset className="m-0 p-0 border-0 space-y-3">
            <div className="flex items-center justify-between">
              <legend className={labelClass + ' mb-0'}>Booking Lines</legend>
              <button
                type="button"
                onClick={() => append(EMPTY_LINE)}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
              >
                <Plus className="w-3.5 h-3.5" /> Add line
              </button>
            </div>
            {errors.lines?.message && (
              <p className="text-xs text-[var(--color-destructive)]">{errors.lines.message}</p>
            )}
            <div className="space-y-2">
              {fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-2 bg-[var(--color-accent)] rounded-[var(--radius-md)] p-3">
                  <div className="flex-1 space-y-2">
                    <FormField label={`Support Item Number (line ${index + 1})`} error={errors.lines?.[index]?.supportItemNumber?.message} className="mb-0">
                      <input {...register(`lines.${index}.supportItemNumber` as const)} placeholder="e.g. 04_104_0125_6_1" />
                    </FormField>
                    <FormField label="Allocated Amount" error={errors.lines?.[index]?.allocatedAmount?.message} className="mb-0">
                      <input type="number" step="0.01" min="0" {...register(`lines.${index}.allocatedAmount` as const)} placeholder="e.g. 2500" />
                    </FormField>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    disabled={fields.length === 1}
                    aria-label={`Remove line ${index + 1}`}
                    title={fields.length === 1 ? 'At least one line is required' : 'Remove line'}
                    className="mt-6 p-1.5 rounded-lg text-[var(--color-muted-foreground)] hover:bg-[var(--color-destructive)]/10 hover:text-[var(--color-destructive)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </fieldset>

          {error && (
            <div role="alert" className="bg-[var(--color-error-container)] rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--color-destructive)]">
              {error}
            </div>
          )}
        </form>

        <div className="px-6 py-4 border-t border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="service-booking-form"
              disabled={isBusy}
              className="px-5 py-2 bg-[var(--color-primary)] text-white rounded-full text-sm font-semibold hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:opacity-50 transition-all"
            >
              {isBusy ? 'Creating…' : 'Create Service Booking'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
