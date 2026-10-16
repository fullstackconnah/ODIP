import { useState } from 'react'
import { useReopenInquiry } from '@/api/hooks'
import type { ParticipantInquiryDto } from '@/api/types/inquiries'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { refusalOf } from '@/lib/intakeBooking'
import { fullName } from '@/lib/inquiryDetails'

/** "Reopen Ana Lopez's enquiry?" (SHAPE.md section 11). Renders nothing while `row` is null; a refusal stays in the dialog with the server's sentence. */
export function ReopenInquiryDialog({ row, onCancel, onDone }: {
  row: ParticipantInquiryDto | null
  onCancel: () => void
  onDone: (answer: ParticipantInquiryDto) => void
}) {
  const reopen = useReopenInquiry()
  const [error, setError] = useState<string | null>(null)
  if (!row) return null

  async function confirm() {
    if (reopen.isPending || !row) return
    try {
      const answer = await reopen.mutateAsync({ id: row.id, expectedUpdatedAt: row.updatedAt })
      setError(null)
      onDone(answer)
    } catch (failure) {
      setError(refusalOf(failure, "The enquiry wasn't reopened. Try again."))
    }
  }

  return (
    <ConfirmDialog
      open
      onCancel={() => { setError(null); onCancel() }}
      onConfirm={confirm}
      title={`Reopen ${fullName(row.firstName, row.lastName)}'s enquiry?`}
      confirmLabel="Reopen enquiry"
      cancelLabel="Keep it closed"
      loading={reopen.isPending}
      message={
        <>
          <p>It goes back on the Open list as New. Its other contacts were deleted when it closed, so add them again, and book a new intake visit if you need one.</p>
          {error && <p role="alert" className="mt-2 text-[var(--color-destructive)] break-words">{error}</p>}
        </>
      }
    />
  )
}
