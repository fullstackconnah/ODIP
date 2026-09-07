import { useMemo, useState } from 'react'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Lock, X } from 'lucide-react'
import {
  useCreateBillableEvent,
  useUpdateBillableEvent,
  useParticipants,
  useFundingSources,
  useServiceBookings,
} from '@/api/hooks'
import type { BillableEventDto, IncomeStream } from '@/api/types'
import type { ClaimDayType, ClaimType, GSTCode } from '@/api/types/enums'
import { CLAIM_DAY_TYPES, CLAIM_TYPES, GST_CODES } from '@/api/types/enums'
import { FormField } from '@/components/FormField'
import { Dropdown } from '@/components/Dropdown'
import { formatCurrency } from '@/lib/utils'
import {
  INCOME_STREAMS,
  INCOME_STREAM_LABELS,
  CLAIM_DAY_TYPE_LABELS,
  CLAIM_TYPE_LABELS,
  GST_CODE_LABELS,
  isBillableEventLocked,
} from './constants'

const schema = z
  .object({
    participantId: z.string().min(1, 'Select a participant'),
    fundingSourceId: z.string().min(1, 'Select a funding source'),
    serviceBookingId: z.string().optional(),
    stream: z.string().min(1, 'Select an income stream'),
    supportItemNumber: z.string().min(1, 'Required'),
    supportsDeliveredFrom: z.string().min(1, 'Required'),
    supportsDeliveredTo: z.string().min(1, 'Required'),
    dayType: z.string().min(1, 'Select a day type'),
    quantityMode: z.enum(['quantity', 'hours']),
    quantity: z.union([z.coerce.number().positive('Enter a quantity greater than zero'), z.literal('')]).optional(),
    hours: z.union([z.coerce.number().positive('Enter hours greater than zero'), z.literal('')]).optional(),
    unitPrice: z.coerce.number().nonnegative('Enter a unit price'),
    gstCode: z.string().min(1, 'Select a GST code'),
    claimType: z.string().min(1, 'Select a claim type'),
    cancellationReasonCode: z.string().optional(),
    participantApproved: z.boolean().optional(),
    claimReference: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.supportsDeliveredTo < data.supportsDeliveredFrom) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['supportsDeliveredTo'], message: 'End date must be on or after the start date.' })
    }
    if (data.quantityMode === 'quantity' && (data.quantity === '' || data.quantity == null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: 'Enter a quantity.' })
    }
    if (data.quantityMode === 'hours' && (data.hours === '' || data.hours == null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hours'], message: 'Enter hours.' })
    }
    if (data.claimType === 'Cancellation' && !data.cancellationReasonCode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cancellationReasonCode'], message: 'A cancellation reason is required for a cancellation claim.' })
    }
  })

type FormValues = z.infer<typeof schema>

export type BillableEventFormPanelProps = {
  isOpen: boolean
  onClose: () => void
  /** Present -> edit mode. Absent -> create mode. */
  event?: BillableEventDto
  defaultParticipantId?: string
}

const emptyDefaults = (participantId?: string): FormValues => ({
  participantId: participantId ?? '',
  fundingSourceId: '',
  serviceBookingId: '',
  stream: '',
  supportItemNumber: '',
  supportsDeliveredFrom: '',
  supportsDeliveredTo: '',
  dayType: '',
  quantityMode: 'hours',
  quantity: '',
  hours: '',
  unitPrice: 0,
  gstCode: 'P2',
  claimType: 'Standard',
  cancellationReasonCode: '',
  participantApproved: false,
  claimReference: '',
})

const eventDefaults = (event: BillableEventDto): FormValues => {
  const hasQuantity = event.quantity != null
  return {
    participantId: event.participantId,
    fundingSourceId: event.fundingSourceId,
    serviceBookingId: event.serviceBookingId ?? '',
    stream: event.stream,
    supportItemNumber: event.supportItemNumber,
    supportsDeliveredFrom: event.supportsDeliveredFrom.slice(0, 10),
    supportsDeliveredTo: event.supportsDeliveredTo.slice(0, 10),
    dayType: event.dayType,
    quantityMode: hasQuantity ? 'quantity' : 'hours',
    quantity: event.quantity ?? '',
    hours: event.hours ?? '',
    unitPrice: event.unitPrice,
    gstCode: event.gstCode,
    claimType: event.claimType,
    cancellationReasonCode: event.cancellationReasonCode ?? '',
    participantApproved: event.participantApproved,
    claimReference: event.claimReference ?? '',
  }
}

