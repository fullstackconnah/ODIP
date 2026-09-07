import { useEffect, useMemo } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Modal } from '@/components/Modal'
import { FormField } from '@/components/FormField'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import type { CreateRecurringUnavailabilityDto } from '@/api/types'

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

type UnavailabilityFormValues = {
  userId: string
  dayOfWeek: string
  startTime: string
  endTime: string
  effectiveFrom: string
  effectiveTo: string
  notes: string
}

const DEFAULT_VALUES: UnavailabilityFormValues = {
  userId: '', dayOfWeek: 'Monday', startTime: '', endTime: '', effectiveFrom: '', effectiveTo: '', notes: '',
}

/** Pads an <input type="time"> value ("HH:mm") to .NET TimeOnly's wire format ("HH:mm:ss") —
 * a browser that already emits seconds is left untouched. */
const toTimeOnly = (t: string) => (t.length === 5 ? `${t}:00` : t)

function buildSchema(requireStaff: boolean) {
  return z
    .object({
      userId: requireStaff ? z.string().min(1, 'Select a staff member') : z.string().optional(),
      dayOfWeek: z.enum(DAYS_OF_WEEK),
      startTime: z.string().min(1, 'Start time is required'),
      endTime: z.string().min(1, 'End time is required'),
      effectiveFrom: z.string().min(1, 'Effective-from date is required'),
      effectiveTo: z.string().optional(),
      notes: z.string().optional(),
    })
    .refine(data => data.startTime < data.endTime, { message: 'Start time must be before end time.', path: ['endTime'] })
    .refine(data => !data.effectiveTo || data.effectiveTo >= data.effectiveFrom, { message: 'Effective-to must be on or after effective-from.', path: ['effectiveTo'] })
}

export type UnavailabilityFormModalProps = {
  open: boolean
  onClose: () => void
  onSubmit: (data: CreateRecurringUnavailabilityDto) => Promise<void>
  submitting: boolean
  errorMessage?: string | null
  staffOptions?: { value: string; label: string }[]
}

/** Weekly recurring unavailability form (§2 CreateRecurringUnavailabilityDto). See
 * LeaveRequestFormModal's doc comment for the reuse/validation-testing notes — identical here. */
export function UnavailabilityFormModal({ open, onClose, onSubmit, submitting, errorMessage, staffOptions }: UnavailabilityFormModalProps) {
  const requireStaff = !!staffOptions
  const schema = useMemo(() => buildSchema(requireStaff), [requireStaff])
  const { register, control, handleSubmit, reset, formState: { errors, isDirty } } = useForm<UnavailabilityFormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_VALUES,
  })
  // Same wiring as LeaveRequestFormModal — see that component's doc comment for the quoted
  // VehicleCreatePage.tsx precedent.
  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  // Resets on every open/close transition, not just open — otherwise a successful submit or a
  // Cancel leaves isDirty true on the still-mounted form, arming a spurious unsaved-changes
  // prompt on the next navigation (see useUnsavedChangesWarning.tsx:16-24).
  useEffect(() => {
    reset(DEFAULT_VALUES)
  }, [open, reset])

  const submit = handleSubmit(async values => {
    await onSubmit({
      dayOfWeek: values.dayOfWeek,
      // <input type="time"> emits "HH:mm" with no seconds, but the backend's TimeOnly binder
      // (System.Text.Json) rejects anything shorter than "HH:mm:ss" — pad to the wire format.
      startTime: toTimeOnly(values.startTime),
      endTime: toTimeOnly(values.endTime),
      effectiveFrom: values.effectiveFrom,
      effectiveTo: values.effectiveTo || null,
      notes: values.notes.trim() || null,
      ...(requireStaff ? { userId: values.userId } : {}),
    })
  })

  return (
    <>
      {unsavedChangesDialog}
      <Modal
        open={open}
        onClose={onClose}
        title={requireStaff ? 'Enter regular unavailability on behalf of staff' : 'Add regular unavailability'}
        closeOnBackdrop={false}
        footer={
          <>
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)]">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : requireStaff ? 'Save' : 'Submit request'}
            </button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          {requireStaff && staffOptions && (
            <Controller
              control={control}
              name="userId"
              render={({ field }) => (
                <FormField label="Staff member" required error={errors.userId?.message}>
                  <SearchableSelect value={field.value} onChange={field.onChange} onBlur={field.onBlur} items={staffOptions} placeholder="Search staff…" />
                </FormField>
              )}
            />
          )}

          <Controller
            control={control}
            name="dayOfWeek"
            render={({ field }) => (
              <FormField label="Day of week" required>
                <Dropdown variant="form" value={field.value} onChange={field.onChange} onBlur={field.onBlur} items={DAYS_OF_WEEK.map(d => ({ value: d, label: d }))} />
              </FormField>
            )}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start time" required error={errors.startTime?.message}>
              <input type="time" {...register('startTime')} />
            </FormField>
            <FormField label="End time" required error={errors.endTime?.message}>
              <input type="time" {...register('endTime')} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Effective from" required error={errors.effectiveFrom?.message}>
              <input type="date" {...register('effectiveFrom')} />
            </FormField>
            <FormField label="Effective to" hint="Leave blank for ongoing." error={errors.effectiveTo?.message}>
              <input type="date" {...register('effectiveTo')} />
            </FormField>
          </div>

          <FormField label="Notes" hint="Optional — shown to the coordinator reviewing this request.">
            <textarea rows={2} {...register('notes')} />
          </FormField>

          {errorMessage && (
            <p role="alert" className="text-sm text-[var(--color-destructive)]">{errorMessage}</p>
          )}
        </form>
      </Modal>
    </>
  )
}
