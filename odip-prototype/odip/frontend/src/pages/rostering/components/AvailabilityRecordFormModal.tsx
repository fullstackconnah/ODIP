import { useEffect, useMemo } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { FormField } from '@/components/FormField'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import type { CreateStaffAvailabilityDto } from '@/api/types'

// Deliberately excludes 'Leave' — the 2026-09-09 product ruling put leave exclusively in
// LeaveRequest/RecurringUnavailability; this legacy-record form only ever writes the other
// AvailabilityType values.
const RECORD_TYPES = ['Available', 'Unavailable', 'Training', 'Preferred', 'Tentative'] as const
type RecordType = (typeof RECORD_TYPES)[number]

export type AvailabilityFormValues = {
  staffId: string
  availabilityType: RecordType
  startDate: string
  endDate: string
  notes: string
}

const DEFAULT_VALUES: AvailabilityFormValues = {
  staffId: '', availabilityType: 'Available', startDate: '', endDate: '', notes: '',
}

// Local copies of pages/schedule/helpers.ts's toStartDt/toEndDt — that file is owned by another
// agent working concurrently, so it can't be imported from or edited here.
const toStartDt = (d: string) => `${d}T00:00:00`
const toEndDt = (d: string) => `${d}T23:59:59`

function buildSchema(requireStaff: boolean) {
  return z
    .object({
      staffId: requireStaff ? z.string().min(1, 'Select a staff member') : z.string().optional(),
      availabilityType: z.enum(RECORD_TYPES),
      startDate: z.string().min(1, 'Start date is required'),
      endDate: z.string().min(1, 'End date is required'),
      notes: z.string().optional(),
    })
    .refine(data => data.endDate >= data.startDate, {
      message: 'End date must be on or after the start date.',
      path: ['endDate'],
    })
}

export type AvailabilityRecordFormModalProps = {
  open: boolean
  onClose: () => void
  onSubmit: (data: CreateStaffAvailabilityDto) => Promise<void>
  submitting: boolean
  errorMessage?: string | null
  /** Coordinator "enter on behalf" mode — renders a required staff picker. Ignored (staff picker
   * always hidden) when `mode` is `'edit'` — staffId is never editable. */
  staffOptions?: { value: string; label: string }[]
  /** `'edit'` swaps the title/submit label and hides the staff picker; `onSubmit` still receives
   * the same Create DTO shape — the caller maps it onto the Update DTO. Defaults to `'create'`. */
  mode?: 'create' | 'edit'
  /** Pre-fills the form in edit mode. Applied on every open so re-opening the modal for a
   * different row re-seeds it. */
  initialValues?: Partial<AvailabilityFormValues>
}

/** Legacy StaffAvailability record form (CreateStaffAvailabilityDto). Coordinator-only — always
 * requires a staff picker in create mode (there is no self-service equivalent of this legacy
 * table). See LeaveRequestFormModal's doc comment for the reuse/validation-testing/edit-mode
 * notes — identical here. */
export function AvailabilityRecordFormModal({ open, onClose, onSubmit, submitting, errorMessage, staffOptions, mode = 'create', initialValues }: AvailabilityRecordFormModalProps) {
  const isEdit = mode === 'edit'
  const requireStaff = !isEdit && !!staffOptions
  const schema = useMemo(() => buildSchema(requireStaff), [requireStaff])
  const resetValues = useMemo<AvailabilityFormValues>(() => ({ ...DEFAULT_VALUES, ...initialValues }), [initialValues])
  const { register, control, handleSubmit, reset, formState: { errors, isDirty } } = useForm<AvailabilityFormValues>({
    resolver: zodResolver(schema),
    defaultValues: resetValues,
  })
  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  useEffect(() => {
    reset(resetValues)
  }, [open, reset, resetValues])

  const submit = handleSubmit(async values => {
    await onSubmit({
      staffId: values.staffId,
      startDateTime: toStartDt(values.startDate),
      endDateTime: toEndDt(values.endDate),
      availabilityType: values.availabilityType,
      isRecurring: false,
      notes: values.notes.trim() || undefined,
    })
  })

  return (
    <>
      {unsavedChangesDialog}
      <Modal
        open={open}
        onClose={onClose}
        title={isEdit ? 'Edit availability record' : 'Enter availability record on behalf of staff'}
        closeOnBackdrop={false}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button size="md" onClick={submit} disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save'}
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          {requireStaff && staffOptions && (
            <Controller
              control={control}
              name="staffId"
              render={({ field }) => (
                <FormField label="Staff member" required error={errors.staffId?.message}>
                  <SearchableSelect value={field.value} onChange={field.onChange} onBlur={field.onBlur} items={staffOptions} placeholder="Search staff…" />
                </FormField>
              )}
            />
          )}

          <Controller
            control={control}
            name="availabilityType"
            render={({ field }) => (
              <FormField label="Type" required>
                <Dropdown variant="form" value={field.value} onChange={field.onChange} onBlur={field.onBlur} items={RECORD_TYPES.map(t => ({ value: t, label: t }))} />
              </FormField>
            )}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start date" required error={errors.startDate?.message}>
              <input type="date" {...register('startDate')} />
            </FormField>
            <FormField label="End date" required error={errors.endDate?.message}>
              <input type="date" {...register('endDate')} />
            </FormField>
          </div>

          <FormField label="Notes" hint="Optional.">
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