export default function BillableEventFormPanel({ isOpen, onClose, event, defaultParticipantId }: BillableEventFormPanelProps) {
  const isEdit = !!event
  const locked = !!event && isBillableEventLocked(event.status)
  // INTAKE-08: claims/billing surfaces exclude drafts.
  const { data: participants = [] } = useParticipants({ isDraft: 'false' })
  const createMutation = useCreateBillableEvent()
  const updateMutation = useUpdateBillableEvent()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: event ? eventDefaults(event) : emptyDefaults(defaultParticipantId),
  })

  const participantId = useWatch({ control, name: 'participantId' })
  const claimType = useWatch({ control, name: 'claimType' })
  const quantityMode = useWatch({ control, name: 'quantityMode' })
  const quantity = useWatch({ control, name: 'quantity' })
  const hours = useWatch({ control, name: 'hours' })
  const unitPrice = useWatch({ control, name: 'unitPrice' })

  const { data: fundingSources = [] } = useFundingSources(participantId ? { participantId } : undefined)
  const { data: serviceBookings = [] } = useServiceBookings(participantId ? { participantId } : undefined)

  const estimatedTotal = useMemo(() => {
    const qty = quantityMode === 'quantity' ? Number(quantity || 0) : Number(hours || 0)
    const price = Number(unitPrice || 0)
    if (!qty || !price) return null
    return qty * price
  }, [quantityMode, quantity, hours, unitPrice])

  async function onSubmit(values: FormValues) {
    if (locked) return
    setError(null)
    const totalAmount = (values.quantityMode === 'quantity' ? Number(values.quantity) : Number(values.hours)) * Number(values.unitPrice)
    const payload = {
      participantId: values.participantId,
      fundingSourceId: values.fundingSourceId,
      serviceBookingId: values.serviceBookingId || undefined,
      stream: values.stream as IncomeStream,
      supportItemNumber: values.supportItemNumber,
      supportsDeliveredFrom: values.supportsDeliveredFrom,
      supportsDeliveredTo: values.supportsDeliveredTo,
      dayType: values.dayType as ClaimDayType,
      quantity: values.quantityMode === 'quantity' ? Number(values.quantity) : undefined,
      hours: values.quantityMode === 'hours' ? Number(values.hours) : undefined,
      unitPrice: Number(values.unitPrice),
      totalAmount,
      gstCode: values.gstCode as GSTCode,
      claimType: values.claimType as ClaimType,
      cancellationReasonCode: values.claimType === 'Cancellation' ? values.cancellationReasonCode : undefined,
      participantApproved: !!values.participantApproved,
      claimReference: values.claimReference || '',
    }
    try {
      if (isEdit && event) {
        await updateMutation.mutateAsync({ id: event.id, data: payload })
      } else {
        await createMutation.mutateAsync(payload)
      }
      onClose()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string; errors?: string[] } } }
      if (axiosErr?.response?.status === 400 && isEdit) {
        setError('This event has already been claimed and can no longer be edited. Refresh the list to see its current status.')
        return
      }
      setError(
        axiosErr?.response?.data?.errors?.[0] ||
          axiosErr?.response?.data?.message ||
          'Something went wrong saving this billable event. Please try again.',
      )
    }
  }

  const isBusy = isSubmitting || createMutation.isPending || updateMutation.isPending

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-[var(--color-card)] border-l border-[var(--color-border)] z-50 flex flex-col shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <h2 className="font-semibold text-[var(--color-foreground)]">
            {isEdit ? 'Edit Billable Event' : 'New Billable Event'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
            aria-label="Close panel"
          >
            <X className="w-5 h-5 text-[var(--color-muted-foreground)]" />
          </button>
        </div>

        {locked && (
          <div className="mx-6 mt-4 flex items-start gap-2 rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
            <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              This event has status <strong className="text-[var(--color-foreground)]">{event?.status}</strong> and has already
              been claimed, so it can no longer be edited. You can still review its details below.
            </span>
          </div>
        )}

        <fieldset disabled={locked} className="contents">
          <form id="billable-event-form" onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Who/What</h3>
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
                    disabled={locked}
                    searchable
                    label="Select a participant"
                    items={participants.map(p => ({ value: p.id, label: p.fullName }))}
                  />
                )}
              />
            </FormField>

            <FormField label="Funding Source" required error={errors.fundingSourceId?.message} hint={!participantId ? 'Select a participant first.' : undefined}>
              <Controller
                control={control}
                name="fundingSourceId"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={locked || !participantId}
                    label="Select a funding source"
                    items={fundingSources.map(fs => ({ value: fs.id, label: fs.budgetCategory || fs.ndisPlanNumber || fs.routeType }))}
                  />
                )}
              />
            </FormField>

            <FormField label="Service Booking" hint="Optional — link to a PRODA service booking to track its remaining balance.">
              <Controller
                control={control}
                name="serviceBookingId"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={locked || !participantId}
                    label="None"
                    items={[{ value: '', label: 'None' }, ...serviceBookings.map(sb => ({ value: sb.id, label: sb.prodaBookingReference }))]}
                  />
                )}
              />
            </FormField>

            <FormField label="Income Stream" required error={errors.stream?.message}>
              <Controller
                control={control}
                name="stream"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={locked}
                    label="Select an income stream"
                    items={INCOME_STREAMS.map(s => ({ value: s, label: INCOME_STREAM_LABELS[s] }))}
                  />
                )}
              />
            </FormField>

            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] pt-2">Delivery</h3>
            <FormField label="Support Item Number" required error={errors.supportItemNumber?.message}>
              <input {...register('supportItemNumber')} placeholder="e.g. 04_104_0125_6_1" />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Delivered From" required error={errors.supportsDeliveredFrom?.message}>
                <input type="date" {...register('supportsDeliveredFrom')} />
              </FormField>
              <FormField label="Delivered To" required error={errors.supportsDeliveredTo?.message}>
                <input type="date" {...register('supportsDeliveredTo')} />
              </FormField>
            </div>

            <FormField label="Day Type" required error={errors.dayType?.message}>
              <Controller
                control={control}
                name="dayType"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={locked}
                    label="Select a day type"
                    items={CLAIM_DAY_TYPES.map(dt => ({ value: dt, label: CLAIM_DAY_TYPE_LABELS[dt] ?? dt }))}
                  />
                )}
              />
            </FormField>

            <fieldset className="m-0 p-0 border-0 space-y-2">
              <legend className="block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]">Measured As</legend>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" value="hours" {...register('quantityMode')} className="accent-[var(--color-primary)]" />
                  Hours
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" value="quantity" {...register('quantityMode')} className="accent-[var(--color-primary)]" />
                  Quantity
                </label>
              </div>
              <p className="text-xs text-[var(--color-muted-foreground)]">Exactly one of hours or quantity is sent to PRODA per the NDIS bulk-file rule.</p>
            </fieldset>

            {quantityMode === 'quantity' ? (
              <FormField label="Quantity" required error={typeof errors.quantity?.message === 'string' ? errors.quantity.message : undefined}>
                <input type="number" step="0.01" min="0" {...register('quantity')} placeholder="e.g. 3" />
              </FormField>
            ) : (
              <FormField label="Hours" required error={typeof errors.hours?.message === 'string' ? errors.hours.message : undefined} hint="Decimal hours, e.g. 2.5">
                <input type="number" step="0.01" min="0" {...register('hours')} placeholder="e.g. 2.5" />
              </FormField>
            )}

            <FormField label="Unit Price" required error={errors.unitPrice?.message}>
              <input type="number" step="0.01" min="0" {...register('unitPrice')} placeholder="e.g. 68.50" />
            </FormField>

            {estimatedTotal != null && (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Estimated total: <span className="font-semibold text-[var(--color-foreground)]">{formatCurrency(estimatedTotal)}</span>
              </p>
            )}

            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] pt-2">Claim metadata</h3>
            <FormField label="GST Code" required error={errors.gstCode?.message}>
              <Controller
                control={control}
                name="gstCode"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={locked}
                    items={GST_CODES.map(g => ({ value: g, label: GST_CODE_LABELS[g] ?? g }))}
                  />
                )}
              />
            </FormField>

            <FormField label="Claim Type" required error={errors.claimType?.message}>
              <Controller
                control={control}
                name="claimType"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={locked}
                    items={CLAIM_TYPES.map(ct => ({ value: ct, label: CLAIM_TYPE_LABELS[ct] ?? ct }))}
                  />
                )}
              />
            </FormField>

            {claimType === 'Cancellation' && (
              <FormField label="Cancellation Reason Code" required error={errors.cancellationReasonCode?.message}>
                <input {...register('cancellationReasonCode')} placeholder="e.g. PCU" />
              </FormField>
            )}

            <FormField label="Participant Approved" layout="checkbox">
              <input type="checkbox" {...register('participantApproved')} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>

            <FormField label="Claim Reference" hint="Unique claim/invoice reference — leave blank until the event is routed.">
              <input {...register('claimReference')} placeholder="e.g. WOW-2026-00417" />
            </FormField>

            {error && (
              <div role="alert" className="bg-[var(--color-error-container)] rounded-xl px-4 py-3 text-sm text-[var(--color-destructive)]">
                {error}
              </div>
            )}
          </form>
        </fieldset>

        <div className="px-6 py-4 border-t border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-lg transition-colors"
            >
              {locked ? 'Close' : 'Cancel'}
            </button>
            {!locked && (
              <button
                type="submit"
                form="billable-event-form"
                disabled={isBusy}
                className="px-5 py-2 bg-[var(--color-primary)] text-white rounded-full text-sm font-semibold hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:opacity-50 transition-all"
              >
                {isBusy ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Billable Event'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
