import { useEffect, useMemo } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Modal } from '@/components/Modal'
import { FormField } from '@/components/FormField'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { LEAVE_TYPES, LEAVE_TYPE_LABELS } from '@/api/types'
import type { CreateLeaveRequestDto, LeaveType } from '@/api/types'

type LeaveFormValues = {
  userId: string
  leaveType: LeaveType
  startDate: string
  endDate: string
  reason: string
}

const DEFAULT_VALUES: LeaveFormValues = { userId: '', leaveType: 'Annual', startDate: '', endDate: '', reason: '' }

function buildSchema(requireStaff: boolean) {
  return z
    .object({
      userId: requireStaff ? z.string().min(1, 'Select a staff member') : z.string().optional(),
      leaveType: z.enum(LEAVE_TYPES),
      startDate: z.string().min(1, 'Start date is required'),
      endDate: z.string().min(1, 'End date is required'),
      reason: z.string().optional(),
    })
    .refine(data => data.endDate >= data.startDate, {
      message: 'End date must be on or after the start date.',
      path: ['endDate'],
    })
}

export type LeaveRequestFormModalProps = {
  open: boolean
  onClose: () => void
  onSubmit: (data: CreateLeaveRequestDto) => Promise<void>
  submitting: boolean
  errorMessage?: string | null
  /** Coordinator "enter on behalf" mode — renders a required staff picker and adds userId to the
   * submitted payload. Omit for the portal's self-service form. */
  staffOptions?: { value: string; label: string }[]
}

/**
 * Date-range leave request form (§2 CreateLeaveRequestDto). Reused unchanged by both
 * PortalLeavePage (self-service, no staffOptions) and LeaveApprovalsPage's "Enter on behalf"
 * (staffOptions supplied). The zod@4/@hookform/resolvers@3 mismatch means rendered validation
 * text can't be reliably asserted in tests — the schema still runs so a user gets inline errors;
 * tests assert submit payloads/disabled states instead.
 */
export function LeaveRequestFormModal({ open, onClose, onSubmit, submitting, errorMessage, staffOptions }: LeaveRequestFormModalProps) {
  const requireStaff = !!staffOptions
  const schema = useMemo(() => buildSchema(requireStaff), [requireStaff])
  const { register, control, handleSubmit, reset, formState: { errors, isDirty } } = useForm<LeaveFormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_VALUES,
  })
  // Wired the same way VehicleCreatePage.tsx (an existing RHF+zod create form) does — see this
  // task's Interfaces section for the quoted precedent (VehicleCreatePage.tsx:49,101,106-107).
  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  // Resets on every open/close transition, not just open — otherwise a successful submit or a
  // Cancel leaves isDirty true on the still-mounted form, arming a spurious unsaved-changes
  // prompt on the next navigation (see useUnsavedChangesWarning.tsx:16-24).
  useEffect(() => {
    reset(DEFAULT_VALUES)
  }, [open, reset])

  const submit = handleSubmit(async values => {
    await onSubmit({
      leaveType: values.leaveType,
      startDate: values.startDate,
      endDate: values.endDate,
      reason: values.reason.trim() || null,
      ...(requireStaff ? { userId: values.userId } : {}),
    })
  })

  return (
    <>
      {unsavedChangesDialog}
      <Modal
        open={open}
        onClose={onClose}
        title={requireStaff ? 'Enter leave on behalf of staff' : 'Request leave'}
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
            name="leaveType"
            render={({ field }) => (
              <FormField label="Leave type" required>
                <Dropdown variant="form" value={field.value} onChange={field.onChange} onBlur={field.onBlur} items={LEAVE_TYPES.map(t => ({ value: t, label: LEAVE_TYPE_LABELS[t] }))} />
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

          <FormField label="Reason" hint="Optional — shown to the coordinator reviewing this request.">
            <textarea rows={2} {...register('reason')} />
          </FormField>

          {errorMessage && (
            <p role="alert" className="text-sm text-[var(--color-destructive)]">{errorMessage}</p>
          )}
        </form>
      </Modal>
    </>
  )
}
