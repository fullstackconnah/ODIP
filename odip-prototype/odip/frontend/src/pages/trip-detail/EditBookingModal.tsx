import { useEffect, useRef, useState } from 'react'
import { extractErrorMessage } from '@/lib/utils'
import { useBooking, useUpdateBooking } from '@/api/hooks'
import { Dropdown } from '@/components/Dropdown'
import { Modal } from '@/components/Modal'
import { CheckboxField } from '@/components/CheckboxField'
import { Button } from '@/components/Button'
import { PageState } from '@/components/PageState'
import { bookingBudgetNotice } from '@/lib/bookingBudget'
import { queryPhase } from '@/lib/queryPhase'
import { isNotFoundError } from '@/lib/httpStatus'
import { BOOKING_STATUSES, type BookingStatus, type InsuranceStatus, type SupportRatio } from '@/api/types/enums'
import { BOOKING_STATUS_LABELS, statusItems } from '@/lib/tone'
import type { BookingDetailDto, BookingListDto, UpdateBookingDto } from '@/api/types/bookings'

type EditForm = {
  bookingStatus: string
  supportRatioOverride: string
  wheelchairRequired: boolean
  highSupportRequired: boolean
  nightSupportRequired: boolean
  hasRestrictivePracticeFlag: boolean
  bookingNotes: string
  insuranceStatus: string
  insuranceProvider: string
  insurancePolicyNumber: string
  insuranceCoverageStart: string
  insuranceCoverageEnd: string
}

const formFrom = (d: BookingDetailDto): EditForm => ({
  bookingStatus: d.bookingStatus ?? 'Enquiry',
  supportRatioOverride: d.supportRatioOverride ?? '',
  wheelchairRequired: d.wheelchairRequired ?? false,
  highSupportRequired: d.highSupportRequired ?? false,
  nightSupportRequired: d.nightSupportRequired ?? false,
  hasRestrictivePracticeFlag: d.hasRestrictivePracticeFlag ?? false,
  bookingNotes: d.bookingNotes ?? '',
  insuranceStatus: d.insuranceStatus || 'None',
  insuranceProvider: d.insuranceProvider ?? '',
  insurancePolicyNumber: d.insurancePolicyNumber ?? '',
  insuranceCoverageStart: d.insuranceCoverageStart ?? '',
  insuranceCoverageEnd: d.insuranceCoverageEnd ?? '',
})

/**
 * The edit dialog. It opens at once from the list row but its form starts from GET /bookings/{id}: the row lacks the detail-only columns, and the
 * server's PUT assigns every column of the update DTO, so a form built from the row saved blanks over them. Until the detail has loaded the body is
 * the loading line, and after a failed load it is the error with Try again (never an empty editable form); Save needs the loaded form.
 * The columns this dialog has no input for (plan-type override, funding / room / transport / equipment / risk-support notes, cancellation reason)
 * are carried from the loaded detail into the PUT unchanged.
 */
