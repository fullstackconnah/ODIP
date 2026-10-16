import { useId, useState } from 'react'
import { useCloseInquiry } from '@/api/hooks'
import type { CloseInquiryResultDto, InquiryCloseOutcome, ParticipantInquiryDto } from '@/api/types/inquiries'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SelectField } from '@/components/SelectField'
import { TextAreaField } from '@/components/TextAreaField'
import { CLOSE_OUTCOME_OPTIONS, closeConsequences } from '@/lib/inquiryClose'
import { refusalOf } from '@/lib/intakeBooking'
import { fullName } from '@/lib/inquiryDetails'

/**
 * "Close Ana Lopez's enquiry?" (SHAPE.md section 11): why (required), an optional note, and what closing will do. Renders nothing while `row` is
 * null. A refusal stays in the dialog with the server's sentence.
 */
export function CloseInquiryDialog({ row, unsaved = false, onCancel, onDone }: {
  row: ParticipantInquiryDto | null
  /** The form has changes it hasn't saved: closing discards them, and the dialog says so. */
  unsaved?: boolean
  onCancel: () => void
  onDone: (row: ParticipantInquiryDto, result: CloseInquiryResultDto) => void
}) {
  const close = useCloseInquiry()
  const outcomeId = useId()
  const [outcome, setOutcome] = useState<InquiryCloseOutcome | ''>('')
  const [note, setNote] = useState('')
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!row) return null

  async function confirm() {
    if (close.isPending || !row) return
    if (!outcome) {
      setMissing(true)
      document.getElementById(outcomeId)?.focus()
      return
    }
    try {
      const result = await close.mutateAsync({ id: row.id, data: { outcome, note: note.trim() || null, expectedUpdatedAt: row.updatedAt } })
      setError(null)
      onDone(row, result)
    } catch (failure) {
      setError(refusalOf(failure, "The enquiry wasn't closed. Try again."))
    }
  }

  return (
    <ConfirmDialog
      open
      onCancel={() => { setError(null); onCancel() }}
      onConfirm={confirm}
      title={`Close ${fullName(row.firstName, row.lastName)}'s enquiry?`}
      confirmLabel="Close enquiry"
      cancelLabel="Keep it open"
      variant="danger"
      loading={close.isPending}
      message={
        <div className="flex flex-col gap-[var(--field-gap-y)]">
          <SelectField
            id={outcomeId}
            label="Why is it closing?"
            required
            placeholder="Choose…"
            value={outcome}
            options={CLOSE_OUTCOME_OPTIONS}
            error={missing && !outcome ? "Choose why it's closing." : undefined}
            onChange={event => { setOutcome(event.target.value as InquiryCloseOutcome); setMissing(false) }}
          />
          <TextAreaField
            label="Note (optional)"
            rows={3}
            maxLength={500}
            hint="Kept with the enquiry, for whoever reads it later."
            value={note}
            onChange={event => setNote(event.target.value)}
          />
          <div className="flex flex-col gap-1">
            {closeConsequences(row, { unsaved }).map(line => <p key={line}>{line}</p>)}
          </div>
          {error && <p role="alert" className="text-[var(--color-destructive)] break-words">{error}</p>}
        </div>
      }
    />
  )
}
