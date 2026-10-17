import { useState } from 'react'
import { useCancelIntakeBooking } from '@/api/hooks'
import type { CancelIntakeBookingResultDto, ParticipantInquiryDto } from '@/api/types/inquiries'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FALLBACK_ZONE, invitee, unbroken, visitWhen } from '@/lib/intakeBooking'
import { fullName } from '@/lib/inquiryDetails'
import { extractErrorMessage } from '@/lib/utils'

type IntakeCancelDialogProps = {
  row: ParticipantInquiryDto | null
  onCancel: () => void
  /** `cleared` is the server's copy after the cancel (the enquiry form keeps it). */
  onDone: (row: ParticipantInquiryDto, email: CancelIntakeBookingResultDto['cancellationEmail'], cleared: ParticipantInquiryDto) => void
}

/** "Cancel Noah Fitzgerald's intake visit?" The server emails a CANCEL only if an invite had gone out, and the message says which. */
export function IntakeCancelDialog({ row, onCancel, onDone }: IntakeCancelDialogProps) {
  const cancel = useCancelIntakeBooking()
  const [error, setError] = useState<string | null>(null)
  if (!row?.intakeStartsAt) return null
  const staff = row.intakeStaffFirstName ?? 'the staff member'
  const message = row.intakeInviteSentAt
    ? `We'll email ${invitee(row)} a cancellation for ${unbroken(visitWhen(row.intakeStartsAt, row.timeZoneId || FALLBACK_ZONE))}, and the visit comes off ${staff}'s schedule.`
    : `No invite went out, so nobody is emailed. The visit comes off ${staff}'s schedule.`
  return (
    <ConfirmDialog
      open
      title={`Cancel ${fullName(row.firstName, row.lastName)}'s intake visit?`}
      message={<>{message}{error && <span role="alert" className="mt-2 block text-[var(--color-destructive)]">{error}</span>}</>}
      confirmLabel="Cancel visit"
      cancelLabel="Keep visit"
      variant="danger"
      loading={cancel.isPending}
      onCancel={() => { setError(null); onCancel() }}
      onConfirm={async () => {
        if (cancel.isPending) return
        try {
          const result = await cancel.mutateAsync({ id: row.id, expectedUpdatedAt: row.updatedAt })
          setError(null)
          onDone(row, result.cancellationEmail, result.inquiry)
        } catch (failure) {
          setError(extractErrorMessage(failure, "The visit wasn't cancelled. Try again."))
        }
      }}
    />
  )
}