export function EditBookingModal({ booking, onClose, onSaved }: { booking: BookingListDto; onClose: () => void; onSaved: (response: Parameters<typeof bookingBudgetNotice>[0]) => void }) {
  const query = useBooking(booking.id)
  const updateBooking = useUpdateBooking()
  const detail = query.data
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  // Initialised once, when the detail first arrives; a later background refetch must not overwrite what the person has typed.
  if (detail && !editForm) setEditForm(formFrom(detail))
  const bodyRef = useRef<HTMLDivElement>(null)
  const hasForm = !!editForm
  // The form replaces a state that held focus (the dialog, or the Try again button that just unmounted): put focus on its first control.
  useEffect(() => {
    if (hasForm) bodyRef.current?.querySelector<HTMLElement>('button, input, textarea, select')?.focus()
  }, [hasForm])

  const handleUpdateBooking = () => {
    if (!detail || !editForm) return
    const data: UpdateBookingDto = {
      tripInstanceId: detail.tripInstanceId,
      participantId: detail.participantId,
      paymentStatus: detail.paymentStatus,
      actionRequired: detail.actionRequired,
      planTypeOverride: detail.planTypeOverride ?? undefined,
      fundingNotes: detail.fundingNotes ?? undefined,
      roomPreference: detail.roomPreference ?? undefined,
      transportNotes: detail.transportNotes ?? undefined,
      equipmentNotes: detail.equipmentNotes ?? undefined,
      riskSupportNotes: detail.riskSupportNotes ?? undefined,
      cancellationReason: detail.cancellationReason ?? undefined,
      bookingStatus: (editForm.bookingStatus || undefined) as BookingStatus | undefined,
      supportRatioOverride: (editForm.supportRatioOverride || undefined) as SupportRatio | undefined,
      wheelchairRequired: editForm.wheelchairRequired,
      highSupportRequired: editForm.highSupportRequired,
      nightSupportRequired: editForm.nightSupportRequired,
      hasRestrictivePracticeFlag: editForm.hasRestrictivePracticeFlag,
      bookingNotes: editForm.bookingNotes || undefined,
      insuranceStatus: editForm.insuranceStatus as InsuranceStatus,
      insuranceProvider: editForm.insuranceProvider || undefined,
      insurancePolicyNumber: editForm.insurancePolicyNumber || undefined,
      insuranceCoverageStart: editForm.insuranceCoverageStart || undefined,
      insuranceCoverageEnd: editForm.insuranceCoverageEnd || undefined,
    }
    updateBooking.mutate({ id: booking.id, data }, { onSuccess: onSaved })
  }

  const phase = queryPhase(query)
  return (
    <Modal
      stickyFooter
      open
      onClose={onClose}
      title={`Edit Booking — ${booking.participantName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleUpdateBooking} disabled={!editForm || updateBooking.isPending}>
            {updateBooking.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {/* One wrapper for every state, with a shared minimum height, so the dialog does not jump between the loading line, the error and the form. */}
      <div ref={bodyRef} data-testid="booking-edit-body" className="min-h-[min(39.25rem,calc(90vh-8.25rem))]">
      {!editForm ? (
        phase === 'error'
          ? (isNotFoundError(query.error)
            ? <PageState kind="not-found" noun="booking" />
            : <PageState kind="error" noun="booking" onRetry={() => query.refetch()} />)
          : <PageState kind="loading" noun="booking" />
      ) : (
        <div className="space-y-4">
          {/* Booking Status */}
          <div>
            <label className="block text-sm font-medium mb-1">Booking Status</label>
            <Dropdown
              variant="form"
              value={editForm.bookingStatus}
              onChange={val => setEditForm({ ...editForm, bookingStatus: val })}
              items={statusItems(BOOKING_STATUSES, BOOKING_STATUS_LABELS)}
            />
          </div>

          {/* Support Requirements */}
          <div>
            <label className="block text-sm font-medium mb-2">Support Requirements</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CheckboxField label="Wheelchair" checked={editForm.wheelchairRequired} onChange={e => setEditForm({ ...editForm, wheelchairRequired: e.target.checked })} />
              <CheckboxField label="High Support" checked={editForm.highSupportRequired} onChange={e => setEditForm({ ...editForm, highSupportRequired: e.target.checked })} />
              <CheckboxField label="Night Support" checked={editForm.nightSupportRequired} onChange={e => setEditForm({ ...editForm, nightSupportRequired: e.target.checked })} />
              <CheckboxField label="Restrictive Practice" checked={editForm.hasRestrictivePracticeFlag} onChange={e => setEditForm({ ...editForm, hasRestrictivePracticeFlag: e.target.checked })} />
            </div>
          </div>

          {/* Support Ratio Override */}
          <div>
            <label className="block text-sm font-medium mb-1">Support Ratio Override</label>
            <Dropdown
              variant="form"
              value={editForm.supportRatioOverride}
              onChange={val => setEditForm({ ...editForm, supportRatioOverride: val })}
              label="No override"
              items={[
                { value: '', label: 'No override' },
                { value: 'OneToOne', label: '1:1' },
                { value: 'OneToTwo', label: '1:2' },
                { value: 'OneToThree', label: '1:3' },
                { value: 'OneToFour', label: '1:4' },
                { value: 'OneToFive', label: '1:5' },
                { value: 'TwoToOne', label: '2:1' },
                { value: 'SharedSupport', label: 'Shared' },
                { value: 'Other', label: 'Other' },
              ]}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium mb-1">Booking Notes</label>
            <textarea value={editForm.bookingNotes} onChange={e => setEditForm({ ...editForm, bookingNotes: e.target.value })} rows={3}
              className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm resize-none focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
              placeholder="Optional notes..." />
          </div>

          {/* Insurance */}
          <div className="border-t border-[var(--color-border)]/15 pt-4 mt-2">
            <label className="block text-sm font-medium mb-3">Travel Insurance</label>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--color-muted-foreground)] mb-1">Status</label>
                <Dropdown
                  variant="form"
                  value={editForm.insuranceStatus}
                  onChange={val => setEditForm({ ...editForm, insuranceStatus: val })}
                  items={[
                    { value: 'None', label: 'None' },
                    { value: 'Pending', label: 'Pending' },
                    { value: 'Confirmed', label: 'Confirmed' },
                    { value: 'Expired', label: 'Expired' },
                    { value: 'Cancelled', label: 'Cancelled' },
                  ]}
                />
              </div>
              {editForm.insuranceStatus !== 'None' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--color-muted-foreground)] mb-1">Provider</label>
                      <input type="text" value={editForm.insuranceProvider} onChange={e => setEditForm({ ...editForm, insuranceProvider: e.target.value })}
                        className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm"
                        placeholder="e.g. Allianz" />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--color-muted-foreground)] mb-1">Policy Number</label>
                      <input type="text" value={editForm.insurancePolicyNumber} onChange={e => setEditForm({ ...editForm, insurancePolicyNumber: e.target.value })}
                        className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm"
                        placeholder="e.g. POL-12345" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--color-muted-foreground)] mb-1">Coverage Start</label>
                      <input type="date" value={editForm.insuranceCoverageStart} onChange={e => setEditForm({ ...editForm, insuranceCoverageStart: e.target.value })}
                        className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--color-muted-foreground)] mb-1">Coverage End</label>
                      <input type="date" value={editForm.insuranceCoverageEnd} onChange={e => setEditForm({ ...editForm, insuranceCoverageEnd: e.target.value })}
                        className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Error */}
          {updateBooking.isError && (
            <p className="text-sm text-[var(--color-destructive)]">{extractErrorMessage(updateBooking.error, "Couldn't update this booking. Check your connection and try again.")}</p>
          )}
        </div>
      )}
      </div>
    </Modal>
  )
}
