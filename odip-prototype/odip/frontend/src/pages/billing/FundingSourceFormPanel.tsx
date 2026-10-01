import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCreateFundingSource, useUpdateFundingSource, useParticipants } from '@/api/hooks'
import type { FundingSourceDto, FundingRouteType } from '@/api/types'
import { FormField } from '@/components/FormField'
import { Dropdown } from '@/components/Dropdown'
import { SlideOver } from '@/components/SlideOver'
import {
  FUNDING_ROUTE_TYPES,
  FUNDING_ROUTE_TYPE_LABELS,
  FUNDING_ROUTE_TYPE_HINTS,
} from './constants'

const schema = z
  .object({
    participantId: z.string().min(1, 'Select a participant'),
    routeType: z.string().min(1, 'Select a route type'),
    budgetCategory: z.string().optional(),
    ndisPlanNumber: z.string().optional(),
    planStartDate: z.string().optional(),
    planEndDate: z.string().optional(),
    budget: z.union([z.coerce.number().nonnegative('Budget cannot be negative'), z.literal('')]).optional(),
    payerName: z.string().optional(),
    payerEmail: z.union([z.string().email('Enter a valid email address'), z.literal('')]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.planStartDate && data.planEndDate && data.planEndDate < data.planStartDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['planEndDate'],
        message: 'Plan end date must be on or after the start date.',
      })
    }
  })

type FormValues = z.infer<typeof schema>

const emptyDefaults = (participantId?: string): FormValues => ({
  participantId: participantId ?? '',
  routeType: '',
  budgetCategory: '',
  ndisPlanNumber: '',
  planStartDate: '',
  planEndDate: '',
  budget: '',
  payerName: '',
  payerEmail: '',
})

const fundingSourceDefaults = (fundingSource: FundingSourceDto): FormValues => ({
  participantId: fundingSource.participantId,
  routeType: fundingSource.routeType,
  budgetCategory: fundingSource.budgetCategory ?? '',
  ndisPlanNumber: fundingSource.ndisPlanNumber ?? '',
  planStartDate: fundingSource.planStartDate ? fundingSource.planStartDate.slice(0, 10) : '',
  planEndDate: fundingSource.planEndDate ? fundingSource.planEndDate.slice(0, 10) : '',
  budget: fundingSource.budget ?? '',
  payerName: fundingSource.payerName ?? '',
  payerEmail: fundingSource.payerEmail ?? '',
})

export type FundingSourceFormPanelProps = {
  isOpen: boolean
  onClose: () => void
  /** Present -> edit mode. Absent -> create mode. */
  fundingSource?: FundingSourceDto
  /** Pre-selects the participant when opened from a participant-scoped context. */
  defaultParticipantId?: string
}

export default function FundingSourceFormPanel({
  isOpen,
  onClose,
  fundingSource,
  defaultParticipantId,
}: FundingSourceFormPanelProps) {
  const isEdit = !!fundingSource
  // INTAKE-08: claims/billing surfaces exclude drafts.
  const { data: participants = [] } = useParticipants({ isDraft: 'false' })
  const createMutation = useCreateFundingSource()
  const updateMutation = useUpdateFundingSource()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: fundingSource ? fundingSourceDefaults(fundingSource) : emptyDefaults(defaultParticipantId),
  })

  async function onSubmit(values: FormValues) {
    setError(null)
    const payload = {
      participantId: values.participantId,
      routeType: values.routeType as FundingRouteType,
      budgetCategory: values.budgetCategory || undefined,
      ndisPlanNumber: values.ndisPlanNumber || undefined,
      planStartDate: values.planStartDate || undefined,
      planEndDate: values.planEndDate || undefined,
      budget: values.budget === '' || values.budget == null ? undefined : Number(values.budget),
      payerName: values.payerName || undefined,
      payerEmail: values.payerEmail || undefined,
    }
    try {
      if (isEdit && fundingSource) {
        await updateMutation.mutateAsync({
          id: fundingSource.id,
          data: { ...payload, isActive: fundingSource.isActive },
        })
      } else {
        await createMutation.mutateAsync(payload)
      }
      onClose()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string; errors?: string[] } } }
      setError(
        axiosErr?.response?.data?.errors?.[0] ||
          axiosErr?.response?.data?.message ||
          'Something went wrong saving this funding source. Please try again.',
      )
    }
  }

  const isBusy = isSubmitting || createMutation.isPending || updateMutation.isPending

  if (!isOpen) return null

  return (
    <SlideOver
      open
      onClose={onClose}
      title={isEdit ? 'Edit Funding Source' : 'New Funding Source'}
      dirty={isDirty}
      bodyClassName="px-6 py-5"
      footerClassName="px-6 py-4"
      footer={
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
            form="funding-source-form"
            disabled={isBusy}
            className="px-5 py-2 bg-[var(--color-primary)] text-white rounded-full text-sm font-semibold hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:opacity-50 transition-all"
          >
            {isBusy ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Funding Source'}
          </button>
        </div>
      }
    >
      <form id="funding-source-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
                disabled={isEdit}
                searchable
                label="Select a participant"
                items={participants.map(p => ({ value: p.id, label: p.fullName }))}
              />
            )}
          />
        </FormField>

        <FormField label="Route Type" required error={errors.routeType?.message} hint="Controls how billable events under this funding source are routed for claiming.">
          <Controller
            control={control}
            name="routeType"
            render={({ field }) => (
              <Dropdown
                variant="form"
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                label="Select a route type"
                items={FUNDING_ROUTE_TYPES.map(rt => ({
                  value: rt,
                  label: FUNDING_ROUTE_TYPE_LABELS[rt],
                  description: FUNDING_ROUTE_TYPE_HINTS[rt],
                }))}
              />
            )}
          />
        </FormField>

        <FormField label="Budget Category" hint="e.g. Core - Social &amp; Community Participation">
          <input {...register('budgetCategory')} placeholder="e.g. Core - Social & Community Participation" />
        </FormField>

        <FormField label="NDIS Plan Number">
          <input {...register('ndisPlanNumber')} placeholder="e.g. 43-1234567" />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Plan Start Date">
            <input type="date" {...register('planStartDate')} />
          </FormField>
          <FormField label="Plan End Date" error={errors.planEndDate?.message}>
            <input type="date" {...register('planEndDate')} />
          </FormField>
        </div>

        <FormField label="Budget" error={typeof errors.budget?.message === 'string' ? errors.budget.message : undefined} hint="Total funds available under this budget category, in AUD.">
          <input type="number" step="0.01" min="0" {...register('budget')} placeholder="e.g. 12000" />
        </FormField>

        <FormField label="Payer Name" hint="Plan manager, family member, or B2B organisation billed for this funding.">
          <input {...register('payerName')} placeholder="e.g. Plan Partners" />
        </FormField>

        <FormField label="Payer Email" error={typeof errors.payerEmail?.message === 'string' ? errors.payerEmail.message : undefined}>
          <input type="email" {...register('payerEmail')} placeholder="e.g. accounts@planpartners.com.au" />
        </FormField>

        {error && (
          <div role="alert" className="bg-[var(--color-error-container)] rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--color-destructive)]">
            {error}
          </div>
        )}
      </form>
    </SlideOver>
  )
}
